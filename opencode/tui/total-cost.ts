import type { Session } from "@opencode-ai/sdk/v2"

export type CostSession = Pick<Session, "id" | "parentID" | "cost">

export type CostSummary = {
	rootCost: number
	subagentCost: number
	subagentCount: number
	totalCost: number
}

export function summarizeCostTree(rootID: string, sessions: readonly CostSession[]): CostSummary {
	const sessionsByID = new Map(sessions.map((session) => [session.id, session]))
	const childrenByParentID = new Map<string, CostSession[]>()

	for (const session of sessions) {
		if (!session.parentID) continue
		const siblings = childrenByParentID.get(session.parentID)
		if (siblings) {
			siblings.push(session)
		} else {
			childrenByParentID.set(session.parentID, [session])
		}
	}

	const root = sessionsByID.get(rootID)
	if (!root) {
		return {
			rootCost: 0,
			subagentCost: 0,
			subagentCount: 0,
			totalCost: 0,
		}
	}

	const visited = new Set<string>()
	let subagentCost = 0
	let subagentCount = 0

	function visit(session: CostSession, isRoot: boolean) {
		if (visited.has(session.id)) return 0
		visited.add(session.id)

		const cost = session.cost ?? 0
		if (!isRoot) {
			subagentCost += cost
			subagentCount += 1
		}

		return cost + (childrenByParentID.get(session.id) ?? []).reduce(
			(total, child) => total + visit(child, false),
			0,
		)
	}

	const rootCost = root.cost ?? 0
	visit(root, true)

	return {
		rootCost,
		subagentCost,
		subagentCount,
		totalCost: rootCost + subagentCost,
	}
}
