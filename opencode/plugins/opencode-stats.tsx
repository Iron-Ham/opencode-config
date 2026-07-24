/** @jsxImportSource @opentui/solid */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { statsToken, statsVersion } from "./opencode-stats/token";

const firstPort = 3848;
const server = join(
	dirname(fileURLToPath(import.meta.url)),
	"opencode-stats",
	"server.ts",
);

async function available(port: number, token: string, version: string) {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/health`, {
			headers: { "x-opencode-stats-token": token },
		});
		return response.ok && (await response.json()).version === version;
	} catch {
		return false;
	}
}

const tui: TuiPlugin = async (api) => {
	api.command?.register(() => [
		{
			title: "OpenCode Stats",
			value: "claude-config.opencode-stats.open",
			description: "Open local OpenCode analytics in the browser",
			category: "OpenCode",
			slash: { name: "stats" },
			async onSelect() {
				const token = statsToken();
				const version = statsVersion(dirname(server));
				let port = firstPort;
				for (; port < firstPort + 20; port += 1) {
					if (await available(port, token, version)) break;
					try {
						const listener = Bun.listen({
							hostname: "127.0.0.1",
							port,
							socket: { data() {} },
						});
						listener.stop();
						break;
					} catch {}
				}
				const url = `http://127.0.0.1:${port}/#/overview?range=24h&token=${encodeURIComponent(token)}`;
				if (!(await available(port, token, version))) {
					Bun.spawn(["bun", server, "--port", String(port)], {
						stdout: "ignore",
						stderr: "ignore",
					});
					for (
						let attempt = 0;
						attempt < 100 && !(await available(port, token, version));
						attempt += 1
					)
						await Bun.sleep(100);
				}
				if (!(await available(port, token, version)))
					return api.ui.toast({
						variant: "error",
						title: "Stats unavailable",
						message: "The local stats service did not start.",
					});
				Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], {
					stdout: "ignore",
					stderr: "ignore",
				});
				api.ui.toast({
					variant: "success",
					title: "Stats opened",
					message: url,
				});
			},
		},
	]);
};

export default { id: "claude-config-opencode-stats", tui };
