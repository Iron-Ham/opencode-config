/** @jsxImportSource @opentui/solid */

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

import { summarizeCostTree, type CostSession, type CostSummary } from "../tui/total-cost"

type CostViewProps = {
	api: TuiPluginApi
	sessionID: string
	revision: () => number
}

const money = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 4,
})

function formatCost(value: number) {
	return money.format(value)
}

async function getSession(api: TuiPluginApi, sessionID: string): Promise<Session | undefined> {
	const cached = api.state.session.get(sessionID)
	if (cached) return cached
	const result = await api.client.session.get({ sessionID }, { throwOnError: true })
	return result.data
}

async function loadSessionTree(api: TuiPluginApi, sessionID: string): Promise<CostSession[]> {
	let root = await getSession(api, sessionID)
	const ancestors = new Set<string>()

	while (root?.parentID && !ancestors.has(root.id)) {
		ancestors.add(root.id)
		root = await getSession(api, root.parentID)
	}

	if (!root) return []

	const sessions: CostSession[] = [root]
	const pending = [root]
	const visited = new Set([root.id])

	while (pending.length > 0) {
		const parent = pending.shift()
		if (!parent) continue

		const result = await api.client.session.children(
			{ sessionID: parent.id },
			{ throwOnError: true },
		)
		for (const child of result.data) {
			if (visited.has(child.id)) continue
			visited.add(child.id)
			sessions.push(child)
			pending.push(child)
		}
	}

	return sessions
}

function CostView(props: CostViewProps) {
	const [summary, setSummary] = createSignal<CostSummary>()
	const [error, setError] = createSignal<string>()
	let request = 0

	createEffect(() => {
		props.revision()
		const currentRequest = ++request
		setError()
		void loadSessionTree(props.api, props.sessionID)
			.then((sessions) => {
				if (currentRequest !== request) return
				setSummary(summarizeCostTree(sessions[0]?.id ?? "", sessions))
			})
			.catch((cause: unknown) => {
				if (currentRequest !== request) return
				setError(cause instanceof Error ? cause.message : String(cause))
			})
	})

	onCleanup(() => {
		request += 1
	})

	const label = createMemo(() => {
		const value = summary()
		if (!value) return error() ? "cost unavailable" : "cost …"

		const parts = [`session ${formatCost(value.rootCost)}`]
		if (value.subagentCount > 0) {
			parts.push(`agents ${formatCost(value.subagentCost)}`)
		}
		parts.push(`total ${formatCost(value.totalCost)}`)
		return parts.join(" · ")
	})

	return <text fg={props.api.theme.current.textMuted}>{label()}</text>
}

const tui: TuiPlugin = async (api) => {
	const [revision, setRevision] = createSignal(0)
	let refreshTimer: ReturnType<typeof setTimeout> | undefined

	const scheduleRefresh = () => {
		if (refreshTimer) clearTimeout(refreshTimer)
		refreshTimer = setTimeout(() => {
			refreshTimer = undefined
			setRevision((value) => value + 1)
		}, 250)
	}

	for (const event of [
		"message.updated",
		"session.created",
		"session.updated",
		"session.deleted",
		"session.compacted",
	] as const) {
		api.event.on(event, scheduleRefresh)
	}

	api.lifecycle.onDispose(() => {
		if (refreshTimer) clearTimeout(refreshTimer)
	})

	api.slots.register({
		slots: {
			session_prompt_right(_context, props) {
				return <CostView api={api} sessionID={props.session_id} revision={revision} />
			},
		},
	})
}

export default {
	id: "claude-config-opencode-total-cost",
	tui,
}
