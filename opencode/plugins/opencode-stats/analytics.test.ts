import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join("/tmp", `opencode-stats-${crypto.randomUUID()}`),
	source = join(root, "source.db"),
	stats = join(root, "stats.db");

beforeAll(async () => {
	await mkdir(root, { recursive: true });
	process.env.OPENCODE_DATABASE_PATH = source;
	process.env.OPENCODE_STATS_DATABASE_PATH = stats;
	const db = new Database(source, { create: true });
	db.run(
		"CREATE TABLE session(id TEXT PRIMARY KEY,project_id TEXT,parent_id TEXT,directory TEXT,time_created INTEGER,time_updated INTEGER)",
	);
	db.run(
		"CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT,time_created INTEGER,time_updated INTEGER)",
	);
	db.run(
		"CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,data TEXT,time_created INTEGER,time_updated INTEGER)",
	);
	const now = Date.now();
	db.run("INSERT INTO session VALUES(?,?,?,?,?,?)", [
		"session",
		"project",
		null,
		"/repo",
		now,
		now,
	]);
	db.run("INSERT INTO message VALUES(?,?,?,?,?)", [
		"user",
		"session",
		JSON.stringify({ role: "user", time: { created: now } }),
		now,
		now,
	]);
	db.run("INSERT INTO part VALUES(?,?,?,?,?,?)", [
		"user-text",
		"user",
		"session",
		JSON.stringify({ type: "text", text: "No, I meant use the skill." }),
		now,
		now,
	]);
	db.run("INSERT INTO message VALUES(?,?,?,?,?)", [
		"assistant",
		"session",
		JSON.stringify({
			role: "assistant",
			parentID: "user",
			providerID: "openai",
			modelID: "test",
			agent: "build",
			cost: 1.5,
			tokens: {
				input: 100,
				output: 20,
				reasoning: 5,
				cache: { read: 30, write: 2 },
			},
			time: { created: now, completed: now + 1000 },
			finish: "stop",
		}),
		now,
		now,
	]);
	db.run("INSERT INTO part VALUES(?,?,?,?,?,?)", [
		"skill",
		"assistant",
		"session",
		JSON.stringify({
			type: "tool",
			tool: "skill",
			state: {
				status: "completed",
				input: { name: "diagnose" },
				output: "loaded",
				time: { start: now, end: now + 10 },
			},
		}),
		now,
		now,
	]);
	db.run("INSERT INTO part VALUES(?,?,?,?,?,?)", [
		"compaction",
		"assistant",
		"session",
		JSON.stringify({ type: "compaction", auto: true }),
		now,
		now,
	]);
	db.run("INSERT INTO part VALUES(?,?,?,?,?,?)", [
		"read",
		"assistant",
		"session",
		JSON.stringify({
			type: "tool",
			tool: "read",
			state: {
				status: "completed",
				input: { filePath: "/repo/file" },
				output: "contents",
				time: { start: now, end: now + 5 },
			},
		}),
		now,
		now,
	]);
	db.close();
});
afterAll(async () => {
	await rm(root, { recursive: true, force: true });
});

test("emits the complete OMP dashboard contracts plus skills", async () => {
	const analytics = await import(
		`./analytics.ts?fixture=${crypto.randomUUID()}`
	);
	analytics.sync();
	const overview = analytics.dashboard("24h"),
		tools = analytics.toolDashboard("24h") as any,
		skills = (await analytics.skillDashboard("24h")) as any,
		behavior = analytics.behaviorDashboard("24h"),
		providers = analytics.providerDashboard("24h"),
		gain = analytics.gainDashboard("24h", null);
	expect(overview.overall).toMatchObject({
		totalRequests: 1,
		totalInputTokens: 100,
		totalOutputTokens: 20,
		totalCacheReadTokens: 30,
		totalCost: 1.5,
		cacheRate: 30 / 130,
	});
	expect(overview.modelSeries).toHaveLength(1);
	expect(overview.costSeries).toHaveLength(1);
	expect(tools.byTool.find((row: any) => row.tool === "skill")).toMatchObject({
		tool: "skill",
		calls: 1,
		errors: 0,
		costShare: 0.75,
	});
	expect(skills.bySkill[0]).toMatchObject({
		tool: "diagnose",
		successes: 1,
		avgDuration: 10,
		costShare: 0.75,
	});
	expect(behavior.overall).toMatchObject({
		totalMessages: 1,
		totalNegation: 1,
	});
	expect(providers.providers[0]).toMatchObject({
		provider: "openai",
		totalRequests: 1,
		models: 1,
	});
	expect(gain).toMatchObject({ project: null, overall: { hits: 0 } });
});

test("reprocesses equal timestamps and sanitizes nested provider errors", async () => {
	const db = new Database(source);
	const timestamp = (
		db.query("SELECT max(time_updated) value FROM message").get() as any
	).value;
	db.run("INSERT INTO message VALUES(?,?,?,?,?)", [
		"assistant-error",
		"session",
		JSON.stringify({
			role: "assistant",
			providerID: "openai",
			modelID: "test",
			agent: "build",
			cost: 0,
			tokens: { input: 1, output: 0, cache: { read: 0, write: 0 } },
			time: { created: timestamp, completed: timestamp + 1 },
			error: {
				name: "APIError",
				data: { message: "rate limited" },
				responseBody: "secret",
			},
		}),
		timestamp,
		timestamp,
	]);
	db.close();
	const analytics = await import(
		`./analytics.ts?fixture=${crypto.randomUUID()}`
	);
	analytics.sync();
	expect(analytics.dashboard("24h").overall.totalRequests).toBe(2);
	expect(analytics.errors("24h", 10)[0].errorMessage).toBe("rate limited");
});
