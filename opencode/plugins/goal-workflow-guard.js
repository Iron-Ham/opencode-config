import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const GOAL_MARKER = "OpenCode goal mode";
const ACTIVE_HEADER = "OpenCode goal mode active reminder:";
const PLAN_HEADER =
  "OpenCode goal mode is tracking a goal, but this session is currently in Plan mode.";
const PLAN_SUFFIX = "Plan-mode constraints:";
const CURRENT_HEADER = "OpenCode goal mode current state:";
const CURRENT_SUFFIX =
  "If the user resumes or edits the goal, continue from the objective and current evidence.";
const RUNTIME_STATE = `Goal runtime state:
- Call get_goal for current counters, configured limits, checkpoints, or status.
- The Goal runtime enforces configured limits independently of this reminder.`;
const COMPLETION_SCHEMA_MARKER = "goal-completion-evidence-v1";
const COMPLETION_GUIDANCE = `Completion evidence contract (${COMPLETION_SCHEMA_MARKER}): when status is "complete", evidence must be a JSON string with exactly this shape: {"schema_version":1,"summary":"what is complete","checks":[{"requirement":"one explicit requirement","status":"passed","evidence":[{"kind":"test","reference":"exact command, file, diagnostic, runtime check, review, or external check","result":"what passed or was observed"}]}],"remaining_work":[]}. Include every requested outcome as a check. Allowed evidence kinds are command, test, diagnostic, runtime, file, diff, review, and external. Keep results concise; never embed secrets or raw logs. Every check must pass and remaining_work must be empty.`;
const COMPLETION_EVIDENCE_KINDS = new Set([
  "command",
  "test",
  "diagnostic",
  "runtime",
  "file",
  "diff",
  "review",
  "external",
]);
const MAX_COMPLETION_EVIDENCE_LENGTH = 4000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, keys, label) {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  const unexpected = actual.filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unexpected.length || missing.length) {
    const details = [
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : "",
      missing.length ? `missing: ${missing.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(`${label} has invalid fields (${details.join("; ")})`);
  }
}

function nonEmptyString(value, label, maximumLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  const result = value.trim();
  if (result.length > maximumLength) {
    throw new Error(`${label} must be at most ${maximumLength} characters`);
  }
  return result;
}

function stabilizeActiveReminder(source) {
  const header = source.indexOf(ACTIVE_HEADER);
  if (header === -1) return source;

  const objectiveEnd = source.indexOf("</untrusted_objective>", header);
  if (objectiveEnd === -1) return source;

  const budgetStart = source.indexOf("\n\nBudget:\n", objectiveEnd);
  if (budgetStart === -1) return source;

  const workStart = source.indexOf("\n\nWork from evidence:", budgetStart);
  if (workStart === -1) return source;

  return `${source.slice(0, budgetStart)}\n\n${RUNTIME_STATE}${source.slice(workStart)}`;
}

function stabilizeGoalSummary(summary) {
  const statusPattern = /\nStatus: (?:active|paused|budgetLimited|usageLimited|complete|unmet)\nTime used: [^\n]*\nTokens used: [^\n]*/g;
  let match;
  let lastMatch;
  while ((match = statusPattern.exec(summary)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch) return summary;

  const statusEnd = summary.indexOf("\n", lastMatch.index + 1);
  if (statusEnd === -1) return summary;
  return `${summary.slice(0, statusEnd)}\n${RUNTIME_STATE}`;
}

function stabilizeDelimitedSummary(source, header, suffix) {
  const headerStart = source.indexOf(header);
  if (headerStart === -1) return source;

  const summaryStart = headerStart + header.length;
  const suffixStart = source.lastIndexOf(`\n\n${suffix}`);
  if (suffixStart < summaryStart) return source;

  const summary = source.slice(summaryStart, suffixStart);
  const stable = stabilizeGoalSummary(summary);
  if (stable === summary) return source;
  return `${source.slice(0, summaryStart)}${stable}${source.slice(suffixStart)}`;
}

export function stabilizeGoalSystemText(source) {
  if (typeof source !== "string" || !source.includes(GOAL_MARKER)) return source;

  const variants = [
    {
      header: ACTIVE_HEADER,
      transform: () => stabilizeActiveReminder(source),
    },
    {
      header: PLAN_HEADER,
      transform: () => stabilizeDelimitedSummary(source, PLAN_HEADER, PLAN_SUFFIX),
    },
    {
      header: CURRENT_HEADER,
      transform: () => stabilizeDelimitedSummary(source, CURRENT_HEADER, CURRENT_SUFFIX),
    },
  ]
    .map((variant) => ({ ...variant, index: source.indexOf(variant.header) }))
    .filter((variant) => variant.index !== -1)
    .sort((left, right) => left.index - right.index);
  return variants[0]?.transform() ?? source;
}

export function parseCompletionEvidence(source) {
  if (typeof source !== "string") {
    throw new Error("completion evidence must be a JSON string");
  }

  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("completion evidence must be valid JSON without Markdown fences");
  }
  if (!isRecord(value)) {
    throw new Error("completion evidence must be a JSON object");
  }
  assertExactKeys(
    value,
    ["schema_version", "summary", "checks", "remaining_work"],
    "completion evidence",
  );
  if (value.schema_version !== 1) {
    throw new Error("completion evidence schema_version must be 1");
  }

  const summary = nonEmptyString(value.summary, "completion evidence summary", 1000);
  if (!Array.isArray(value.checks) || value.checks.length === 0) {
    throw new Error("completion evidence checks must contain at least one check");
  }
  if (value.checks.length > 50) {
    throw new Error("completion evidence checks must contain at most 50 checks");
  }

  const seenRequirements = new Set();
  const checks = value.checks.map((check, checkIndex) => {
    const label = `completion evidence checks[${checkIndex}]`;
    if (!isRecord(check)) throw new Error(`${label} must be an object`);
    assertExactKeys(check, ["requirement", "status", "evidence"], label);

    const requirement = nonEmptyString(check.requirement, `${label}.requirement`, 500);
    if (seenRequirements.has(requirement)) {
      throw new Error(`${label}.requirement duplicates another check`);
    }
    seenRequirements.add(requirement);
    if (check.status !== "passed") {
      throw new Error(`${label}.status must be "passed" before completing a goal`);
    }
    if (!Array.isArray(check.evidence) || check.evidence.length === 0) {
      throw new Error(`${label}.evidence must contain at least one item`);
    }
    if (check.evidence.length > 20) {
      throw new Error(`${label}.evidence must contain at most 20 items`);
    }

    const evidence = check.evidence.map((item, evidenceIndex) => {
      const itemLabel = `${label}.evidence[${evidenceIndex}]`;
      if (!isRecord(item)) throw new Error(`${itemLabel} must be an object`);
      assertExactKeys(item, ["kind", "reference", "result"], itemLabel);
      if (!COMPLETION_EVIDENCE_KINDS.has(item.kind)) {
        throw new Error(`${itemLabel}.kind is not supported`);
      }
      return {
        kind: item.kind,
        reference: nonEmptyString(item.reference, `${itemLabel}.reference`, 1000),
        result: nonEmptyString(item.result, `${itemLabel}.result`, 1000),
      };
    });

    return { requirement, status: "passed", evidence };
  });

  if (!Array.isArray(value.remaining_work) || value.remaining_work.length !== 0) {
    throw new Error("completion evidence remaining_work must be an empty array");
  }

  const manifest = {
    schema_version: 1,
    summary,
    checks,
    remaining_work: [],
  };
  const canonical = JSON.stringify(manifest);
  if (canonical.length > MAX_COMPLETION_EVIDENCE_LENGTH) {
    throw new Error(
      `completion evidence must be at most ${MAX_COMPLETION_EVIDENCE_LENGTH} characters after canonicalization`,
    );
  }
  return { manifest, canonical };
}

function safeIdentifier(value) {
  const source = String(value);
  const readable = source.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "unknown";
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return `${readable}-${digest}`;
}

export function completionEvidenceDirectory(environment = process.env) {
  const explicit = environment.OPENCODE_COMPLETION_EVIDENCE_DIR?.trim();
  if (explicit) return path.resolve(explicit);

  const dataHome = environment.XDG_DATA_HOME?.trim() || path.join(homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "completion-evidence");
}

export async function persistCompletionEvidence({
  sessionID,
  callID,
  manifest,
  directory = completionEvidenceDirectory(),
  recordedAt = new Date(),
}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const filename = `${safeIdentifier(sessionID)}--${safeIdentifier(callID)}.json`;
  const destination = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  const record = {
    record_schema_version: 1,
    record_type: "opencode_goal_completion",
    session_id: String(sessionID),
    call_id: String(callID),
    recorded_at: recordedAt.toISOString(),
    completion_evidence: manifest,
  };

  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return destination;
}

function addCompletionEvidenceToOutput(output, manifest, artifactPath, persistenceError) {
  let payload;
  try {
    payload = JSON.parse(output.output);
  } catch {
    payload = { result: output.output };
  }
  if (!isRecord(payload)) payload = { result: payload };

  payload.completion_evidence = manifest;
  if (artifactPath) payload.completion_evidence_artifact = artifactPath;
  if (persistenceError) payload.completion_evidence_persistence_error = persistenceError;
  output.output = JSON.stringify(payload, null, 2);
  output.metadata = {
    ...output.metadata,
    completionEvidence: {
      schemaVersion: 1,
      persisted: Boolean(artifactPath),
      ...(artifactPath ? { artifactPath } : {}),
      ...(persistenceError ? { persistenceError } : {}),
    },
  };
}

export async function createGoalWorkflowGuard() {
  return {
    async "experimental.chat.system.transform"(_input, output) {
      for (let index = 0; index < output.system.length; index += 1) {
        output.system[index] = stabilizeGoalSystemText(output.system[index]);
      }
    },
    async "tool.definition"(input, output) {
      if (input.toolID !== "update_goal") return;
      if (output.description.includes(COMPLETION_SCHEMA_MARKER)) return;
      output.description = `${output.description}\n\n${COMPLETION_GUIDANCE}`;
    },
    async "tool.execute.before"(input, output) {
      if (input.tool !== "update_goal" || output.args?.status !== "complete") return;
      const { canonical } = parseCompletionEvidence(output.args.evidence);
      output.args.evidence = canonical;
    },
    async "tool.execute.after"(input, output) {
      if (input.tool !== "update_goal" || input.args?.status !== "complete") return;
      const { manifest } = parseCompletionEvidence(input.args.evidence);
      let artifactPath;
      let persistenceError;
      try {
        artifactPath = await persistCompletionEvidence({
          sessionID: input.sessionID,
          callID: input.callID,
          manifest,
        });
      } catch (error) {
        persistenceError = error instanceof Error ? error.message : String(error);
      }
      addCompletionEvidenceToOutput(output, manifest, artifactPath, persistenceError);
    },
  };
}

export default {
  id: "claude-config-goal-workflow-guard",
  server: createGoalWorkflowGuard,
};
