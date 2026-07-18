const DEFAULT_REVIEW_AGENTS = new Set([
  "accessibility_auditor",
  "code_reviewer",
  "database_optimizer",
  "evidence_analyst",
  "security_engineer",
  "software_architect",
]);

function taskArguments(args) {
  if (args && typeof args === "object" && !Array.isArray(args)) return args;
  return {};
}

function taskIDFromOutput(output) {
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

export async function createDelegationGuard(options = {}) {
  const maxConcurrent = options.max_concurrent ?? 4;
  const maxTotal = options.max_total ?? 8;
  const reviewAgents = new Set(options.isolated_review_agents ?? DEFAULT_REVIEW_AGENTS);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isInteger(maxTotal) || maxTotal < maxConcurrent) {
    throw new Error("delegation guard requires positive integer concurrency and total limits");
  }
  const activeByParent = new Map();
  const totalByParent = new Map();
  const pendingCalls = new Map();
  const reservedByParent = new Map();
  const parentByChild = new Map();
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
  };
  const releaseReservation = (parentID) => {
    const reserved = reservedByParent.get(parentID) ?? 0;
    if (reserved <= 1) reservedByParent.delete(parentID);
    else reservedByParent.set(parentID, reserved - 1);
  };
  return {
    async "tool.execute.before"(input, output) {
      if (String(input?.tool).toLowerCase() !== "task" || typeof input?.sessionID !== "string") return;
      const args = taskArguments(output.args);
      const agent = args.subagent_type;
      const prompt = args.prompt;
      if (typeof agent !== "string" || typeof prompt !== "string") throw new Error("delegation requires a subagent type and bounded prompt");
      const hasConcreteBoundary = /```diff\b|^diff --git\b|\b(?:changed files?|source (?:path|boundary)|evidence bundle|claim checklist)\s*:\s*[^\s][^\n]*/im.test(prompt);
      if (reviewAgents.has(agent) && !hasConcreteBoundary) {
        throw new Error("isolated review requires an exact diff, source boundary, or evidence bundle");
      }
      if (reviewAgents.has(agent) && !/\b(?:read-only|do not edit|do not run commands|already-produced)\b/i.test(prompt)) {
        throw new Error("isolated review request must preserve the reviewer read-only contract");
      }
      const active = activeFor(input.sessionID);
      const reserved = reservedByParent.get(input.sessionID) ?? 0;
      if (active.size + reserved >= maxConcurrent) throw new Error(`delegation concurrency limit reached (${maxConcurrent})`);
      if ((totalByParent.get(input.sessionID) ?? 0) + reserved >= maxTotal) throw new Error(`delegation total limit reached (${maxTotal})`);
      if (typeof input.callID !== "string") throw new Error("delegation requires a task call ID");
      pendingCalls.set(input.callID, input.sessionID);
      reservedByParent.set(input.sessionID, reserved + 1);
    },
    async "tool.execute.after"(input, output) {
      if (String(input?.tool).toLowerCase() !== "task") return;
      const parentID = typeof input.callID === "string" ? pendingCalls.get(input.callID) : input.sessionID;
      if (typeof input.callID === "string") pendingCalls.delete(input.callID);
      const childID = taskIDFromOutput(output);
      if (typeof parentID !== "string") return;
      releaseReservation(parentID);
      if (!childID) return;
      markActive(parentID, childID);
      totalByParent.set(parentID, (totalByParent.get(parentID) ?? 0) + 1);
    },
    async event({ event }) {
      if (event?.type === "session.created") {
        const parentID = parentFromEvent(event);
        const childID = sessionFromEvent(event);
        if (parentID && childID) markActive(parentID, childID);
        return;
      }
      const sessionID = sessionFromEvent(event);
      const status = event?.properties?.status;
      if (event?.type === "session.deleted" || (event?.type === "session.status" && status?.type === "idle")) {
        if (sessionID) markTerminal(sessionID);
      }
      if (event?.type === "session.deleted" && sessionID) {
        activeByParent.delete(sessionID);
        totalByParent.delete(sessionID);
        reservedByParent.delete(sessionID);
      }
    },
  };
}

export default {
  id: "opencode-delegation-guard",
  server: createDelegationGuard,
};
