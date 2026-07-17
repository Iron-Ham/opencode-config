/** @jsxImportSource @opentui/solid */
import type { TuiCommand, TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"

type GoalCheckpoint = {
  summary: string
  timestamp: number
}

type GoalHistoryEntry = {
  type: string
  detail: string
  timestamp: number
}

type GoalSnapshot = {
  sessionID: string
  objective: string
  status: "active" | "paused" | "budgetLimited" | "usageLimited" | "complete" | "unmet"
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
  completionEvidence?: string | null
  blocker?: string | null
  closedAt?: number | null
  continuationFailures: number
  lastStatus: string | null
  maxAutoTurns: number | null
  maxDurationSeconds: number | null
  noProgressTokenThreshold: number | null
  maxNoProgressTurns: number | null
  noProgressTurns: number
  budgetWrapupSent: boolean
  stopReason: string | null
  history: GoalHistoryEntry[]
  checkpoints: GoalCheckpoint[]
  lastCheckpoint: GoalCheckpoint | null
  lastAssistantText: string
  lastAssistantMessageID: string
  autoTurns: number
  lastContinuationAt: number | null
  remainingTokens: number | null
  sampledAt?: number
}

type GoalToolPart = {
  type: string
  tool?: string
  state?: {
    status?: string
    output?: string
  }
  tokens?: unknown
}

type SessionMessage = {
  id: string
}

type GoalSessionState = {
  goal: GoalSnapshot | null
  messageIndex: number
}

type ModernTuiApi = TuiPluginApi & {
  keymap?: {
    registerLayer?: (layer: {
      commands: {
        namespace: string
        name: string
        title: string
        desc?: string
        category?: string
        run?: () => void
      }[]
      bindings?: unknown[]
    }) => () => void
  }
}

const goalCache = new Map<string, GoalSnapshot>()

function goalSnapshotKey(sessionID: string) {
  return `goal-mode.snapshot.${sessionID}`
}

function cachedGoal(api: TuiPluginApi, sessionID: string) {
  const memory = goalCache.get(sessionID)
  if (memory) return memory
  const persisted = api.kv?.get(goalSnapshotKey(sessionID), null)
  return isGoalSnapshot(persisted) ? persisted : null
}

function cacheGoal(api: TuiPluginApi, sessionID: string, goal: GoalSnapshot | null) {
  if (goal) {
    goalCache.set(sessionID, goal)
    api.kv?.set(goalSnapshotKey(sessionID), goal)
    return
  }
  goalCache.delete(sessionID)
  api.kv?.set(goalSnapshotKey(sessionID), null)
}

function currentSessionID(api: TuiPluginApi) {
  const route = api.route.current
  if (route.name !== "session") return undefined
  const sessionID = route.params?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function toast(api: TuiPluginApi, message: string, variant: "info" | "success" | "warning" | "error" = "info") {
  api.ui.toast({ title: "Goal", message, variant, duration: 2500 })
}

async function sendGoalPrompt(api: TuiPluginApi, sessionID: string, text: string) {
  await api.client.session.promptAsync({
    sessionID,
    parts: [{ type: "text", text }],
  })
}

function refreshGoalPrompt() {
  return "Call get_goal for this session and report the current goal state briefly."
}

function clearGoalPrompt() {
  return "Clear the current session goal by calling clear_goal. Report whether a goal was cleared."
}

function pauseGoalPrompt() {
  return 'Pause the current session goal by calling update_goal_status with status "paused". Report the result briefly.'
}

function resumeGoalPrompt() {
  return 'Resume the current session goal by calling update_goal_status with status "active", then continue working toward it.'
}

function historyGoalPrompt() {
  return "Call get_goal_history for this session and report the current goal history briefly."
}

function actionOption(api: TuiPluginApi, sessionID: string, title: string, value: string, description: string, prompt: string) {
  return {
    title,
    value,
    description,
    onSelect: () => {
      void sendGoalPrompt(api, sessionID, prompt)
        .then(() => api.ui.dialog.clear())
        .catch((error) => toast(api, error instanceof Error ? error.message : String(error), "error"))
    },
  }
}

function showSummary(api: TuiPluginApi, sessionID: string, goal: GoalSnapshot | null) {
  const DialogSelect = api.ui.DialogSelect
  const options = [
    actionOption(api, sessionID, "Refresh", "refresh", "Ask the agent to read the current goal state", refreshGoalPrompt()),
    ...(goal
      ? [
          actionOption(api, sessionID, "History", "history", "Ask the agent to show lifecycle history", historyGoalPrompt()),
          ...(goal.status === "active"
            ? [actionOption(api, sessionID, "Pause", "pause", "Pause auto-continuation without clearing", pauseGoalPrompt())]
            : []),
          ...(goal.status === "paused" || goal.status === "budgetLimited" || goal.status === "usageLimited"
            ? [actionOption(api, sessionID, "Resume", "resume", "Resume the goal and continue", resumeGoalPrompt())]
            : []),
          actionOption(api, sessionID, "Clear", "clear", "Ask the agent to clear this session goal", clearGoalPrompt()),
        ]
      : []),
  ]

  api.ui.dialog.setSize("large")
  api.ui.dialog.replace(() =>
    DialogSelect({
      title: "Goal",
      placeholder: formatGoal(goal),
      options,
      onSelect(option) {
        option.onSelect?.()
      },
    }),
  )
}

function sessionIDOrToast(api: TuiPluginApi) {
  const sessionID = currentSessionID(api)
  if (!sessionID) toast(api, "Open a session before viewing goal state.", "warning")
  return sessionID
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const paddedSecs = String(secs).padStart(2, "0")
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSecs}`
  return `${minutes}:${paddedSecs}`
}

function formatDurationBadge(seconds: number) {
  return formatDuration(seconds)
}

function currentEpochSeconds() {
  return Math.floor(Date.now() / 1000)
}

export function liveTimeUsedSeconds(goal: GoalSnapshot, nowSeconds = currentEpochSeconds()) {
  const baseSeconds = Math.max(0, Math.floor(goal.timeUsedSeconds))
  if (goal.status !== "active") return baseSeconds
  if (typeof goal.sampledAt !== "number") return baseSeconds
  return baseSeconds + Math.max(0, Math.floor(nowSeconds - goal.sampledAt))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isCheckpoint(value: unknown): value is GoalCheckpoint {
  return isRecord(value) && typeof value.summary === "string" && typeof value.timestamp === "number"
}

function isHistoryEntry(value: unknown): value is GoalHistoryEntry {
  return isRecord(value) && typeof value.type === "string" && typeof value.detail === "string" && typeof value.timestamp === "number"
}

function isGoalSnapshot(value: unknown): value is GoalSnapshot {
  if (!isRecord(value)) return false
  if (typeof value.sessionID !== "string") return false
  if (typeof value.objective !== "string") return false
  if (!["active", "paused", "budgetLimited", "usageLimited", "complete", "unmet"].includes(String(value.status))) return false
  if (value.tokenBudget !== null && typeof value.tokenBudget !== "number") return false
  if (typeof value.tokensUsed !== "number") return false
  if (typeof value.timeUsedSeconds !== "number") return false
  if (typeof value.createdAt !== "number") return false
  if (typeof value.updatedAt !== "number") return false
  if (value.completionEvidence != null && typeof value.completionEvidence !== "string") return false
  if (value.blocker != null && typeof value.blocker !== "string") return false
  if (value.closedAt != null && typeof value.closedAt !== "number") return false
  if (typeof value.continuationFailures !== "number") return false
  if (value.lastStatus != null && typeof value.lastStatus !== "string") return false
  if (value.maxAutoTurns !== null && typeof value.maxAutoTurns !== "number") return false
  if (value.maxDurationSeconds !== null && typeof value.maxDurationSeconds !== "number") return false
  if (value.noProgressTokenThreshold !== null && typeof value.noProgressTokenThreshold !== "number") return false
  if (value.maxNoProgressTurns !== null && typeof value.maxNoProgressTurns !== "number") return false
  if (typeof value.noProgressTurns !== "number") return false
  if (typeof value.budgetWrapupSent !== "boolean") return false
  if (value.stopReason !== null && typeof value.stopReason !== "string") return false
  if (!Array.isArray(value.history) || !value.history.every(isHistoryEntry)) return false
  if (!Array.isArray(value.checkpoints) || !value.checkpoints.every(isCheckpoint)) return false
  if (value.lastCheckpoint !== null && !isCheckpoint(value.lastCheckpoint)) return false
  if (typeof value.lastAssistantText !== "string") return false
  if (typeof value.lastAssistantMessageID !== "string") return false
  if (typeof value.autoTurns !== "number") return false
  if (value.lastContinuationAt != null && typeof value.lastContinuationAt !== "number") return false
  if (value.remainingTokens !== null && typeof value.remainingTokens !== "number") return false
  if (value.sampledAt != null && typeof value.sampledAt !== "number") return false
  return true
}

function parseGoalToolOutput(part: GoalToolPart): GoalSnapshot | null | undefined {
  if (part.type !== "tool") return undefined
  if (
    ![
      "get_goal",
      "get_goal_history",
      "create_goal",
      "set_goal",
      "update_goal",
      "update_goal_objective",
      "update_goal_status",
      "clear_goal",
    ].includes(part.tool ?? "")
  )
    return undefined
  if (part.state?.status !== "completed") return undefined
  if (part.tool === "clear_goal") return null
  if (typeof part.state.output !== "string") return undefined

  try {
    const parsed: unknown = JSON.parse(part.state.output)
    if (!isRecord(parsed)) return undefined
    if (parsed.goal === null) return null
    return isGoalSnapshot(parsed.goal) ? parsed.goal : undefined
  } catch {
    return undefined
  }
}

export function goalStateFromSession(api: TuiPluginApi, sessionID: string): GoalSessionState {
  const messages = [...api.state.session.messages(sessionID)] as SessionMessage[]
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message) continue
    const parts = [...api.state.part(message.id)].reverse() as GoalToolPart[]
    for (const part of parts) {
      const goal = parseGoalToolOutput(part)
      if (goal !== undefined) {
        cacheGoal(api, sessionID, goal)
        return { goal, messageIndex }
      }
    }
  }
  return { goal: cachedGoal(api, sessionID), messageIndex: -1 }
}

function goalFromSession(api: TuiPluginApi, sessionID: string) {
  return goalStateFromSession(api, sessionID).goal
}

function formatGoal(goal: GoalSnapshot | null) {
  if (!goal) return "No recent goal state found in this session."
  const lines = [
    `Objective: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Time used: ${formatDuration(goal.timeUsedSeconds)}`,
    `Tokens: ${goal.tokensUsed}${goal.tokenBudget == null ? "" : `/${goal.tokenBudget}`}`,
    `Auto-continues: ${goal.autoTurns}${goal.maxAutoTurns == null ? "" : `/${goal.maxAutoTurns}`}`,
  ]
  if (goal.remainingTokens != null) lines.push(`Tokens remaining: ${goal.remainingTokens}`)
  if (goal.maxDurationSeconds != null) lines.push(`Duration limit: ${formatDuration(goal.maxDurationSeconds)}`)
  if (goal.noProgressTurns > 0) lines.push(`No-progress turns: ${goal.noProgressTurns}`)
  if (goal.lastCheckpoint) lines.push(`Latest checkpoint: ${goal.lastCheckpoint.summary}`)
  if (goal.stopReason) lines.push(`Stop reason: ${goal.stopReason}`)
  if (goal.lastStatus) lines.push(`Last status: ${goal.lastStatus}`)
  if (goal.completionEvidence) lines.push(`Completion evidence: ${goal.completionEvidence}`)
  if (goal.blocker) lines.push(`Blocker: ${goal.blocker}`)
  return lines.join("\n")
}

function GoalSidebar(props: { api: TuiPluginApi; sessionID: string }) {
  const theme = () => props.api.theme.current
  const [nowSeconds, setNowSeconds] = createSignal(currentEpochSeconds())
  const timer = setInterval(() => setNowSeconds(currentEpochSeconds()), 1000)
  onCleanup(() => clearInterval(timer))
  const state = createMemo(() => {
    props.api.state.session.messages(props.sessionID)
    return goalStateFromSession(props.api, props.sessionID)
  })
  const goal = createMemo(() => state().goal)
  const elapsed = createMemo(() => {
    const value = goal()
    return value ? liveTimeUsedSeconds(value, nowSeconds()) : 0
  })
  const objective = createMemo(() => goal()?.objective ?? "")

  return (
    <Show when={goal()}>
      {(value: () => GoalSnapshot) => (
        <Show
          when={value().status === "complete" || value().status === "unmet"}
          fallback={
            <box>
              <text fg={theme().text}>
                <b>Goal</b>
              </text>
              <text fg={theme().textMuted}>Status: {value().status}</text>
              <text fg={theme().textMuted}>Time: {formatDuration(elapsed())}</text>
              <text fg={theme().textMuted}>
                Tokens: {value().tokensUsed}
                <Show when={value().tokenBudget}>{(budget: () => number) => <>/{budget()}</>}</Show>
              </text>
              <text fg={theme().textMuted}>
                Auto-continues: {value().autoTurns}
                <Show when={value().maxAutoTurns}>{(budget: () => number) => <>/{budget()}</>}</Show>
              </text>
              <Show when={value().lastCheckpoint}>
                {(checkpoint: () => GoalCheckpoint) => <text fg={theme().textMuted}>Checkpoint: {checkpoint().summary}</text>}
              </Show>
              <Show when={value().stopReason}>
                {(reason: () => string) => <text fg={theme().textMuted}>Stop: {reason()}</text>}
              </Show>
              <Show when={value().lastStatus}>
                {(status: () => string) => <text fg={theme().textMuted}>{status()}</text>}
              </Show>
              <text fg={theme().textMuted}>{objective()}</text>
            </box>
          }
        >
          <text fg={value().status === "complete" ? theme().primary : theme().textMuted}>
            <b>{value().status === "complete" ? "Goal achieved" : "Goal unmet"}</b> (
            {formatDurationBadge(elapsed())})
          </text>
        </Show>
      )}
    </Show>
  )
}

function registerGoalCommand(api: TuiPluginApi, command: TuiCommand) {
  const modern = api as ModernTuiApi
  if (modern.keymap?.registerLayer) {
    modern.keymap.registerLayer({
      commands: [
        {
          namespace: "palette",
          name: command.value,
          title: command.title,
          desc: command.description,
          category: command.category,
          run: command.onSelect,
        },
      ],
      bindings: [],
    })
    return
  }
  api.command?.register(() => [command])
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 125,
    slots: {
      sidebar_content(_ctx, props) {
        return <GoalSidebar api={api} sessionID={props.session_id} />
      },
    },
  })

  registerGoalCommand(api, {
    title: "Goal",
    value: "goal.show",
    category: "Goal",
    description: "View, pause, resume, or clear the long-running session goal",
    onSelect: () => {
      const sessionID = sessionIDOrToast(api)
      if (!sessionID) return
      showSummary(api, sessionID, goalFromSession(api, sessionID))
    },
  })
}

const plugin: TuiPluginModule = {
  id: "local.goal-mode.tui",
  tui,
}

export default plugin
