import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

function sessionDigest(sessionID) {
  return `sha256:${createHash("sha256").update(String(sessionID)).digest("hex")}`;
}

export function compactionObservationDirectory(environment = process.env) {
  const explicit = environment.OPENCODE_COMPACTION_OBSERVATION_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const stateHome = environment.XDG_STATE_HOME?.trim() || path.join(homedir(), ".local", "state");
  return path.join(stateHome, "opencode", "compaction-observations");
}

export async function recordCompactionObservation({
  sessionID,
  event,
  modelStrategy = "active-session",
  directory = compactionObservationDirectory(),
  observedAt = new Date(),
}) {
  if (typeof sessionID !== "string" || !sessionID) throw new Error("compaction observation requires a session ID");
  if (event !== "started" && event !== "autocontinue") throw new Error("compaction observation event is unsupported");
  if (modelStrategy !== "active-session") throw new Error("compaction must inherit the active session model");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const record = {
    schema_version: 1,
    event,
    observed_at: observedAt.toISOString(),
    session_sha256: sessionDigest(sessionID),
    model_strategy: modelStrategy,
  };
  const filename = `${sessionDigest(sessionID).slice("sha256:".length, 24)}--${observedAt.getTime()}--${randomUUID()}.json`;
  await writeFile(path.join(directory, filename), `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return record;
}

export async function createCompactionObservability(options = {}) {
  const modelStrategy = options.model_strategy ?? "active-session";
  if (modelStrategy !== "active-session") throw new Error("compaction observer only supports active-session model inheritance");
  return {
    async "experimental.session.compacting"(input) {
      if (typeof input?.sessionID !== "string") return;
      await recordCompactionObservation({ sessionID: input.sessionID, event: "started", modelStrategy });
    },
    async "experimental.compaction.autocontinue"(input) {
      if (typeof input?.sessionID !== "string") return;
      await recordCompactionObservation({ sessionID: input.sessionID, event: "autocontinue", modelStrategy });
    },
  };
}

export default {
  id: "opencode-compaction-observability",
  server: createCompactionObservability,
};
