import { join, normalize } from "node:path";
import { buildClient } from "./build-client";
import { statsToken, statsVersion } from "./token";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	behaviorDashboard,
	dashboard,
	errors,
	gainDashboard,
	providerDashboard,
	recent,
	request,
	skillDashboard,
	sync,
	toolDashboard,
} from "./analytics";

const port = Number(Bun.argv[Bun.argv.indexOf("--port") + 1] ?? 3848);
const clientDir = await buildClient();
const token = statsToken();
const version = statsVersion(dirname(fileURLToPath(import.meta.url)));
sync();
const getRange = (url: URL) => url.searchParams.get("range") ?? "24h";

async function api(url: URL): Promise<Response | null> {
	const path = url.pathname;
	if (path === "/api/sync") return Response.json(sync());
	if (path === "/api/stats") return Response.json(dashboard(getRange(url)));
	if (path === "/api/stats/overview") {
		const value = dashboard(getRange(url));
		return Response.json({
			overall: value.overall,
			byAgentType: value.byAgentType,
			timeSeries: value.timeSeries,
		});
	}
	if (path === "/api/stats/model-dashboard") {
		const value = dashboard(getRange(url));
		return Response.json({
			byModel: value.byModel,
			modelSeries: value.modelSeries,
			modelPerformanceSeries: value.modelPerformanceSeries,
		});
	}
	if (path === "/api/stats/costs")
		return Response.json({ costSeries: dashboard(getRange(url)).costSeries });
	if (path === "/api/stats/behavior")
		return Response.json(behaviorDashboard(getRange(url)));
	if (path === "/api/stats/tools")
		return Response.json(toolDashboard(getRange(url)));
	if (path === "/api/stats/skills")
		return Response.json(await skillDashboard(getRange(url)));
	if (path === "/api/stats/providers")
		return Response.json(providerDashboard(getRange(url)));
	if (path === "/api/stats/recent")
		return Response.json(recent(Number(url.searchParams.get("limit") ?? 50)));
	if (path === "/api/stats/errors")
		return Response.json(
			errors(getRange(url), Number(url.searchParams.get("limit") ?? 50)),
		);
	if (path === "/api/stats/models")
		return Response.json(dashboard(getRange(url)).byModel);
	if (path === "/api/stats/folders")
		return Response.json(dashboard(getRange(url)).byFolder);
	if (path === "/api/stats/timeseries")
		return Response.json(dashboard(getRange(url)).timeSeries);
	if (path === "/api/stats/gain")
		return Response.json(
			gainDashboard(getRange(url), url.searchParams.get("project")),
		);
	if (path.startsWith("/api/request/")) {
		const value = request(decodeURIComponent(path.slice(13)));
		return value
			? Response.json(value)
			: new Response("Not Found", { status: 404 });
	}
	return null;
}

Bun.serve({
	port,
	hostname: "127.0.0.1",
	async fetch(input) {
		const url = new URL(input.url);
		const host = input.headers.get("host")?.split(":")[0];
		const origin = input.headers.get("origin");
		if (!host || !["127.0.0.1", "localhost", "[::1]"].includes(host))
			return new Response("Forbidden", { status: 403 });
		if (
			origin &&
			!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(origin)
		)
			return new Response("Forbidden", { status: 403 });
		if (url.pathname === "/health") {
			if (input.headers.get("x-opencode-stats-token") !== token)
				return new Response("Unauthorized", { status: 401 });
			return Response.json({ service: "opencode-stats", version });
		}
		if (url.pathname.startsWith("/api/")) {
			if (input.headers.get("x-opencode-stats-token") !== token)
				return new Response("Unauthorized", { status: 401 });
			try {
				return (await api(url)) ?? new Response("Not Found", { status: 404 });
			} catch (error) {
				console.error(error);
				return Response.json(
					{ error: error instanceof Error ? error.message : String(error) },
					{ status: 500 },
				);
			}
		}
		const relative =
			url.pathname === "/"
				? "index.html"
				: normalize(url.pathname).replace(/^[/\\]+/, "");
		const file = Bun.file(join(clientDir, relative));
		if (await file.exists()) return new Response(file);
		return new Response(Bun.file(join(clientDir, "index.html")));
	},
});
