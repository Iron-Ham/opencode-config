/**
 * Native OS notifications for OpenCode.
 *
 * Notifications are limited to events that need human attention: completed
 * sessions, errors, permissions, and questions.
 */

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import detectTerminal from "detect-terminal"
import notifier from "node-notifier"
import type { OpencodeClient } from "./kdco-primitives/types"
import { resolveCmuxNotificationCommand, sendCmuxNotification } from "./notify/cmux"
import { sendDesktopNotificationByPlatform, sendNotificationWithFallback } from "./notify/backend"

interface NotifyConfig {
	notifyChildSessions: boolean
	sounds: {
		idle: string
		error: string
		permission: string
		question?: string
	}
	quietHours: {
		enabled: boolean
		start: string
		end: string
	}
	terminal?: string
}

interface TerminalInfo {
	name: string | null
	bundleId: string | null
	processName: string | null
}

interface NotificationOptions {
	title: string
	message: string
	subtitle?: string
	sound: string
	terminalInfo: TerminalInfo
}

interface NotificationRuntime {
	preferCmux: boolean
	cmuxCommand?: string
}

const DEFAULT_CONFIG: NotifyConfig = {
	notifyChildSessions: false,
	sounds: {
		idle: "Glass",
		error: "Basso",
		permission: "Submarine",
	},
	quietHours: {
		enabled: false,
		start: "22:00",
		end: "08:00",
	},
}

const TERMINAL_PROCESS_NAMES: Record<string, string> = {
	ghostty: "Ghostty",
	kitty: "kitty",
	iterm: "iTerm2",
	iterm2: "iTerm2",
	wezterm: "WezTerm",
	alacritty: "Alacritty",
	terminal: "Terminal",
	apple_terminal: "Terminal",
	hyper: "Hyper",
	warp: "Warp",
	vscode: "Code",
	"vscode-insiders": "Code - Insiders",
}

async function loadConfig(): Promise<NotifyConfig> {
	const configPath = path.join(os.homedir(), ".config", "opencode", "kdco-notify.json")

	try {
		const content = await fs.readFile(configPath, "utf8")
		const userConfig = JSON.parse(content) as Partial<NotifyConfig>
		return {
			...DEFAULT_CONFIG,
			...userConfig,
			sounds: { ...DEFAULT_CONFIG.sounds, ...userConfig.sounds },
			quietHours: { ...DEFAULT_CONFIG.quietHours, ...userConfig.quietHours },
		}
	} catch {
		return DEFAULT_CONFIG
	}
}

async function runOsascript(script: string): Promise<string | null> {
	if (process.platform !== "darwin") return null

	try {
		const proc = Bun.spawn(["osascript", "-e", script], { stdout: "pipe", stderr: "pipe" })
		const output = await new Response(proc.stdout).text()
		return output.trim()
	} catch {
		return null
	}
}

async function detectTerminalInfo(config: NotifyConfig): Promise<TerminalInfo> {
	const terminalName = config.terminal || detectTerminal() || null
	if (!terminalName) return { name: null, bundleId: null, processName: null }

	const processName = TERMINAL_PROCESS_NAMES[terminalName.toLowerCase()] || terminalName
	const bundleId = await runOsascript(`id of application "${processName}"`)
	return { name: terminalName, bundleId, processName }
}

async function isTerminalFocused(terminalInfo: TerminalInfo): Promise<boolean> {
	if (!terminalInfo.processName || process.platform !== "darwin") return false

	const frontmost = await runOsascript(
		'tell application "System Events" to get name of first application process whose frontmost is true',
	)
	return frontmost?.toLowerCase() === terminalInfo.processName.toLowerCase()
}

function isQuietHours(config: NotifyConfig): boolean {
	if (!config.quietHours.enabled) return false

	const now = new Date()
	const currentMinutes = now.getHours() * 60 + now.getMinutes()
	const [startHour, startMin] = config.quietHours.start.split(":").map(Number)
	const [endHour, endMin] = config.quietHours.end.split(":").map(Number)
	const startMinutes = startHour * 60 + startMin
	const endMinutes = endHour * 60 + endMin

	if (startMinutes > endMinutes) {
		return currentMinutes >= startMinutes || currentMinutes < endMinutes
	}

	return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

async function isParentSession(client: OpencodeClient, sessionID: string): Promise<boolean> {
	try {
		const session = await client.session.get({ path: { id: sessionID } })
		return !session.data?.parentID
	} catch {
		return true
	}
}

async function sendDesktopNotification(options: NotificationOptions): Promise<void> {
	const { title, message, sound, terminalInfo } = options
	await sendDesktopNotificationByPlatform({
		platform: process.platform,
		title,
		message,
		subtitle: options.subtitle,
		sound,
		senderBundleId: terminalInfo.bundleId,
		sendNodeNotifierNotification: () => notifier.notify({ title, message, sound }),
	})
}

async function sendNotification(
	options: NotificationOptions,
	runtime: NotificationRuntime,
): Promise<void> {
	await sendNotificationWithFallback({
		preferCmux: runtime.preferCmux,
		tryCmuxNotify: () =>
			sendCmuxNotification(
				{
					title: options.title,
					subtitle: options.subtitle,
					body: options.message,
				},
				{ cmuxCommand: runtime.cmuxCommand },
			),
		sendDesktopNotification: () => sendDesktopNotification(options),
	})
}

async function shouldNotify(
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	checkFocus: boolean,
): Promise<boolean> {
	if (isQuietHours(config)) return false
	if (checkFocus && (await isTerminalFocused(terminalInfo))) return false
	return true
}

async function notifySessionIdle(
	client: OpencodeClient,
	sessionID: string,
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	runtime: NotificationRuntime,
): Promise<void> {
	if (!config.notifyChildSessions && !(await isParentSession(client, sessionID))) return
	if (!(await shouldNotify(config, terminalInfo, true))) return

	let sessionTitle = "Task"
	try {
		const session = await client.session.get({ path: { id: sessionID } })
		if (session.data?.title) sessionTitle = session.data.title.slice(0, 50)
	} catch {
		// Use the default title when session metadata is unavailable.
	}

	await sendNotification(
		{
			title: "Ready for review",
			message: sessionTitle,
			subtitle: sessionTitle,
			sound: config.sounds.idle,
			terminalInfo,
		},
		runtime,
	)
}

async function notifySessionError(
	client: OpencodeClient,
	sessionID: string,
	error: string | undefined,
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	runtime: NotificationRuntime,
): Promise<void> {
	if (!config.notifyChildSessions && !(await isParentSession(client, sessionID))) return
	if (!(await shouldNotify(config, terminalInfo, true))) return

	await sendNotification(
		{
			title: "Something went wrong",
			message: error?.slice(0, 100) || "Something went wrong",
			sound: config.sounds.error,
			terminalInfo,
		},
		runtime,
	)
}

async function notifyHuman(
	title: string,
	config: NotifyConfig,
	terminalInfo: TerminalInfo,
	runtime: NotificationRuntime,
): Promise<void> {
	if (!(await shouldNotify(config, terminalInfo, title !== "Question for you"))) return

	await sendNotification(
		{
			title,
			message: "OpenCode needs your input",
			sound: title === "Question for you" ? config.sounds.question ?? config.sounds.permission : config.sounds.permission,
			terminalInfo,
		},
		runtime,
	)
}

const NotifyPlugin: Plugin = async ({ client }) => {
	const config = await loadConfig()
	const terminalInfo = await detectTerminalInfo(config)
	const cmuxCommand = resolveCmuxNotificationCommand()
	const runtime: NotificationRuntime = { preferCmux: Boolean(cmuxCommand), cmuxCommand }

	return {
		"tool.execute.before": async (input: { tool: string }) => {
			if (input.tool === "question") {
				await notifyHuman("Question for you", config, terminalInfo, runtime)
			}
		},
		event: async ({ event }: { event: Event }): Promise<void> => {
			const runtimeEvent = event as { type: string; properties: Record<string, unknown> }
			const sessionID = typeof runtimeEvent.properties.sessionID === "string"
				? runtimeEvent.properties.sessionID
				: undefined

			switch (runtimeEvent.type) {
				case "session.idle":
					if (sessionID) await notifySessionIdle(client as OpencodeClient, sessionID, config, terminalInfo, runtime)
					break
				case "session.error": {
					if (!sessionID) break
					const error = runtimeEvent.properties.error
					const message = typeof error === "string" ? error : error ? String(error) : undefined
					await notifySessionError(client as OpencodeClient, sessionID, message, config, terminalInfo, runtime)
					break
				}
				case "permission.updated":
				case "permission.asked":
					await notifyHuman("Waiting for you", config, terminalInfo, runtime)
					break
				case "question.asked":
					await notifyHuman("Question for you", config, terminalInfo, runtime)
					break
			}
		},
	}
}

export default NotifyPlugin
