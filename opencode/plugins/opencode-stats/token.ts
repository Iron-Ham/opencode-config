import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const path = join(
	process.env.XDG_STATE_HOME ?? `${process.env.HOME}/.local/state`,
	"opencode",
	"stats-token",
);

export function statsToken(): string {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	try {
		const current = readFileSync(path, "utf8").trim();
		if (current) return current;
	} catch {}
	const token = randomBytes(32).toString("base64url");
	try {
		writeFileSync(path, `${token}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
	} catch {
		return readFileSync(path, "utf8").trim();
	}
	chmodSync(path, 0o600);
	return token;
}

export function statsVersion(directory: string): string {
	const source = ["server.ts", "analytics.ts", "build-client.ts", "token.ts"]
		.map((file) => readFileSync(join(directory, file), "utf8"))
		.join("\0");
	return Bun.hash(source).toString(16);
}
