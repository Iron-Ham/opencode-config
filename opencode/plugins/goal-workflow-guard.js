import { createHash, randomUUID } from "node:crypto";
import { chmod, link, mkdir, rm, writeFile } from "node:fs/promises";
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
const COMPLETION_GUIDANCE = `Completion evidence contract (${COMPLETION_SCHEMA_MARKER}): when status is "complete", evidence must be a JSON string with exactly this shape: {"schema_version":1,"summary":"what is complete","checks":[{"requirement":"one explicit requirement","status":"passed","evidence":[{"kind":"test","reference":"exact command, file, diagnostic, runtime check, review, or external check","result":"what passed or was observed"}]}],"remaining_work":[]}. Include every requested outcome as a check. Allowed evidence kinds are command, test, diagnostic, runtime, file, diff, review, and external. Keep results concise; never embed secrets or raw logs. Every check must pass and remaining_work must be empty. The optional handoff object classifies the result as carryable, repairable, or blocked and may include redacted source-boundary and expected/actual changed-file summaries.`;
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
const HANDOFF_CLASSIFICATIONS = new Set(["carryable", "repairable", "blocked"]);
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

function safeEvidenceText(value, label, maximumLength) {
  const result = nonEmptyString(value, label, maximumLength);
  if (/\r|\n|```/.test(result)) {
    throw new Error(`${label} must be a concise single-line summary, not raw output or source content`);
  }
  if (/(?:\b(?:cookie|set-cookie|session_cookie|authorization)\s*[:=]|\bBearer\s+\S+|\b(?:aws_secret_access_key|aws_access_key_id|private[_ -]?key|api[_ -]?key|token|secret|password)\b\s*[:=]|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----|\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=|\bgh[pous]_[A-Za-z0-9_]+|\b(?:sk|rk)_[A-Za-z0-9]{20,})/i.test(result)) {
    throw new Error(`${label} must not contain credentials or secret material`);
  }
  if (/(?:^|\s)(?:function|class|const|let|var|import|export)\s+[A-Za-z_$]/.test(result)) {
    throw new Error(`${label} must not contain source code`);
  }
  return result;
}

function assertAllowedKeys(value, keys, label) {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new Error(`${label} has invalid fields (unexpected: ${unexpected.join(", ")})`);
  }
}

function normalizeFileSummaries(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`${label} must contain at most 100 file summaries`);
  }
  return value.map((item, index) =>
    safeEvidenceText(item, `${label}[${index}]`, 300)
  );
}

function defaultHandoff(status, fallback) {
  if (status === "complete") {
    return {
      classification: "carryable",
      summary: "All requested outcomes have passing evidence.",
      next_action: "Continue with normal engineering handoff.",
      source_boundary: null,
      expected_changed_files: [],
      actual_changed_files: [],
    };
  }
  return {
    classification: "blocked",
    summary: fallback || "The goal cannot continue without external action.",
    next_action: "Resolve the recorded blocker before resuming or creating follow-up work.",
    source_boundary: null,
    expected_changed_files: [],
    actual_changed_files: [],
  };
}

export function parseGoalHandoff(value, { status, fallback } = {}) {
  if (status !== "complete" && status !== "unmet") {
    throw new Error("handoff status must be complete or unmet");
  }
  if (value == null) return defaultHandoff(status, fallback);
  if (!isRecord(value)) throw new Error("handoff must be an object");
  assertAllowedKeys(
    value,
    [
      "classification",
      "summary",
      "next_action",
      "source_boundary",
      "expected_changed_files",
      "actual_changed_files",
    ],
    "handoff",
  );
  if (!HANDOFF_CLASSIFICATIONS.has(value.classification)) {
    throw new Error("handoff classification must be carryable, repairable, or blocked");
  }
  if (status === "complete" && value.classification !== "carryable") {
    throw new Error("completed goals require a carryable handoff");
  }
  if (status === "unmet" && value.classification === "carryable") {
    throw new Error("unmet goals require a repairable or blocked handoff");
  }
  return {
    classification: value.classification,
    summary: safeEvidenceText(value.summary, "handoff summary", 1000),
    next_action: safeEvidenceText(value.next_action, "handoff next_action", 1000),
    source_boundary: value.source_boundary == null
      ? null
      : safeEvidenceText(value.source_boundary, "handoff source_boundary", 1000),
    expected_changed_files: normalizeFileSummaries(
      value.expected_changed_files,
      "handoff expected_changed_files",
    ),
    actual_changed_files: normalizeFileSummaries(
      value.actual_changed_files,
      "handoff actual_changed_files",
    ),
  };
}

function redactText(value) {
  return value
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [redacted]")
    .replace(
      /("(?:api[_ -]?key|token|secret|password|authorization)"\s*:\s*")[^"]*(")/gi,
      "$1[redacted]$2",
    )
    .replace(
      /((?:api[_ -]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    )
    .replace(
      /\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[^\s,;]+/g,
      "[redacted-env-assignment]",
    );
}

function redactManifest(manifest) {
  return {
    schema_version: manifest.schema_version,
    summary: redactText(manifest.summary),
    checks: manifest.checks.map((check) => ({
      requirement: redactText(check.requirement),
      status: check.status,
      evidence: check.evidence.map((item) => ({
        kind: item.kind,
        reference: redactText(item.reference),
        result: redactText(item.result),
      })),
    })),
    remaining_work: [],
  };
}

function redactHandoff(handoff) {
  return {
    classification: handoff.classification,
    summary: redactText(handoff.summary),
    next_action: redactText(handoff.next_action),
    source_boundary: handoff.source_boundary == null ? null : redactText(handoff.source_boundary),
    expected_changed_files: handoff.expected_changed_files.map(redactText),
    actual_changed_files: handoff.actual_changed_files.map(redactText),
  };
}

function opaqueDigest(value) {
  return `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;
}

function opaqueCompletionEvidence(manifest) {
  return {
    schema_version: manifest.schema_version,
    summary_sha256: opaqueDigest(manifest.summary),
    checks: manifest.checks.map((check) => ({
      requirement_sha256: opaqueDigest(check.requirement),
      status: check.status,
      evidence: check.evidence.map((item) => ({
        kind: item.kind,
        reference_sha256: opaqueDigest(item.reference),
        result_sha256: opaqueDigest(item.result),
      })),
    })),
    remaining_work_count: manifest.remaining_work.length,
  };
}

function opaqueHandoff(handoff) {
  const expected = new Set(handoff.expected_changed_files);
  return {
    classification: handoff.classification,
    summary_sha256: opaqueDigest(handoff.summary),
    next_action_sha256: opaqueDigest(handoff.next_action),
    source_boundary_sha256: handoff.source_boundary == null
      ? null
      : opaqueDigest(handoff.source_boundary),
    changed_files: {
      expected_count: handoff.expected_changed_files.length,
      actual_count: handoff.actual_changed_files.length,
      unexpected_count: handoff.actual_changed_files.filter((file) => !expected.has(file)).length,
    },
  };
}

export function createRedactedCompletionExport({ manifest, handoff }) {
  return {
    export_schema_version: 2,
    record_type: "opencode_goal_completion_export",
    completion_evidence: opaqueCompletionEvidence(manifest),
    handoff: opaqueHandoff(handoff),
  };
}

export function parseCompletionRecord(source) {
  let value;
  try {
    value = typeof source === "string" ? JSON.parse(source) : source;
  } catch {
    throw new Error("completion record must be valid JSON");
  }
  if (!isRecord(value)) {
    throw new Error("completion record has an unsupported type");
  }
  if (value.record_schema_version === 3) {
    if (value.record_type !== "opencode_goal_completion_pending") {
      throw new Error("completion record has an unsupported type");
    }
    return value;
  }
  if (value.record_type !== "opencode_goal_completion") {
    throw new Error("completion record has an unsupported type");
  }
  const { manifest } = parseCompletionEvidence(
    JSON.stringify(value.completion_evidence),
  );
  const handoff = parseGoalHandoff(value.handoff, {
    status: "complete",
    fallback: manifest.summary,
  });
  const redactedManifest = redactManifest(manifest);
  const redactedHandoff = redactHandoff(handoff);
  const normalized = {
    record_schema_version: 3,
    record_type: "opencode_goal_completion_pending",
    session_sha256: opaqueDigest(nonEmptyString(value.session_id, "completion record session_id", 1000)),
    call_sha256: opaqueDigest(nonEmptyString(value.call_id, "completion record call_id", 1000)),
    recorded_at: nonEmptyString(value.recorded_at, "completion record recorded_at", 1000),
    completion_evidence: opaqueCompletionEvidence(redactedManifest),
    handoff: opaqueHandoff(redactedHandoff),
  };
  if (value.record_schema_version === 1 || value.record_schema_version === 2) {
    return { ...normalized, migrated_from_record_schema_version: value.record_schema_version };
  }
  throw new Error("completion record schema_version must be 1, 2, or 3");
}

function goalUpdateOptions(args) {
  if (!isRecord(args)) throw new Error("goal update arguments must be an object");
  return isRecord(args.options) ? args.options : args;
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
  const statusPattern = /\nStatus: (?:active|paused|blocked|stopped|budgetLimited|usageLimited|complete|unmet)\nTime used: [^\n]*\nTokens used: [^\n]*/g;
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

  const summary = safeEvidenceText(value.summary, "completion evidence summary", 1000);
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

    const requirement = safeEvidenceText(check.requirement, `${label}.requirement`, 4000);
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
        reference: safeEvidenceText(item.reference, `${itemLabel}.reference`, 1000),
        result: safeEvidenceText(item.result, `${itemLabel}.result`, 1000),
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
  return createHash("sha256").update(String(value)).digest("hex");
}

export function completionEvidenceDirectory(environment = process.env) {
  const explicit = environment.OPENCODE_COMPLETION_EVIDENCE_DIR?.trim();
  if (explicit) return path.resolve(explicit);

  const dataHome = environment.XDG_DATA_HOME?.trim() || path.join(homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "completion-evidence");
}

async function writeImmutableRecord(directory, filename, record) {
  const destination = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await link(temporary, destination);
    await chmod(destination, 0o600);
    await rm(temporary, { force: true });
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return destination;
}

export async function persistCompletionEvidence({
  sessionID,
  callID,
  manifest,
  handoff,
  authorizationID = randomUUID(),
  directory = completionEvidenceDirectory(),
  recordedAt = new Date(),
}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const filename = `${safeIdentifier(sessionID)}--${safeIdentifier(callID)}.json`;
  const { manifest: validatedManifest } = parseCompletionEvidence(
    JSON.stringify(manifest),
  );
  const normalizedHandoff = parseGoalHandoff(handoff, {
    status: "complete",
    fallback: validatedManifest.summary,
  });
  const redactedManifest = redactManifest(validatedManifest);
  const redactedHandoff = redactHandoff(normalizedHandoff);
  const record = {
    record_schema_version: 3,
    record_type: "opencode_goal_completion_pending",
    session_sha256: opaqueDigest(sessionID),
    call_sha256: opaqueDigest(callID),
    recorded_at: recordedAt.toISOString(),
    authorization_sha256: opaqueDigest(authorizationID),
    completion_evidence_sha256: opaqueDigest(JSON.stringify(redactedManifest)),
    completion_requirement_hashes: redactedManifest.checks.map((check) =>
      opaqueDigest(check.requirement)
    ),
    completion_evidence: opaqueCompletionEvidence(redactedManifest),
    handoff: opaqueHandoff(redactedHandoff),
  };

  return writeImmutableRecord(directory, filename, record);
}

function addCompletionEvidenceToOutput(
  output,
  redactedExport,
  artifactID,
) {
  let payload;
  try {
    payload = JSON.parse(output.output);
  } catch {
    payload = { result: output.output };
  }
  if (!isRecord(payload)) payload = { result: payload };

  if (typeof payload.completion_report === "string") {
    payload.completion_report = "Goal completion recorded with structured evidence.";
  }
  if (typeof payload.result === "string") {
    payload.result = "Goal completion recorded with structured evidence.";
  }

  payload.completion_evidence = redactedExport.completion_evidence;
  payload.completion_handoff = redactedExport.handoff;
  payload.completion_evidence_export = redactedExport;
  payload.completion_evidence_artifact_id = artifactID;
  output.output = JSON.stringify(payload, null, 2);
  output.metadata = {
    ...output.metadata,
    completionEvidence: {
      schemaVersion: 2,
      persisted: true,
      artifactID,
    },
  };
}

export async function createGoalWorkflowGuard() {
  const pendingCompletions = new Map();
  const pendingKey = (input) => `${String(input.sessionID)}\0${String(input.callID)}`;
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
      if (input.tool !== "update_goal") return;
      const options = goalUpdateOptions(output.args);
      if (output.args?.status === "complete") {
        const { manifest } = parseCompletionEvidence(options.evidence);
        const handoff = parseGoalHandoff(options.handoff, {
          status: "complete",
          fallback: manifest.summary,
        });
        const redactedManifest = redactManifest(manifest);
        const redactedHandoff = redactHandoff(handoff);
        const redactedExport = createRedactedCompletionExport({
          manifest: redactedManifest,
          handoff: redactedHandoff,
        });
        const authorizationID = randomUUID();
        await persistCompletionEvidence({
          sessionID: input.sessionID,
          callID: input.callID,
          manifest: redactedManifest,
          handoff: redactedHandoff,
          authorizationID,
        });
        pendingCompletions.set(pendingKey(input), {
          redactedExport,
          artifactID: opaqueDigest(`${input.sessionID}\0${input.callID}`),
        });
        options.evidence = JSON.stringify(redactedManifest);
        options.handoff = redactedHandoff;
        options.completion_authorization = authorizationID;
        return;
      }
      if (output.args?.status === "unmet" && options.handoff != null) {
        options.handoff = redactHandoff(parseGoalHandoff(options.handoff, {
          status: "unmet",
          fallback: options.blocker,
        }));
      }
    },
    async "tool.execute.after"(input, output) {
      if (input.tool !== "update_goal" || input.args?.status !== "complete") return;
      const completion = pendingCompletions.get(pendingKey(input));
      if (!completion) {
        throw new Error("completion evidence persistence did not finish before goal closure");
      }
      pendingCompletions.delete(pendingKey(input));
      addCompletionEvidenceToOutput(
        output,
        completion.redactedExport,
        completion.artifactID,
      );
    },
  };
}

export default {
  id: "claude-config-goal-workflow-guard",
  server: createGoalWorkflowGuard,
};
