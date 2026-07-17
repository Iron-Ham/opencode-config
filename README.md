# OpenCode Config

Personal OpenCode TUI configuration: global instructions, agents, commands, skills, managed defaults, plugins, and validation.

## Install

```bash
git clone git@github.com:Iron-Ham/claude-config.git ~/Developer/claude-config
cd ~/Developer/claude-config
./setup-opencode.sh
```

The installer requires `python3`, `bun`, and `opencode`. A fresh installation also needs the workspace CLI to install the supported OpenCode plugin bundles; later installs can use validated cached bundles when that CLI is unavailable.

`setup-opencode.sh` manages `${OPENCODE_CONFIG_DIR:-~/.config/opencode}`. It links repository-owned instructions, agents, commands, and skills; copies plugins and TUI support; merges managed JSON defaults; preserves unrelated local configuration; backs up replacements; and rolls back the active configuration if a late validation fails. Restart OpenCode after installation.

On macOS, install `alerter` for native task notifications:

```bash
brew install vjeantet/tap/alerter
```

## Managed Surface

| Path | Purpose |
|---|---|
| `AGENTS.md` | Global OpenCode operating instructions |
| `opencode/opencode.defaults.json` | Managed OpenCode defaults, model routes, permissions, and Goal settings |
| `opencode/agents/` | Reviewed specialist, evidence, and experiment subagents |
| `opencode/agent-sources/` | Source prompts for generated specialist agents |
| `opencode/commands/` | `/ultra`, `/advise`, and explicit model-provider experiment commands |
| `opencode/plugins/` | Goal mode, workflow guard, notifications, and total-cost TUI support |
| `opencode/tui/` | Shared support code for TUI plugins |
| `opencode/*.defaults.json` | Managed JSON merged with local configuration |
| `skills/` | Global skills installed directly into OpenCode |
| `scripts/` | Generation, merge, installation, and regression checks |
| `reports/opencode-model-routing/` | Evidence behind the shipped model-routing choices |

## Launch Behavior

Enable Code Mode, native Auto mode, and local LSP navigation through a shell dispatcher. Do not alias `opencode` directly with `--auto`; the flag must follow `run` when that subcommand is used.

```zsh
export OPENCODE_EXPERIMENTAL_CODE_MODE=true
export OPENCODE_EXPERIMENTAL_LSP_TOOL=true
export OPENCODE_DISABLE_LSP_DOWNLOAD=true
opencode() {
	local first="${1:-}"
	if [[ "$first" == "run" ]]; then
		command opencode run --auto "${@:2}"
		return
	fi

	if [[ -z "$first" || "$first" == -* || "$first" == */* || -d "$first" ]]; then
		command opencode --auto "$@"
		return
	fi

	command opencode "$@"
}
```

Use `opencode --no-auto` or `opencode run --no-auto ...` when a session must require approval. The managed configuration enables built-in LSP support while preserving an explicit machine-local `lsp: false` or server configuration. SourceKit feedback is advisory; repository builds, tests, and runtime validation remain authoritative.

## Model And Delegation Policy

`build` and `plan` use the pinned GPT-5.6 Terra xhigh route. `general`, `explore`, and the reviewed specialists inherit the invoking controller's model unless a developer explicitly sets an override in `model-routing.config.local.json`. `/ultra` exposes an unattended durable-goal workflow and inherits its invoking primary model. The Kimi and GLM commands are explicit provider experiments and are never automatic controller targets.

The local routing file is private and has this shape:

```json
{
  "advisor_enabled": false,
  "agents": {},
  "steps": {}
}
```

Advisor access is disabled by default, including `/advise`. Set `"advisor_enabled": true` locally to opt into the explicit, isolated `/advise` command, which receives only developer-supplied context.

## Verify Changes

Regenerate and validate generated agents after changing an agent source:

```bash
python3 scripts/generate-opencode-agents.py
python3 scripts/generate-opencode-agents.py --check
```

Run the focused regression suite before committing configuration changes:

```bash
bun scripts/test-opencode-config.mjs
bun scripts/test-opencode-goal-mode.mjs
bun scripts/test-opencode-workflow-plugin.mjs
bun scripts/test-opencode-total-cost.mjs
bun scripts/test-opencode-notion-assets.mjs
bun scripts/test-setup-opencode-transaction.mjs
bun scripts/test-opencode-benchmark-runtime.mjs
bun scripts/test-opencode-benchmark-pricing.mjs
bun scripts/test-benchmark-output-containment.mjs
```

The first two checks that resolve OpenCode configuration require the OpenCode CLI. The installer performs generation, merge, and installed-asset validation before it changes the active configuration.
