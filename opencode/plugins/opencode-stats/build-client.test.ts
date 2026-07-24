import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildClient } from "./build-client";

test("builds the OMP client with Skills routing and API authentication", async () => {
	const directory = await buildClient();
	const [html, client] = await Promise.all([
		readFile(join(directory, "index.html"), "utf8"),
		readFile(join(directory, "index.js"), "utf8"),
	]);
	expect(html).toContain("x-opencode-stats-token");
	expect(client).toContain("Skills");
	expect(client).toContain("skills");
});
