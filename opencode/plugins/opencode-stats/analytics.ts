import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeUserMessageMetrics } from "@oh-my-pi/omp-stats/user-metrics";

type Range = "1h" | "24h" | "7d" | "30d" | "90d" | "all";
type RequestRow = Record<string, any>;

const sourcePath =
	process.env.OPENCODE_DATABASE_PATH ??
	`${process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`}/opencode/opencode.db`;
const statsPath =
	process.env.OPENCODE_STATS_DATABASE_PATH ??
	`${process.env.XDG_STATE_HOME ?? `${process.env.HOME}/.local/state`}/opencode/stats-v2.db`;
const configDir =
	process.env.OPENCODE_CONFIG_DIR ??
	dirname(dirname(fileURLToPath(import.meta.url)));
const ranges: Record<Exclude<Range, "all">, number> = {
	"1h": 3_600_000,
	"24h": 86_400_000,
	"7d": 604_800_000,
	"30d": 2_592_000_000,
	"90d": 7_776_000_000,
};

function start(range: string | null): number {
	return range === "all"
		? 0
		: Date.now() -
				(ranges[(range ?? "24h") as Exclude<Range, "all">] ?? ranges["24h"]);
}
function bucket(range: string | null): number {
	return range === "1h" ? 300_000 : range === "24h" ? 3_600_000 : 86_400_000;
}
function number(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}
function json(value: string): any {
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}
function modelPrices(): Map<string, any> {
	const prices = new Map<string, any>();
	try {
		const config = json(readFileSync(join(configDir, "opencode.json"), "utf8"));
		for (const [provider, definition] of Object.entries(
			config.provider ?? {},
		)) {
			for (const [model, modelDefinition] of Object.entries(
				(definition as any).models ?? {},
			)) {
				if ((modelDefinition as any).cost)
					prices.set(`${provider}\0${model}`, (modelDefinition as any).cost);
			}
		}
	} catch {}
	return prices;
}
const prices = modelPrices();
function costParts(row: RequestRow) {
	const price = prices.get(`${row.provider}\0${row.model}`);
	if (!price)
		return {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: row.cost,
		};
	const calculated = {
		input: (row.input * number(price.input)) / 1_000_000,
		output:
			((row.output + number(row.reasoning)) * number(price.output)) / 1_000_000,
		cacheRead: (row.cacheRead * number(price.cache_read)) / 1_000_000,
		cacheWrite: (row.cacheWrite * number(price.cache_write)) / 1_000_000,
	};
	const calculatedTotal =
		calculated.input +
		calculated.output +
		calculated.cacheRead +
		calculated.cacheWrite;
	const scale = calculatedTotal ? row.cost / calculatedTotal : 0;
	return {
		input: calculated.input * scale,
		output: calculated.output * scale,
		cacheRead: calculated.cacheRead * scale,
		cacheWrite: calculated.cacheWrite * scale,
		total: row.cost,
	};
}
function usage(row: RequestRow) {
	return {
		input: row.input,
		output: row.output,
		cacheRead: row.cacheRead,
		cacheWrite: row.cacheWrite,
		totalTokens: row.input + row.output + row.cacheRead + row.cacheWrite,
		premiumRequests: 0,
		cost: costParts(row),
	};
}

function initialize(db: Database) {
	db.run(`CREATE TABLE IF NOT EXISTS oc_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS oc_requests(id TEXT PRIMARY KEY,session_id TEXT,folder TEXT,project TEXT,parent_session TEXT,model TEXT,provider TEXT,agent TEXT,agent_type TEXT,timestamp INTEGER,completed INTEGER,duration INTEGER,stop_reason TEXT,error TEXT,input INTEGER,output INTEGER,reasoning INTEGER,cache_read INTEGER,cache_write INTEGER,cost REAL,metadata TEXT);
	CREATE TABLE IF NOT EXISTS oc_tools(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,tool TEXT,skill TEXT,status TEXT,timestamp INTEGER,completed INTEGER,args_chars INTEGER,result_chars INTEGER);
	CREATE TABLE IF NOT EXISTS oc_behavior(id TEXT PRIMARY KEY,timestamp INTEGER,model TEXT,provider TEXT,folder TEXT,chars INTEGER,words INTEGER,yelling INTEGER,profanity INTEGER,anguish INTEGER,negation INTEGER,repetition INTEGER,blame INTEGER);
	CREATE INDEX IF NOT EXISTS oc_requests_timestamp ON oc_requests(timestamp);
	CREATE INDEX IF NOT EXISTS oc_tools_timestamp ON oc_tools(timestamp);
	CREATE INDEX IF NOT EXISTS oc_behavior_timestamp ON oc_behavior(timestamp);`);
	db.run(
		"UPDATE oc_requests SET metadata=NULL WHERE metadata LIKE '%responseBody%' OR metadata LIKE '%headers%'",
	);
	db.run(
		"UPDATE oc_requests SET error='Provider request failed' WHERE error LIKE '{%'",
	);
	if (!db.query("SELECT value FROM oc_meta WHERE key='privacy-v2'").get()) {
		db.run("UPDATE oc_requests SET metadata=NULL");
		db.run("INSERT INTO oc_meta VALUES('privacy-v2','1')");
	}
}

export function sync() {
	mkdirSync(dirname(statsPath), { recursive: true, mode: 0o700 });
	const source = new Database(sourcePath, { readonly: true }),
		db = new Database(statsPath, { create: true });
	chmodSync(statsPath, 0o600);
	initialize(db);
	const stamp = String(
		(
			source
				.query(
					"SELECT max(value) stamp FROM (SELECT max(time_updated) value FROM session UNION ALL SELECT max(time_updated) FROM message UNION ALL SELECT max(time_updated) FROM part)",
				)
				.get() as any
		)?.stamp ?? 0,
	);
	const previous = text(
		(
			db
				.query("SELECT value FROM oc_meta WHERE key='source-stamp'")
				.get() as any
		)?.value,
	);
	const since = number(previous);
	const requestInsert = db.prepare(
		`INSERT OR REPLACE INTO oc_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	);
	let processed = 0;
	for (const row of source
		.query(
			`SELECT m.*,s.directory,s.project_id,s.parent_id FROM message m JOIN session s ON s.id=m.session_id WHERE m.time_updated>=?`,
		)
		.all(since) as any[]) {
		const data = json(row.data),
			info = data.info ?? data;
		if ((info.role ?? data.role) !== "assistant") continue;
		const tokens = info.tokens ?? data.tokens ?? {},
			created = number(
				info.time?.created ?? data.time?.created ?? row.time_created,
			),
			completed = number(info.time?.completed ?? data.time?.completed) || null;
		const error = info.error ?? data.error,
			errorMessage = error
				? text(error.data?.message) ||
					text(error.message) ||
					text(error.name) ||
					"Provider request failed"
				: null;
		const model = info.modelID ?? data.model?.id ?? "unknown",
			provider = info.providerID ?? data.model?.providerID ?? "unknown",
			agent = info.agent ?? data.agent ?? "unknown";
		requestInsert.run(
			row.id,
			row.session_id,
			row.directory,
			row.project_id,
			row.parent_id,
			model,
			provider,
			agent,
			row.parent_id ? "subagent" : /advisor/i.test(agent) ? "advisor" : "main",
			created,
			completed,
			completed ? completed - created : null,
			info.finish ?? data.finish ?? (error ? "error" : "unknown"),
			errorMessage,
			number(tokens.input),
			number(tokens.output),
			number(tokens.reasoning),
			number(tokens.cache?.read),
			number(tokens.cache?.write),
			number(info.cost ?? data.cost),
			JSON.stringify({
				id: row.id,
				sessionID: row.session_id,
				model,
				provider,
				agent,
				created,
				completed,
				finish: info.finish ?? data.finish ?? null,
			}),
		);
		if (info.parentID)
			db.run("UPDATE oc_behavior SET model=?,provider=? WHERE id=?", [
				model,
				provider,
				info.parentID,
			]);
		processed++;
	}
	const toolInsert = db.prepare(
		`INSERT OR REPLACE INTO oc_tools VALUES(?,?,?,?,?,?,?,?,?,?)`,
	);
	for (const row of source
		.query(`SELECT p.* FROM part p WHERE p.time_updated>=?`)
		.all(since) as any[]) {
		const data = json(row.data);
		if (data.type !== "tool") continue;
		const state = data.state ?? {},
			created = number(
				state.time?.start ?? data.time?.created ?? row.time_created,
			),
			completed = number(state.time?.end ?? data.time?.completed) || null;
		const result = state.status === "error" ? state.error : state.output;
		toolInsert.run(
			row.id,
			row.message_id,
			row.session_id,
			data.tool ?? "unknown",
			data.tool === "skill" ? (state.input?.name ?? null) : null,
			state.status ?? "unknown",
			created,
			completed,
			JSON.stringify(state.input ?? {}).length,
			typeof result === "string"
				? result.length
				: JSON.stringify(result ?? "").length,
		);
	}
	const behaviorInsert = db.prepare(
		`INSERT OR REPLACE INTO oc_behavior VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
	);
	for (const row of source
		.query(
			`SELECT m.*,s.directory FROM message m JOIN session s ON s.id=m.session_id WHERE m.time_updated>=? AND json_extract(m.data,'$.role')='user'`,
		)
		.all(since) as any[]) {
		const parts = source
			.query("SELECT data FROM part WHERE message_id=? ORDER BY time_created")
			.all(row.id) as any[];
		const body = parts
			.map((part) => {
				const value = json(part.data);
				return value.type === "text" ? text(value.text) : "";
			})
			.filter(Boolean)
			.join("\n");
		if (!body) continue;
		const child = source
			.query(
				"SELECT data FROM message WHERE session_id=? AND json_extract(data,'$.parentID')=? ORDER BY time_created LIMIT 1",
			)
			.get(row.session_id, row.id) as any;
		const response = child ? json(child.data) : {},
			metrics = computeUserMessageMetrics(body),
			created = number(json(row.data).time?.created ?? row.time_created);
		behaviorInsert.run(
			row.id,
			created,
			response.modelID ?? "unknown",
			response.providerID ?? "unknown",
			row.directory,
			metrics.chars,
			metrics.words,
			metrics.yelling,
			metrics.profanity,
			metrics.anguish,
			metrics.negation,
			metrics.repetition,
			metrics.blame,
		);
	}
	db.run(
		"INSERT INTO oc_meta VALUES('source-stamp',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		[stamp],
	);
	const totalMessages = number(
		(db.query("SELECT count(*) n FROM oc_requests").get() as any).n,
	);
	source.close();
	db.close();
	return { processed, files: 0, totalMessages };
}

function rows(range: string | null): RequestRow[] {
	const db = new Database(statsPath, { readonly: true });
	const result = (
		db
			.query(
				"SELECT id,session_id sessionFile,id entryId,folder,model,provider,'opencode' api,timestamp,duration,NULL ttft,stop_reason stopReason,error errorMessage,input,output,cache_read cacheRead,cache_write cacheWrite,cost,agent_type agentType,reasoning FROM oc_requests WHERE timestamp>=? ORDER BY timestamp",
			)
			.all(start(range)) as any[]
	).map((row) => ({ ...row, ...{ usage: usage(row) } }));
	db.close();
	return result;
}
function aggregate(list: RequestRow[]) {
	const result = {
		totalRequests: list.length,
		successfulRequests: 0,
		failedRequests: 0,
		errorRate: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
		totalCacheReadTokens: 0,
		totalCacheWriteTokens: 0,
		cacheRate: 0,
		totalCost: 0,
		totalPremiumRequests: 0,
		avgDuration: null as number | null,
		avgTtft: null as number | null,
		avgTokensPerSecond: null as number | null,
		firstTimestamp: list.at(0)?.timestamp ?? 0,
		lastTimestamp: list.at(-1)?.timestamp ?? 0,
	};
	const durations: number[] = [];
	for (const row of list) {
		const failed = Boolean(row.errorMessage);
		result.successfulRequests += failed ? 0 : 1;
		result.failedRequests += failed ? 1 : 0;
		result.totalInputTokens += row.input;
		result.totalOutputTokens += row.output;
		result.totalCacheReadTokens += row.cacheRead;
		result.totalCacheWriteTokens += row.cacheWrite;
		result.totalCost += row.cost;
		if (row.duration > 0) durations.push(row.duration);
	}
	result.errorRate = result.totalRequests
		? result.failedRequests / result.totalRequests
		: 0;
	result.cacheRate =
		result.totalInputTokens + result.totalCacheReadTokens
			? result.totalCacheReadTokens /
				(result.totalInputTokens + result.totalCacheReadTokens)
			: 0;
	if (durations.length) {
		result.avgDuration =
			durations.reduce((a, b) => a + b, 0) / durations.length;
		const withOutput = list.filter((r) => r.duration > 0 && r.output > 0);
		result.avgTokensPerSecond = withOutput.length
			? withOutput.reduce((a, r) => a + (r.output * 1000) / r.duration, 0) /
				withOutput.length
			: null;
	}
	return result;
}
function grouped(list: RequestRow[], key: (row: RequestRow) => string) {
	const groups = new Map<string, RequestRow[]>();
	for (const row of list) {
		const k = key(row);
		groups.set(k, [...(groups.get(k) ?? []), row]);
	}
	return groups;
}
function series(list: RequestRow[], range: string | null) {
	const size = bucket(range),
		points = new Map<number, any>();
	for (const row of list) {
		const timestamp = Math.floor(row.timestamp / size) * size,
			current = points.get(timestamp) ?? {
				timestamp,
				requests: 0,
				errors: 0,
				tokens: 0,
				cost: 0,
			};
		current.requests++;
		current.errors += row.errorMessage ? 1 : 0;
		current.tokens += row.input + row.output + row.cacheRead + row.cacheWrite;
		current.cost += row.cost;
		points.set(timestamp, current);
	}
	return [...points.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function dashboard(range: string | null) {
	const list = rows(range),
		byModel = [
			...grouped(list, (r) => `${r.provider}\0${r.model}`).entries(),
		].map(([key, value]) => {
			const [provider, model] = key.split("\0");
			return { provider, model, ...aggregate(value) };
		}),
		byFolder = [...grouped(list, (r) => r.folder).entries()].map(
			([folder, value]) => ({ folder, ...aggregate(value) }),
		),
		byAgentType = [...grouped(list, (r) => r.agentType).entries()].map(
			([agentType, value]) => ({
				agentType,
				totalRequests: value.length,
				totalInputTokens: value.reduce((a, r) => a + r.input, 0),
				totalOutputTokens: value.reduce((a, r) => a + r.output, 0),
				totalCacheReadTokens: value.reduce((a, r) => a + r.cacheRead, 0),
				totalCacheWriteTokens: value.reduce((a, r) => a + r.cacheWrite, 0),
				totalCost: value.reduce((a, r) => a + r.cost, 0),
			}),
		);
	const timeSeries = series(list, range),
		modelSeries = list.map((r) => ({
			timestamp: Math.floor(r.timestamp / bucket(range)) * bucket(range),
			model: r.model,
			provider: r.provider,
			requests: 1,
		})),
		modelPerformanceSeries = [
			...grouped(
				list,
				(r) =>
					`${Math.floor(r.timestamp / bucket(range)) * bucket(range)}\0${r.provider}\0${r.model}`,
			).entries(),
		].map(([key, value]) => {
			const [timestamp, provider, model] = key.split("\0"),
				perf = aggregate(value);
			return {
				timestamp: Number(timestamp),
				provider,
				model,
				requests: value.length,
				avgTtft: null,
				avgTokensPerSecond: perf.avgTokensPerSecond,
			};
		}),
		costSeries = [
			...grouped(
				list,
				(r) =>
					`${Math.floor(r.timestamp / 86_400_000) * 86_400_000}\0${r.provider}\0${r.model}`,
			).entries(),
		].map(([key, value]) => {
			const [timestamp, provider, model] = key.split("\0");
			return {
				timestamp: Number(timestamp),
				provider,
				model,
				cost: value.reduce((sum, row) => sum + row.cost, 0),
				costInput: value.reduce((sum, row) => sum + row.usage.cost.input, 0),
				costOutput: value.reduce((sum, row) => sum + row.usage.cost.output, 0),
				costCacheRead: value.reduce(
					(sum, row) => sum + row.usage.cost.cacheRead,
					0,
				),
				costCacheWrite: value.reduce(
					(sum, row) => sum + row.usage.cost.cacheWrite,
					0,
				),
				requests: value.length,
			};
		});
	return {
		overall: aggregate(list),
		byModel,
		byFolder,
		byAgentType,
		timeSeries,
		modelSeries,
		modelPerformanceSeries,
		costSeries,
	};
}
export function recent(limit = 50, range: string | null = "all") {
	return rows(range)
		.sort((a, b) => b.timestamp - a.timestamp)
		.slice(0, limit)
		.map(
			({
				input,
				output,
				cacheRead,
				cacheWrite,
				cost,
				agentType,
				reasoning,
				...row
			}) => row,
		);
}
export function errors(range: string | null, limit = 50) {
	return recent(10000, range)
		.filter((row) => row.errorMessage)
		.slice(0, limit);
}
export function request(id: string) {
	const db = new Database(statsPath, { readonly: true }),
		row = db
			.query("SELECT rowid,* FROM oc_requests WHERE rowid=? OR id=?")
			.get(Number(id), id) as any;
	if (!row) {
		db.close();
		return null;
	}
	const source = new Database(sourcePath, { readonly: true }),
		message = source
			.query("SELECT data FROM message WHERE id=?")
			.get(row.id) as any,
		parts = (
			source
				.query("SELECT data FROM part WHERE message_id=? ORDER BY time_created")
				.all(row.id) as any[]
		).map((part) => json(part.data));
	source.close();
	const value = {
		id: row.rowid,
		sessionFile: row.session_id,
		entryId: row.id,
		folder: row.folder,
		model: row.model,
		provider: row.provider,
		api: "opencode",
		timestamp: row.timestamp,
		duration: row.duration,
		ttft: null,
		stopReason: row.stop_reason,
		errorMessage: row.error,
		usage: usage({
			provider: row.provider,
			model: row.model,
			input: row.input,
			output: row.output,
			reasoning: row.reasoning,
			cacheRead: row.cache_read,
			cacheWrite: row.cache_write,
			cost: row.cost,
		}),
		messages: message ? [json(message.data)] : [],
		output: parts,
	};
	db.close();
	return value;
}

export function toolDashboard(range: string | null, skillsOnly = false) {
	const requestRows = rows(range),
		requestMap = new Map(requestRows.map((r) => [r.entryId, r])),
		db = new Database(statsPath, { readonly: true }),
		tools = db
			.query("SELECT * FROM oc_tools WHERE timestamp>=? ORDER BY timestamp")
			.all(start(range)) as any[];
	db.close();
	const countByMessage = new Map<string, number>();
	for (const tool of tools)
		countByMessage.set(
			tool.message_id,
			(countByMessage.get(tool.message_id) ?? 0) + 1,
		);
	const mapped = tools
		.filter((tool) => !skillsOnly || tool.skill !== null)
		.map((tool) => {
			const request = requestMap.get(tool.message_id),
				share = 1 / (countByMessage.get(tool.message_id) ?? 1),
				name = skillsOnly ? tool.skill : tool.tool;
			return {
				...tool,
				name,
				model: request?.model ?? "unknown",
				provider: request?.provider ?? "unknown",
				totalTokensShare: request
					? (request.input +
							request.output +
							request.cacheRead +
							request.cacheWrite) *
						share
					: 0,
				outputTokensShare: (request?.output ?? 0) * share,
				costShare: (request?.cost ?? 0) * share,
			};
		});
	const summarize = (values: any[]) => ({
		tool: values[0].name,
		calls: values.length,
		errors: values.filter((v) => v.status === "error").length,
		argsChars: values.reduce((a, v) => a + v.args_chars, 0),
		resultChars: values.reduce((a, v) => a + v.result_chars, 0),
		totalTokensShare: values.reduce((a, v) => a + v.totalTokensShare, 0),
		outputTokensShare: values.reduce((a, v) => a + v.outputTokensShare, 0),
		costShare: values.reduce((a, v) => a + v.costShare, 0),
		lastUsed: Math.max(...values.map((v) => v.timestamp)),
		successes: values.filter((v) => v.status === "completed").length,
		avgDuration: values.some((v) => v.completed)
			? values
					.filter((v) => v.completed)
					.reduce((a, v) => a + v.completed - v.timestamp, 0) /
				values.filter((v) => v.completed).length
			: null,
	});
	const byTool = [...grouped(mapped, (r) => r.name).values()].map(summarize),
		byToolModel = [
			...grouped(
				mapped,
				(r) => `${r.name}\0${r.provider}\0${r.model}`,
			).entries(),
		].map(([key, value]) => {
			const [, provider, model] = key.split("\0");
			return { ...summarize(value), provider, model };
		}),
		points = [
			...grouped(
				mapped,
				(r) =>
					`${Math.floor(r.timestamp / bucket(range)) * bucket(range)}\0${r.name}`,
			).entries(),
		].map(([key, value]) => {
			const [timestamp, name] = key.split("\0");
			return {
				timestamp: Number(timestamp),
				[skillsOnly ? "skill" : "tool"]: name,
				calls: value.length,
				errors: value.filter((v) => v.status === "error").length,
			};
		});
	return skillsOnly
		? { bySkill: byTool, bySkillModel: byToolModel, series: points }
		: { byTool, byToolModel, series: points };
}

export function providerDashboard(range: string | null) {
	const list = rows(range),
		providers = [...grouped(list, (r) => r.provider).entries()].map(
			([provider, value]) => {
				const a = aggregate(value);
				return {
					provider,
					totalRequests: a.totalRequests,
					failedRequests: a.failedRequests,
					models: new Set(value.map((r) => r.model)).size,
					totalInputTokens: a.totalInputTokens,
					totalOutputTokens: a.totalOutputTokens,
					totalCacheReadTokens: a.totalCacheReadTokens,
					totalCacheWriteTokens: a.totalCacheWriteTokens,
					totalTokens:
						a.totalInputTokens +
						a.totalOutputTokens +
						a.totalCacheReadTokens +
						a.totalCacheWriteTokens,
					totalCost: a.totalCost,
					totalPremiumRequests: 0,
					avgTokensPerSecond: a.avgTokensPerSecond,
				};
			},
		),
		hourly = [
			...grouped(
				list,
				(r) => `${r.provider}\0${new Date(r.timestamp).getHours()}`,
			).entries(),
		].map(([key, value]) => {
			const [provider, hour] = key.split("\0");
			return {
				provider,
				hour: Number(hour),
				totalTokens: value.reduce(
					(a, r) => a + r.input + r.output + r.cacheRead + r.cacheWrite,
					0,
				),
				outputTokens: value.reduce((a, r) => a + r.output, 0),
				requests: value.length,
			};
		}),
		providerSeries = [
			...grouped(
				list,
				(r) =>
					`${Math.floor(r.timestamp / bucket(range)) * bucket(range)}\0${r.provider}`,
			).entries(),
		].map(([key, value]) => {
			const [timestamp, provider] = key.split("\0");
			return {
				timestamp: Number(timestamp),
				provider,
				totalTokens: value.reduce(
					(a, r) => a + r.input + r.output + r.cacheRead + r.cacheWrite,
					0,
				),
				cost: value.reduce((a, r) => a + r.cost, 0),
				requests: value.length,
			};
		});
	return {
		providers,
		hourly,
		series: providerSeries,
		usageSeries: [],
		windowInsights: [],
	};
}

export function behaviorDashboard(range: string | null) {
	sync();
	const db = new Database(statsPath, { readonly: true }),
		values = db
			.query("SELECT * FROM oc_behavior WHERE timestamp>=? ORDER BY timestamp")
			.all(start(range)) as any[];
	db.close();
	const total = (list: any[]) => ({
		totalMessages: list.length,
		totalYelling: list.reduce((a, r) => a + r.yelling, 0),
		totalProfanity: list.reduce((a, r) => a + r.profanity, 0),
		totalAnguish: list.reduce((a, r) => a + r.anguish, 0),
		totalNegation: list.reduce((a, r) => a + r.negation, 0),
		totalRepetition: list.reduce((a, r) => a + r.repetition, 0),
		totalBlame: list.reduce((a, r) => a + r.blame, 0),
		totalChars: list.reduce((a, r) => a + r.chars, 0),
		firstTimestamp: list.at(0)?.timestamp ?? 0,
		lastTimestamp: list.at(-1)?.timestamp ?? 0,
	});
	const byModel = [
			...grouped(values, (r) => `${r.provider}\0${r.model}`).entries(),
		].map(([key, list]) => {
			const [provider, model] = key.split("\0");
			return { provider, model, ...total(list) };
		}),
		behaviorSeries = [
			...grouped(
				values,
				(r) =>
					`${Math.floor(r.timestamp / 86_400_000) * 86_400_000}\0${r.provider}\0${r.model}`,
			).entries(),
		].map(([key, list]) => {
			const [timestamp, provider, model] = key.split("\0"),
				t = total(list);
			return {
				timestamp: Number(timestamp),
				provider,
				model,
				messages: t.totalMessages,
				yelling: t.totalYelling,
				profanity: t.totalProfanity,
				anguish: t.totalAnguish,
				negation: t.totalNegation,
				repetition: t.totalRepetition,
				blame: t.totalBlame,
				chars: t.totalChars,
			};
		});
	return { overall: total(values), byModel, behaviorSeries };
}
export function gainDashboard(range: string | null, project: string | null) {
	const projects = dashboard(range)
			.byFolder.map((row) => row.folder)
			.sort(),
		zero = {
			savedTokens: 0,
			savedBytes: 0,
			hits: 0,
			outputBytes: 0,
			originalBytes: 0,
			reductionPercent: null,
		};
	return {
		overall: zero,
		bySource: { snapcompact: zero },
		timeSeries: [],
		project,
		projects,
	};
}

async function descriptions() {
	const result = new Map<string, string>(),
		roots = [
			join(configDir, "skills"),
			join(process.env.HOME ?? "", ".agents/skills"),
			join(process.env.HOME ?? "", ".claude/skills"),
		];
	for (const root of roots) {
		try {
			for (const entry of await readdir(root, { withFileTypes: true })) {
				if (!entry.isDirectory()) continue;
				try {
					const source = await readFile(
							join(root, entry.name, "SKILL.md"),
							"utf8",
						),
						match = source.match(/^description:\s*(.+)$/m);
					if (match)
						result.set(entry.name, match[1].replace(/^['"]|['"]$/g, ""));
				} catch {}
			}
		} catch {}
	}
	return result;
}
export async function skillDashboard(range: string | null) {
	const result = toolDashboard(range, true) as any,
		defined = await descriptions();
	result.bySkill = result.bySkill.map((row: any) => ({
		...row,
		description: defined.get(row.tool) ?? "No description found",
	}));
	result.bySkillModel = result.bySkillModel.map((row: any) => ({
		...row,
		description: defined.get(row.tool) ?? "No description found",
	}));
	return result;
}
