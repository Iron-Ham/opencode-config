# OpenCode Config

Personal OpenCode TUI configuration: global instructions, agents, commands, skills, managed defaults, plugins, and validation.

## Install

```bash
git clone git@github.com:Iron-Ham/claude-config.git ~/Developer/claude-config
cd ~/Developer/claude-config
./setup-opencode.sh
# Or, when cached plugin bundles are already installed:
./setup-opencode.sh --skip-notion-cli
```

The installer requires `python3`, `bun`, and `opencode`. A fresh installation also needs the workspace CLI to install the supported OpenCode plugin bundles; later installs can use validated cached bundles when that CLI is unavailable. Pass `--skip-notion-cli` to explicitly avoid calling the workspace CLI; cached plugin bundles must already be installed.

On macOS, install the optional command-line tools used by this configuration:

```bash
brew install ripgrep ast-grep
brew install vjeantet/tap/alerter
```

`ripgrep` and `ast-grep` are runtime dependencies of the managed `glob`,
`grep`, and `ast_grep` tools. `alerter` provides native task notifications.

`setup-opencode.sh` manages `${OPENCODE_CONFIG_DIR:-~/.config/opencode}`. It links repository-owned instructions, agents, commands, and skills; copies plugins and TUI support; merges managed JSON defaults; preserves unrelated local configuration; backs up replacements; and rolls back the active configuration if a late validation fails. Restart OpenCode after installation.

## Managed Surface

| Path | Purpose |
|---|---|
| `AGENTS.md` | Global OpenCode operating instructions |
| `opencode/opencode.defaults.json` | Managed OpenCode defaults, model routes, and permissions |
| `opencode/control-plane-policy.md` | Observe-only route-policy contract and implementation boundary |
| `opencode/agents/` | Reviewed specialist and evidence subagents |
| `opencode/agent-sources/` | Source prompts for generated specialist agents |
| `opencode/commands/` | Managed command templates when configured |
| `opencode/plugins/` | Notifications, workflow guards, and total-cost TUI support |
| `opencode/tui/` | Shared support code for TUI plugins |
| `opencode/*.defaults.json` | Managed JSON merged with local configuration |
| `skills/` | Global skills installed directly into OpenCode |
| `scripts/` | Generation, merge, installation, and regression checks |
| `reports/opencode-model-routing/` | Evidence behind the shipped model-routing choices |

## Launch Behavior

Enable Code Mode, native Auto mode, and local LSP navigation through a shell dispatcher. The local Notion CLI runs under `mise`'s installed `node@22.13.1`, so its shim does not require a global Node default. Do not alias `opencode` directly with `--auto`; the flag must follow `run` when that subcommand is used.

```zsh
export OPENCODE_EXPERIMENTAL_CODE_MODE=true
export OPENCODE_EXPERIMENTAL_LSP_TOOL=true
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
export OPENCODE_ENABLE_EXA=1
_run_notion_local_or_command() {
	local tool="$1"
	shift

	if command -v mise >/dev/null 2>&1; then
		command mise exec node@22.13.1 -- notion local "$tool" "$@"
	else
		command "$tool" "$@"
	fi
}

opencode() {
	local first="${1:-}"
	if [[ "$first" == "run" ]]; then
		_run_notion_local_or_command opencode run --auto "${@:2}"
		return
	fi

	if [[ -z "$first" || "$first" == -* || "$first" == */* || -d "$first" ]]; then
		_run_notion_local_or_command opencode --auto "$@"
		return
	fi

	_run_notion_local_or_command opencode "$@"
}
```

Use `opencode --no-auto` or `opencode run --no-auto ...` when a session must require approval. The managed configuration enables built-in LSP support while preserving an explicit machine-local `lsp: false` or server configuration. SourceKit feedback is advisory; repository builds, tests, and runtime validation remain authoritative.

## Model And Delegation Policy

The primary model and `plan` default to GPT-5.6 Terra without a fixed reasoning variant. `build`, `general`, `explore`, and the reviewed specialists inherit the invoking controller's model unless a developer explicitly sets an override in `model-routing.config.local.json`.

In the managed global configuration, `build` may delegate to any subagent. `general` may delegate only to `code_reviewer` for a bounded, read-only review. `plan` may edit only `*.md` files. The reviewer still requires a concrete source boundary.

The local routing file is private and has this shape:

```json
{
  "policy_adapter_enabled": true,
  "agents": {},
  "steps": {}
}
```

The observe-only policy adapter uses the `policy_adapter_enabled` kill switch; disabling it leaves ordinary OpenCode model selection unchanged.

Run `bun scripts/opencode-doctor.mjs` for read-only local diagnostics of managed plugin installation, compaction inheritance, private routing configuration, and redacted compaction observation records. Use `--json` for automation or `--config-dir <path>` to inspect a non-default installation.

The doctor also reports compaction retention settings, configured tool-output bounds, and the static compaction threshold for the active model (`input limit - reserved tokens`). These are configuration diagnostics, not measurements of prompt quality. For multi-result tools and MCP calls, aggregate or filter records before returning them to reduce transcript growth.

## Verify Changes

Regenerate and validate generated agents after changing an agent source:

```bash
python3 scripts/generate-opencode-agents.py
python3 scripts/generate-opencode-agents.py --check
```

Run the focused regression suite before committing configuration changes:

```bash
bun scripts/test-opencode-policy-resolver.mjs
bun scripts/test-opencode-config.mjs
bun scripts/test-opencode-compaction-observability.mjs
bun scripts/test-opencode-doctor.mjs
bun scripts/test-opencode-delegation-guard.mjs
bun scripts/test-opencode-total-cost.mjs
bun scripts/test-opencode-notion-assets.mjs
bun scripts/test-setup-opencode-transaction.mjs
bun scripts/test-opencode-benchmark-runtime.mjs
bun scripts/test-opencode-benchmark-pricing.mjs
bun scripts/test-benchmark-output-containment.mjs
```

The first two checks that resolve OpenCode configuration require the OpenCode CLI. The installer performs generation, merge, and installed-asset validation before it changes the active configuration.
