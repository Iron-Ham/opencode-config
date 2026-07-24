import {
	cp,
	mkdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function replace(path: string, search: string, replacement: string) {
	const source = await readFile(path, "utf8");
	if (!source.includes(search))
		throw new Error(`OMP client patch no longer applies to ${path}`);
	await writeFile(path, source.replace(search, replacement));
}

export async function buildClient(): Promise<string> {
	const pluginDir = dirname(fileURLToPath(import.meta.url));
	const configDir = dirname(dirname(pluginDir));
	const buildHash = Bun.hash(
		await readFile(fileURLToPath(import.meta.url), "utf8"),
	).toString(16);
	const root = join(
		process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`,
		"opencode",
		"opencode-stats",
		`17.1.2-${buildHash}`,
	);
	const marker = join(root, "dist", "client", "index.html");
	if (await Bun.file(marker).exists()) return dirname(marker);

	const resolved = fileURLToPath(import.meta.resolve("@oh-my-pi/omp-stats"));
	const packageRoot = dirname(dirname(resolved));
	await mkdir(dirname(root), { recursive: true });
	const buildRoot = `${root}.${crypto.randomUUID()}.tmp`;
	await cp(packageRoot, buildRoot, { recursive: true });
	await rm(join(buildRoot, "node_modules"), { recursive: true, force: true });
	await symlink(
		join(configDir, "node_modules"),
		join(buildRoot, "node_modules"),
		"dir",
	);

	const client = join(buildRoot, "src", "client");
	await replace(
		join(client, "app", "routes.ts"),
		'| "gain";',
		'| "gain"\n\t| "skills";',
	);
	await replace(
		join(client, "app", "routes.ts"),
		'\t{\n\t\tid: "costs",',
		'\t{\n\t\tid: "skills",\n\t\tlabel: "Skills",\n\t\ticon: Wrench,\n\t},\n\t{\n\t\tid: "costs",',
	);
	await replace(
		join(client, "App.tsx"),
		"\tToolsRoute,",
		"\tToolsRoute,\n\tSkillsRoute,",
	);
	await replace(
		join(client, "App.tsx"),
		'\t\t\tcase "costs":',
		'\t\t\tcase "skills":\n\t\t\t\treturn <SkillsRoute active={isActive} range={range} refreshTrigger={refreshTrigger} />;\n\t\t\tcase "costs":',
	);
	await replace(
		join(client, "routes", "index.ts"),
		'export * from "./ToolsRoute";',
		'export * from "./ToolsRoute";\nexport * from "./SkillsRoute";',
	);
	await replace(
		join(client, "data", "useHashRoute.ts"),
		'\t"costs",',
		'\t"skills",\n\t"costs",',
	);
	await replace(
		join(client, "api.ts"),
		"\tToolDashboardStats,",
		"\tToolDashboardStats,\n\tSkillDashboardStats,",
	);
	await writeFile(
		join(client, "api.ts"),
		`${await readFile(join(client, "api.ts"), "utf8")}\nexport async function getSkillDashboardStats(range: TimeRange = "24h", signal?: AbortSignal): Promise<SkillDashboardStats> {\n\treturn fetchJson<SkillDashboardStats>(\`${"${API_BASE}"}/stats/skills?range=${"${encodeURIComponent(range)}"}\`, { signal });\n}\n`,
	);
	await writeFile(
		join(buildRoot, "src", "shared-types.ts"),
		`${await readFile(join(buildRoot, "src", "shared-types.ts"), "utf8")}\nexport interface SkillUsageStats extends ToolUsageStats { description: string; successes: number; avgDuration: number | null; }\nexport interface SkillDashboardStats { bySkill: SkillUsageStats[]; bySkillModel: (SkillUsageStats & { model: string; provider: string })[]; series: Array<{ timestamp: number; skill: string; calls: number; errors: number }>; }\n`,
	);
	await writeFile(join(client, "routes", "SkillsRoute.tsx"), SKILLS_ROUTE);
	await replace(
		join(buildRoot, "build.ts"),
		'<script src="index.js" type="module"></script>',
		`<script>\nconst token=new URLSearchParams(location.hash.split("?")[1]||"").get("token")||sessionStorage.getItem("opencode-stats-token");if(token){sessionStorage.setItem("opencode-stats-token",token);const original=window.fetch;window.fetch=(input,init={})=>original(input,{...init,headers:{...Object.fromEntries(new Headers(init.headers).entries()),"x-opencode-stats-token":token}})}\n</script>\n    <script src="index.js" type="module"></script>`,
	);

	const buildProcess = Bun.spawn(["bun", "run", "build.ts"], {
		cwd: buildRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exit = await buildProcess.exited;
	if (exit !== 0)
		throw new Error(
			`OMP stats client build failed:\n${await new Response(buildProcess.stderr).text()}`,
		);
	try {
		await rename(buildRoot, root);
	} catch {
		await rm(buildRoot, { recursive: true, force: true });
	}
	return dirname(marker);
}

const SKILLS_ROUTE = `import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { getSkillDashboardStats } from "../api";
import { CHART_THEMES, MODEL_COLORS } from "../components/chart-shared";
import { formatRangeTick } from "../components/range-meta";
import { formatCompact, formatCost, formatInteger, formatPercent } from "../data/formatters";
import { useResource } from "../data/useResource";
import type { SkillUsageStats, TimeRange } from "../types";
import { AsyncBoundary, DataTable, Panel } from "../ui";
import { useSystemTheme } from "../useSystemTheme";

export function SkillsRoute({ active, range, refreshTrigger }: { active: boolean; range: TimeRange; refreshTrigger: number }) {
 const resource = useResource(["skills", range, refreshTrigger], signal => getSkillDashboardStats(range, signal), { pollMs: 30000, enabled: active });
 return <div className="stats-route-container space-y-6"><AsyncBoundary loading={resource.loading} error={resource.error} data={resource.data} emptyText="No skill calls recorded for this range.">{resource.data && <><Summary rows={resource.data.bySkill}/><Chart stats={resource.data} range={range}/><Panel title="Skill Usage" subtitle="Purpose, reliability, attributed provider usage, and average load duration"><DataTable columns={columns} data={resource.data.bySkill} keyExtractor={s => s.tool} emptyText="No skill calls recorded"/></Panel></>}</AsyncBoundary></div>
}
const columns = [
 { key:"skill", header:"Skill", render:(s:SkillUsageStats)=><div><div className="font-medium">{s.tool}</div><div className="stats-text-muted text-xs">{s.description}</div></div> },
 { key:"calls", header:"Calls", numeric:true, render:(s:SkillUsageStats)=>formatInteger(s.calls) },
 { key:"success", header:"Success", numeric:true, render:(s:SkillUsageStats)=>formatPercent(s.calls ? s.successes/s.calls : 0) },
 { key:"duration", header:"Avg duration", numeric:true, render:(s:SkillUsageStats)=>s.avgDuration === null ? "—" : Math.round(s.avgDuration)+" ms" },
 { key:"tokens", header:"Attributed tokens", numeric:true, render:(s:SkillUsageStats)=>formatCompact(Math.round(s.totalTokensShare)) },
 { key:"cost", header:"Attributed cost", numeric:true, render:(s:SkillUsageStats)=>formatCost(s.costShare) },
];
function Summary({rows}:{rows:SkillUsageStats[]}) { const t=rows.reduce((a,s)=>({calls:a.calls+s.calls,errors:a.errors+s.errors,cost:a.cost+s.costShare,tokens:a.tokens+s.totalTokensShare}),{calls:0,errors:0,cost:0,tokens:0}); return <Panel title="Skill Analytics" subtitle="Skills have no direct provider charge; usage is attributed from invoking assistant turns"><div className="stats-metric-primary-grid"><div className="stats-metric-card primary"><div className="stats-metric-label">Invocations</div><div className="stats-metric-value">{formatInteger(t.calls)}</div></div><div className="stats-metric-card primary"><div className="stats-metric-label">Skills Used</div><div className="stats-metric-value">{formatInteger(rows.length)}</div></div><div className="stats-metric-card primary"><div className="stats-metric-label">Success Rate</div><div className="stats-metric-value">{formatPercent(t.calls?(t.calls-t.errors)/t.calls:0)}</div></div><div className="stats-metric-card primary"><div className="stats-metric-label">Attributed Cost</div><div className="stats-metric-value">{formatCost(t.cost)}</div></div></div></Panel> }
function Chart({stats,range}:{stats:any;range:TimeRange}) { const theme=useSystemTheme(); const points=stats.series; const buckets=[...new Set(points.map((p:any)=>p.timestamp))].sort(); const skills=stats.bySkill.slice(0,6).map((s:any)=>s.tool); const data={labels:buckets.map((b:any)=>formatRangeTick(b,range)),datasets:skills.map((skill:string,i:number)=>({label:skill,data:buckets.map((b:any)=>points.find((p:any)=>p.timestamp===b&&p.skill===skill)?.calls??0),borderColor:MODEL_COLORS[i%MODEL_COLORS.length],backgroundColor:MODEL_COLORS[i%MODEL_COLORS.length]+"30",fill:true,tension:.4,pointRadius:0}))}; const c=CHART_THEMES[theme]; return <Panel title="Skill Activity" subtitle="Invocations over time"><div className="h-[300px]"><Line data={data} options={{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{labels:{color:c.legendLabel}}},scales:{x:{ticks:{color:c.tickLabel},grid:{color:c.gridLine}},y:{beginAtZero:true,ticks:{color:c.tickLabel},grid:{color:c.gridLine}}}}}/></div></Panel> }
`;
