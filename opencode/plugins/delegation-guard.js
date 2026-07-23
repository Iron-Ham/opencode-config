const DEFAULT_REVIEW_AGENTS = new Set([
  "accessibility_auditor",
  "code_reviewer",
  "database_optimizer",
  "evidence_analyst",
  "evidence_reader",
  "security_engineer",
  "software_architect",
  "luna_reader",
]);
const DEFAULT_IMPLEMENTATION_AGENTS = new Set([
  "luna_implementer",
]);
const DEFAULT_READER_AGENTS = new Set([
  "evidence_reader",
  "luna_reader",
]);
const MAX_PENDING_CALLS = 1000;

function taskArguments(args) {
  if (args && typeof args === "object" && !Array.isArray(args)) return args;
  return {};
}

function taskIDFromOutput(output) {
  const metadata = output?.metadata;
  for (const key of ["sessionId", "sessionID", "jobId"]) {
    if (typeof metadata?.[key] === "string") return metadata[key];
  }
  const value = typeof output?.output === "string" ? output.output : "";
  const json = (() => {
    try { return JSON.parse(value); } catch { return null; }
  })();
  if (json && typeof json.task_id === "string") return json.task_id;
  const match = /(?:task[_ ]id|<task[^>]*\bid)\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i.exec(value);
  return match?.[1];
}

function parentFromEvent(event) {
  const info = event?.properties?.info;
  return info && typeof info === "object" && typeof info.parentID === "string" ? info.parentID : null;
}

function sessionFromEvent(event) {
  if (typeof event?.properties?.sessionID === "string") return event.properties.sessionID;
  const info = event?.properties?.info;
  return info && typeof info === "object" && typeof info.id === "string" ? info.id : null;
}

function hasConcreteReviewBoundary(prompt) {
  return /```diff\b|^diff --git\b/im.test(prompt) ||
    /\b(?:changed files?|source (?:path|boundary)|search boundary|evidence boundary)\s*:\s*(?:`[^`]+`|[^\s][^\n]*\/[^\n]*|repository-wide\b)/im.test(prompt) ||
    /\bevidence bundle\s*:\s*(?:`[^`]+`|[^\s][^\n]*\/[^\n]*)/im.test(prompt);
}

function hasReaderContract(prompt) {
  return /\binvestigation\s*:\s*\S/im.test(prompt) &&
    /\b(?:search|evidence) boundary\s*:\s*(?:`[^`]+`|[^\s][^\n]*\/[^\n]*|repository-wide\b)/im.test(prompt) &&
    /\b(?:delegation value|parallel work|context compression)\s*:\s*\S/im.test(prompt);
}

function hasImplementationContract(prompt) {
  return /\bsource boundary\s*:\s*(?:`[^`]+`|[^\r\n]*[/.][^\r\n]*)/im.test(prompt) &&
    /\bacceptance criteria\s*:\s*\S/im.test(prompt) &&
    /\bdeterministic validation command\s*:\s*`[^`]+`/im.test(prompt);
}

function requestsMutation(prompt) {
  return /(?:^|\n)\s*(?:please\s+)?(?:apply(?:\s+(?:a|the))?\s+patch|(?:edit|write|modify|create|delete|remove|rename|move)\s+(?:a\s+|the\s+|[^\s]+)|(?:run|execute)\s+(?:a\s+|the\s+|[^\s]+)|commit\b|use\s+(?:bash|shell|terminal)\s+to\s+\S+)/im.test(prompt);
}

async function createDelegationGuard(options = {}) {
  const maxConcurrent = options.max_concurrent ?? 10;
  const maxTotal = options.max_total ?? 20;
  const reviewAgents = new Set(options.isolated_review_agents ?? DEFAULT_REVIEW_AGENTS);
  const readerAgents = new Set(options.reader_agents ?? DEFAULT_READER_AGENTS);
  const implementationAgents = new Set(
    options.isolated_implementation_agents ?? DEFAULT_IMPLEMENTATION_AGENTS,
  );
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isInteger(maxTotal) || maxTotal < maxConcurrent) {
    throw new Error("delegation guard requires positive integer concurrency and total limits");
  }
  const activeByParent = new Map();
  const totalByParent = new Map();
  const pendingCalls = new Map();
  const reservedByParent = new Map();
  const parentByChild = new Map();
  const outputSeenChildren = new Set();
  const terminalBeforeTaskOutput = new Set();
  const rootFor = (sessionID) => {
    const seen = new Set();
    let rootID = sessionID;
    while (parentByChild.has(rootID) && !seen.has(rootID)) {
      seen.add(rootID);
      rootID = parentByChild.get(rootID);
    }
    return rootID;
  };
  const activeFor = (parentID) => activeByParent.get(parentID) ?? new Set();
  const markActive = (parentID, childID) => {
    const active = activeFor(parentID);
    active.add(childID);
    activeByParent.set(parentID, active);
    parentByChild.set(childID, parentID);
  };
  const markTerminal = (childID) => {
    const parentID = parentByChild.get(childID);
    if (!parentID) return;
    activeFor(parentID).delete(childID);
    parentByChild.delete(childID);
    if (!outputSeenChildren.delete(childID)) {
      terminalBeforeTaskOutput.add(childID);
    }
  };
  const releaseReservation = (parentID) => {
    const reserved = reservedByParent.get(parentID) ?? 0;
    if (reserved <= 1) reservedByParent.delete(parentID);
    else reservedByParent.set(parentID, reserved - 1);
  };
  const clearPendingCalls = (parentID) => {
    for (const [callID, pendingParentID] of pendingCalls) {
      if (pendingParentID === parentID) pendingCalls.delete(callID);
    }
  };
  return {
    async "tool.execute.before"(input, output) {
      if (String(input?.tool).toLowerCase() !== "task" || typeof input?.sessionID !== "string") return;
      const args = taskArguments(output.args);
      const agent = args.subagent_type;
      const prompt = args.prompt;
      if (typeof agent !== "string" || typeof prompt !== "string") throw new Error("delegation requires a subagent type and bounded prompt");
      if (reviewAgents.has(agent) && !hasConcreteReviewBoundary(prompt)) {
        throw new Error("isolated review requires an exact diff, source boundary, or evidence bundle");
      }
      if (readerAgents.has(agent) && !hasReaderContract(prompt)) {
        throw new Error("reader delegation requires an investigation, search boundary, and delegation value");
      }
      if (implementationAgents.has(agent) && !hasImplementationContract(prompt)) {
        throw new Error(
          "implementation delegation requires a source boundary, acceptance criteria, and deterministic validation command",
        );
      }
      const hasReadOnlyContract =
        /\bread-only\b/i.test(prompt) &&
        /\bdo not edit\b/i.test(prompt) &&
        /\b(?:do not run commands|do not edit\s+or\s+run commands)\b/i.test(prompt);
      const negatesReadOnlyContract = /\b(?:not|never)\s+read-only\b|\bdo not\s+not\s+edit\b|\bdo not\s+not\s+run commands\b/i.test(prompt);
      if (reviewAgents.has(agent) && (!hasReadOnlyContract || negatesReadOnlyContract || requestsMutation(prompt))) {
        throw new Error("isolated review request must preserve the reviewer read-only contract");
      }
      const rootID = rootFor(input.sessionID);
      const active = activeFor(rootID);
      const reserved = reservedByParent.get(rootID) ?? 0;
      if (active.size + reserved >= maxConcurrent) throw new Error(`delegation concurrency limit reached (${maxConcurrent})`);
      if ((totalByParent.get(rootID) ?? 0) + reserved >= maxTotal) throw new Error(`delegation total limit reached (${maxTotal})`);
      if (typeof input.callID !== "string") throw new Error("delegation requires a task call ID");
      if (pendingCalls.size >= MAX_PENDING_CALLS) throw new Error("delegation pending-call limit reached");
      pendingCalls.set(input.callID, rootID);
      reservedByParent.set(rootID, reserved + 1);
    },
    async "tool.execute.after"(input, output) {
      if (String(input?.tool).toLowerCase() !== "task") return;
      const parentID = typeof input.callID === "string" ? pendingCalls.get(input.callID) : input.sessionID;
      if (typeof input.callID === "string") pendingCalls.delete(input.callID);
      const childID = taskIDFromOutput(output);
      if (typeof parentID !== "string") return;
      if (!childID) {
        releaseReservation(parentID);
        return;
      }
      releaseReservation(parentID);
      if (!terminalBeforeTaskOutput.delete(childID)) {
        outputSeenChildren.add(childID);
        markActive(parentID, childID);
      }
      totalByParent.set(parentID, (totalByParent.get(parentID) ?? 0) + 1);
    },
    async event({ event }) {
      if (event?.type === "session.created") {
        const parentID = parentFromEvent(event);
        const childID = sessionFromEvent(event);
        if (parentID && childID) markActive(rootFor(parentID), childID);
        return;
      }
      const sessionID = sessionFromEvent(event);
      const rootID = sessionID ? rootFor(sessionID) : null;
      const status = event?.properties?.status;
      if (
        event?.type === "session.deleted" ||
        event?.type === "session.idle" ||
        (event?.type === "session.status" && status?.type === "idle")
      ) {
        if (sessionID) markTerminal(sessionID);
      }
      if (event?.type === "session.deleted" && sessionID) {
        if (rootID === sessionID) clearPendingCalls(sessionID);
        activeByParent.delete(sessionID);
        totalByParent.delete(sessionID);
        reservedByParent.delete(sessionID);
      }
    },
  };
}

export const testHelpers = { createDelegationGuard };

export default {
  id: "opencode-delegation-guard",
  server: createDelegationGuard,
};
