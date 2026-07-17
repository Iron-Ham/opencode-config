# Agent Config

Personal agent configuration for Claude Code, Codex, and OpenCode: global instructions, skills, upstream-derived agent declarations, and setup scripts.

## Quick Start

For Claude Code:

```bash
git clone git@github.com:Iron-Ham/claude-config.git ~/Developer/claude-config
cd ~/Developer/claude-config
./setup.sh
```

For Codex:

```bash
git clone git@github.com:Iron-Ham/claude-config.git ~/Developer/claude-config
cd ~/Developer/claude-config
./setup-codex.sh
```

For OpenCode:

```bash
git clone git@github.com:Iron-Ham/claude-config.git ~/Developer/claude-config
cd ~/Developer/claude-config
./setup-opencode.sh
```

`setup.sh` symlinks Claude Code config into `~/.claude/`. `setup-codex.sh` symlinks `AGENTS.md`, generated Codex custom agents, and generated Codex-normalized skills into Codex-only locations while leaving `~/.codex/config.toml` untouched. `setup-opencode.sh` installs the shared global rules, reviewed OpenCode-specific agents, explicit model commands, managed model/plugin defaults, and supported workspace-managed OpenCode bundles. It requires Python 3, Bun, and the OpenCode CLI; a clean workspace-plugin installation also requires the workspace CLI. The installer preserves configuration outside its managed roles and security surfaces and backs up non-symlink files before replacing them. The native notification plugin uses `alerter` on macOS; install it with `brew install vjeantet/tap/alerter`.

## Recommended: Max Effort Alias

By default, Claude Code runs at a moderate effort level. For consistently thorough responses, add this alias to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
alias claude='claude --effort max'
```

This ensures every invocation uses the highest effort level without needing to remember the flag each time.

## What's Included

| Path | Description |
|---|---|
| `AGENTS.md` | Canonical global instructions -- git workflow, commit conventions, cross-harness agent delegation, testing and documentation guidelines |
| `CLAUDE.md` | Symlink to `AGENTS.md` for Claude Code compatibility |
| `settings.json` | Claude Code model preferences, enabled plugins, and effort level defaults |
| `agents/` | Specialized agent definitions across engineering, design, sales, product, project management, and more (snapshotted from [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) -- see [Syncing agents](#syncing-agents) below) |
| `codex/agents/` | Codex custom-agent TOML generated from the curated Markdown agent subset |
| `opencode/agent-sources/` | Reviewed source prompts for the thin OpenCode-specific specialist wrappers |
| `opencode/agents/` | Generated read-only review agents, an artifact-only evidence analyst, an isolated advisor, and explicit Kimi/GLM experiments |
| `opencode/commands/` | Isolated `/advise`, provider-pinned Kimi/GLM experiments, and the Terra-backed `/ultra` lane |
| `opencode/plugins/` | Managed OpenCode plugins, including native task notifications |
| `opencode/*.defaults.json` | Managed OpenCode defaults merged with machine-local JSON configuration |
| `skills/` | Source skills, including Claude Code-compatible metadata and resources |
| `codex/skills/` | Codex-normalized skills generated from `skills/` |
| `commands/` | Custom slash commands |
| `scripts/generate-codex-agents.py` | Regenerates `codex/agents/*.toml` from `agents/**/*.md` |
| `scripts/generate-opencode-agents.py` | Regenerates the curated `opencode/agents/*.md` specialist subset |
| `scripts/merge-opencode-config.mjs` | Safely merges managed defaults into machine-local OpenCode JSON files |
| `scripts/validate-opencode-agents.mjs` | Resolves every managed OpenCode agent and enforces controller/read-only boundaries |
| `scripts/test-opencode-config.mjs` | Regression-checks permission ordering, pinned aliases, and machine-local merge preservation |
| `scripts/test-opencode-notion-assets.mjs` | Regression-checks rollback and commit semantics for the managed OpenCode asset refresh transaction |
| `scripts/generate-codex-skills.py` | Regenerates `codex/skills/*/SKILL.md` from `skills/*/SKILL.md` |
| `setup.sh` | Claude Code symlink installer |
| `setup-codex.sh` | Codex symlink installer |
| `setup-opencode.sh` | OpenCode symlink and managed-default installer |

## Codex agents

Codex custom agents are generated from a curated subset of the upstream-style Markdown agents:

```bash
python scripts/generate-codex-agents.py
```

To experiment with a full conversion of every top-level Markdown agent that has front matter:

```bash
python scripts/generate-codex-agents.py --all
```

Review the generated files before installing. The default checked-in set is intentionally smaller than the full upstream snapshot to keep Codex agent routing predictable.

## Codex skills

Codex reads skills from directories containing a `SKILL.md` with `name` and `description` front matter. Generate Codex-normalized copies from the source skills with:

```bash
python scripts/generate-codex-skills.py
```

To validate the source skill front matter without writing generated files:

```bash
python scripts/generate-codex-skills.py --check
```

Generated skill folders keep only Codex-relevant front matter and symlink resource folders/files back to `skills/`, so large assets and helper scripts are not duplicated.

## OpenCode setup

OpenCode shares the repository's `AGENTS.md`, but its agents are deliberately harness-specific. The checked-in OpenCode set consists of thin reviewed procedures for code, architecture, security, accessibility, and database review; a separate artifact-only evidence analyst; the isolated advisor; and explicit Kimi and GLM experiments. These agents provide an independent context and a permission boundary, not proof that a named persona or its model has specialist expertise. The legacy OpenCode frontend, backend, technical-writer, and git-workflow wrappers are retired, and the borrowed Mobile App Builder and Agents Orchestrator personas are intentionally not ported. Mobile work stays with the production controller, repository-local instructions, and applicable mobile skills.

Direct OpenCode invocations should enable CodeMode before the process starts and launch with native Auto mode. CodeMode replaces the full flat MCP schema surface with a compact `execute` tool that discovers and invokes child tools on demand, reducing repeated tool-schema context without changing the selected model, provider, permissions, or agent instructions. OpenCode 1.18.3 does not persist its Auto toggle in `opencode.json` or `tui.json`. A literal `opencode='opencode --auto'` alias also places the flag before subcommands, causing commands such as `opencode run` to be parsed as TUI project paths. Use a direct-binary shell dispatcher instead:

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

This keeps `opencode` pointed at the standard binary. Use `opencode --no-auto` or `opencode run --no-auto ...` to require approvals for one launch, or toggle Auto from the TUI command palette for the current process. Auto approves permission rules that resolve to `ask`; explicit `deny` rules still win. Routing `opencode` to a workspace launcher would instead inherit that launcher's provider allowlist, credential resolution, telemetry, update, and model-routing behavior.

The managed config enables OpenCode's native LSP integration by default while preserving a developer's `lsp: false` or per-server configuration. On macOS, the built-in SourceKit route resolves the Xcode toolchain through `xcrun`. Core LSP support supplies diagnostics after edits; the experimental LSP tool flag adds model-driven navigation and symbol operations, while the download-disable flag prevents unattended acquisition of unrelated language servers. The shell dispatcher sets those machine-local flags; `setup-opencode.sh` does not edit a developer's shell profile. These environment flags are private OpenCode 1.18.3 interfaces and must be re-audited when upgrading the harness. SourceKit feedback is advisory: repository builds, tests, and runtime verification remain the completion authority.

The managed `external_directory` policy allows controllers and subagents to inspect paths elsewhere in the user's home directory. Each managed child receives the same policy because its generic deny rule would otherwise override the controller's top-level scope. The shared policy denies common credential and application-state paths, including AWS, Azure, Cargo, Terraform, SSH, Kubernetes, Docker, GnuPG, system-config, and macOS Library paths. Tool-specific safeguards remain in force: all managed agents deny `.env`-style reads, read-only specialists cannot edit or execute commands, and `general` retains its destructive-command denials.

The global OpenCode TUI also displays the current session cost, direct subagent cost, and aggregate cost across nested child sessions. It is registered through `opencode/tui.defaults.json`, installed with the other managed OpenCode plugins, and refreshed after restarting OpenCode. The aggregate is based on OpenCode's per-session `cost` values and excludes unrelated sessions in the same workspace.

### Model routing

| Role or command | Shipped route | Status |
|---|---|---|
| `build`, `terra` | GPT-5.6 Terra xhigh | Production iOS default |
| `/ultra` | Inherit invoking primary | Visible unattended policy profile with durable goals and broader bounded delegation |
| `general` | Inherit invoking Build or Ultra | Writable child stays on the selected controller model unless explicitly overridden |
| `luna` | GPT-5.6 Luna high | Bounded, cost-sensitive agent profile that requires strong deterministic verification |
| `plan` | GPT-5.6 Terra xhigh | Stable planning frontier across four production-shaped plans; Sol was costlier and unstable, while Sonnet repeatedly missed central safety constraints |
| `explore` and retained review/evidence agents | Inherit the invoking primary model | Step-capped independent contexts; a role name does not silently change model, provider, or price |
| `sonnet`, `sol` | Sonnet 5 default or GPT-5.6 Sol high | Explicit developer-selected agent profiles, not automatic escalation |
| `/kimi`, `/glm` | Kimi K2.7 Code or GLM 5.2 max on Baseten | Compatibility experiments and matched-provider controls |
| `/kimi-fireworks`, `/glm-fireworks` | Kimi K2.7 Code or GLM 5.2 max on Fireworks Standard | Explicit provider experiments; no automatic controller reachability |
| `/kimi-fireworks-fast`, `/glm-fireworks-fast` | The same open-weight models on Fireworks Fast | Explicit latency experiments at 2× Kimi or 1.5× GLM list price |
| `/advise` | Read-only `advisor_reviewer` on Opus 4.8 xhigh | Provisional transfer from the two-cluster reviewer comparison; both enablement and model are locally configurable |
| compaction | Active session model | No fixed compactor or global `small_model` without retention and transcript-egress evidence |

The implementation default follows narrow production-shaped evidence: Terra xhigh completed the long-horizon source tasks and respected their declared boundary, while Luna xhigh did not. That supports Terra as the safer default for this workload class, not as proof that either model can ship without tests, runtime evidence, and review. Luna high remains available because one matched production-shaped comparison was directionally better than Luna xhigh on completion, latency, and cost; it does not establish Luna as quality-equivalent to Terra. Terra also becomes the planning default after completing all four repeated production-shaped plans without a fatal boundary error; Sol was much costlier and unstable, while Sonnet repeatedly missed central safety constraints. The advisor-model comparison remains separate.

Model-branded agent profiles are fixed so their names cannot silently route elsewhere: `luna`, `terra`, `sonnet`, and `sol` use pinned aliases. They are selected as agents rather than installed as redundant slash commands. Open-weight command frontmatter pins both model and provider: bare `/kimi` and `/glm` retain their Baseten routes, while the `-fireworks` and `-fireworks-fast` commands select exact Fireworks Standard and Fast IDs. Role-based agents can be changed in `~/.config/opencode/model-routing.config.local.json`, including `build`, `general`, `plan`, `explore`, `ultra`, compaction, the reviewed specialists, and `advisor_reviewer`. Without such an explicit override, `ultra`, `general`, `explore`, and the reviewed specialists inherit their invoking primary model. `agents.advisor_reviewer` changes the model behind `/advise`; the shipped Opus 4.8 xhigh choice is a provisional transfer from the two-cluster reviewer comparison, not a universal advisor ranking. Unknown keys, unsupported agents, malformed `provider/model` identifiers, and invalid step limits fail validation before installation.

The five pinned GPT-5.6 aliases carry a 256,000-token operational input limit. With OpenCode's 20,000-token compaction reserve, ordinary GPT sessions compact at roughly 236,000 tokens, leaving 36,000 tokens before the 272,000-token pricing tier. The base GPT catalog entries retain their factual 922,000-token input capacity as an explicit long-context escape hatch. This is a high-percentile guard rather than a hard ceiling: a single oversized user or tool turn, or an oversized retained tail, can still cross the tier. OpenCode 1.18.3 cannot send OpenAI's native server-side compaction items, so the supported per-model overflow path is used instead.

The managed provider catalog exposes Fireworks Standard and Fast routes for GLM 5.2 and Kimi K2.7 Code through OpenCode's `fireworks-ai` provider. Setup stores no credential: authenticate with OpenCode's `/connect` flow or launch OpenCode in an environment that supplies `FIREWORKS_API_KEY`. Baseten remains available for matched controls. Provider availability does not change Build, Plan, compaction, advisor, specialist, or Task routing; the combination of model, provider, serving path, and reasoning setting must earn a role through repeated workload-specific trials.

### Delegation and advisor boundaries

Task access is deny-by-default and allowlisted per controller. Role-based `build` and `/ultra` can delegate a writable independent slice to `general`, which inherits the invoking model unless explicitly overridden; the model-branded Luna, Terra, Sonnet, and Sol controllers keep implementation in the selected model lane. The backing `ultra` primary is visible in the TUI, while `/ultra` remains the supported path that supplies the Goal and orchestration template; direct API or CLI invocation remains possible but omits that template. Its permission profile also denies interactive questions and Plan entry for unattended execution. Their reviewed non-editing children inherit the invoking model by default. `plan` has a smaller read-only review allowlist, while `general`, `explore`, and every specialist cannot delegate further. The hidden experimental agents and hidden `advisor_reviewer` are absent from every controller Task allowlist; only the explicit Kimi/GLM commands and `/advise` expose them.

Every thin review specialist denies editing, shell execution, broad content search, interactive questions, nested Task, Goal mutation, and advisor access. The controller must supply a concrete diff, exact source boundary, or evidence bundle; insufficient context is returned as `unverified` instead of stalling an unattended run. The evidence analyst is artifact-only, so controllers run repository-native verification commands and may delegate the results without opening an approval prompt. Kimi is read-only, while the explicit GLM experiment can edit but must request broad search or shell access. `general` and `explore` also deny interactive questions; `general` denies unknown external tools and authority-requiring shell operations and returns those needs to its controller.

The legacy automatic `advisor` tool is disabled and denied for every agent. `/advise` is a distinct native subtask: the developer supplies the exact question and context, and the read-only reviewer receives that command input rather than the parent transcript. A two-cluster planning-review proxy placed Opus 4.8 xhigh on the best observed quality/cost frontier among Opus, Sonnet, Sol, and Fable, but the winning reviewer changed by workload and the shipped isolated mechanism was not directly tested. Automatic-review evidence is still insufficient to justify paying for or disclosing context to an advisor on every task. `advisor_enabled: false` disables only `/advise`; changing `agents.advisor_reviewer` selects a different advisor model without enabling automatic review.

### Steps, goals, and local control

The `build`, `plan`, `general`, Luna, Terra, Sonnet, Sol, and Ultra execution agents ship without an OpenCode step cap. `explore`, the retained specialists, Kimi, and GLM default to 100 steps; `advisor_reviewer` defaults to 60. The local routing file's `steps` object accepts a positive integer to add or replace a limit or `null` to remove it. These are iteration controls, not quality guarantees.

The vendored Goal server is configured without an inherited token budget or elapsed-time limit. Its built-in automatic-turn default is 25, so the managed configuration uses JavaScript's maximum safe integer as a practical unlimited ceiling for overnight or multi-day Ultra jobs. These defaults apply to every newly created durable goal; existing goals retain limits already stored in their state. Three consecutive low-progress continuation turns and three consecutive prompt failures still pause a goal instead of allowing a broken provider or genuine loop to run indefinitely. Goal mutation is available only to `build`, the named model controllers, and Ultra; `plan`, `general`, and subagents cannot create or continue a goal. The global rules authorize a durable goal only after an explicit `/goal`, `/ultra`, or direct request to keep working. A developer can still request an explicit per-goal token, continuation, or elapsed-time limit.

The repository-managed Goal mode server and TUI provide durable session goals, continuation handling, `/goal` commands, and state persistence without a registry-loaded Goal plugin. It preserves the established `${XDG_DATA_HOME:-~/.local/share}/opencode-goal-plugin/goals.json` location so active goals remain available. The repository-managed workflow guard keeps the repeated system prefix cache-stable by replacing changing time, token, and continuation counters with a fixed instruction to call `get_goal`. Goal still enforces configured limits, and compaction still receives a live state snapshot at its cache-reset boundary. Closing a goal as complete requires canonical JSON evidence with schema version 1, a nonempty summary, one passed check per requested outcome, concrete typed evidence, and an empty `remaining_work` array. Goal's own private state stores the canonical string; the guard also writes a single-parse private record to `${XDG_DATA_HOME:-~/.local/share}/opencode/completion-evidence/` with directory mode `0700` and file mode `0600`. This structure makes evidence consumable by automation, but deterministic commands and runtime observations still determine whether the claims are true.

Setup creates and preserves a private local routing file with this shape:

```json
{
  "advisor_enabled": true,
  "agents": {},
  "steps": {}
}
```

### Skills, plugins, and installation

Harness-specific skill bodies stay separate: Claude source skills remain under `~/.claude/skills`, Codex-normalized skills under `~/.codex/skills`, and OpenCode links only otherwise-missing or OpenCode-only personal skills into `~/.config/opencode/skills`. Project-local skills can still collide with global names, so duplicate bodies must remain aligned or be renamed. Cross-harness MCP names in compatible skills are resolved against OpenCode's actual tool catalog rather than copied literally.

When the workspace CLI is available, setup refreshes the supported workspace-managed OpenCode bundles and MCP configuration. Plugin assets that contain harness-specific command or MCP syntax are normalized in config-local copies. Compatible skills and MCP tools carry over; Codex connector runtimes such as browser/computer use, office documents, mail, calendar, Workspace Agents, and connector-backed GitHub do not become OpenCode capabilities merely because their skills exist.

Installation preflights generated agents, commands, managed JSON, local routing, and required plugin assets before changing the active config. It symlinks repository-owned rules, agents, commands, and skills, while copying every repository-owned OpenCode plugin into the global plugin directory so runtime modules and their relative imports are self-contained under the active OpenCode configuration. It removes known retired repository links and known plugin-generated agents that their source package does not support on OpenCode; merges managed defaults while preserving unrelated providers, MCPs, plugins, agents, and permissions; consolidates a competing `opencode.jsonc` after backup; and restricts config and backup files to the current user. Workspace-plugin refresh and normalization are transactional, with restoration on failure. Preflight and post-install validation parse the managed policy and confirm installed assets without booting OpenCode's complete plugin tree; focused tests exercise effective agent permissions and the Goal runtime separately.

OpenCode exposes `apply_patch` to GPT-family models and `Edit`/`Write` to other model families. The global rules direct the active model to use the editing tool it actually receives.

Regenerate or validate the specialist declarations with:

```bash
python scripts/generate-opencode-agents.py
python scripts/generate-opencode-agents.py --check
```

Restart running OpenCode sessions after installation because agents, commands, plugins, and configuration are loaded at startup.

## Syncing agents

The `agents/` directory is a plain snapshot of [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) -- no submodule, no subtree. To pull in upstream updates:

```bash
# 1. Clone upstream to a throwaway location
TMP=$(mktemp -d)
git clone --depth 1 https://github.com/msitarzewski/agency-agents.git "$TMP/agency-agents"

# 2. Mirror its contents into agents/, removing files upstream has deleted
rsync -a --delete --exclude='.git' "$TMP/agency-agents/" agents/

# 3. Review, commit, and reference the upstream commit in the message
cd ~/Developer/claude-config
git status
UPSTREAM_SHA=$(git -C "$TMP/agency-agents" rev-parse --short HEAD)
git checkout -b Iron-Ham/sync-agency-agents-"$UPSTREAM_SHA"
git add agents/
git commit -m "chore: sync agents from msitarzewski/agency-agents@$UPSTREAM_SHA"
rm -rf "$TMP"
```

Notes:
- The `--delete` flag is intentional -- it prunes local files the upstream removed so the snapshot stays faithful.
- Nested `.github/` and `.gitignore` inside `agents/` are mirrored from upstream. The nested `.github/` is inert (GitHub only reads the repo-root one) and the nested `.gitignore` only scopes generated artifacts under `agents/integrations/*` that this repo doesn't produce.

## Customizing

After making changes, commit and push:

```bash
cd ~/Developer/claude-config
git add -A && git commit -m "chore: describe your change" && git push
```

On a new machine, just clone and re-run `./setup.sh`.
For Codex setup, run `./setup-codex.sh` as well.
For OpenCode setup, run `./setup-opencode.sh` as well.
