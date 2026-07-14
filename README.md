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

`setup.sh` symlinks Claude Code config into `~/.claude/`. `setup-codex.sh` symlinks `AGENTS.md`, generated Codex custom agents, and generated Codex-normalized skills into Codex-only locations while leaving `~/.codex/config.toml` untouched. `setup-opencode.sh` explicitly installs global OpenCode rules, generated specialist agents, Luna, Terra, Sonnet, and Ultra commands, managed model/plugin defaults, and the supported Notion OpenCode bundles when the `notion` CLI is available. It requires Python 3, Bun, and the OpenCode CLI; a clean Notion-plugin installation also requires the `notion` CLI, and npm is needed only when the pinned OpenCode plugin SDK is absent or outdated. The installer uses Bun for native JSONC parsing and preserves unmanaged providers, MCPs, plugins, agents, and permissions outside the explicitly managed roles and security surfaces. It then synchronizes the config-local OpenCode plugin SDK with lifecycle scripts disabled. Existing non-symlink files are backed up with a `.bak.*` suffix before being replaced.

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
| `opencode/agents/` | Curated OpenCode subagents plus an opt-in GLM worker |
| `opencode/commands/` | Luna xhigh, Terra xhigh, Sonnet provider-default, and Ultra (Sonnet 5 max) execution lanes |
| `opencode/*.defaults.json` | Managed OpenCode defaults merged with machine-local JSON configuration |
| `skills/` | Source skills, including Claude Code-compatible metadata and resources |
| `codex/skills/` | Codex-normalized skills generated from `skills/` |
| `commands/` | Custom slash commands |
| `scripts/generate-codex-agents.py` | Regenerates `codex/agents/*.toml` from `agents/**/*.md` |
| `scripts/generate-opencode-agents.py` | Regenerates the curated `opencode/agents/*.md` specialist subset |
| `scripts/merge-opencode-config.mjs` | Safely merges managed defaults into machine-local OpenCode JSON files |
| `scripts/validate-opencode-agents.mjs` | Resolves every managed OpenCode agent and enforces controller/read-only boundaries |
| `scripts/test-opencode-config.mjs` | Regression-checks permission ordering, pinned aliases, and machine-local merge preservation |
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

The installers keep harness-specific skill bodies separate: Claude source skills live under `~/.claude/skills`, Codex-normalized skills under `~/.codex/skills`, and unrelated cross-harness skills may remain under `~/.agents/skills`. OpenCode uses the Claude source body when present and links only otherwise-missing or OpenCode-only personal skills into `~/.config/opencode/skills`. This removes repo-managed global duplicates while retaining the same personal catalog across harnesses. A project-local skill can still collide with a global skill of the same name; keep those bodies aligned or rename one because OpenCode does not define a stable duplicate winner. OpenCode also installs the same curated specialist set used by Codex. The shared `AGENTS.md` is OpenCode's global rules file, so project-level instructions retain higher precedence. Primary agents preserve OpenCode's provider-family prompts; custom specialist bodies intentionally replace those prompts with domain-specific instructions.

The managed defaults route both `build` and `general` to a pinned GPT-5.6 Luna xhigh alias, planning and curated specialists to Sonnet 5 high, compaction to base Sonnet 5 while reusing an explicit session variant when one exists, exploration to a shell-free Kimi K2.7 Code reader, and keep GLM 5.2 as an explicit opt-in worker. Luna earned the routine iOS default by meeting the full hidden Swift quality floor in every controlled trial at the lowest mean cost. `/terra` is the measured low-latency lane, `/sonnet` provides pinned provider-default Sonnet 5 for broad repository forensics and recovery after Luna stalls, and `/ultra` remains Sonnet 5 max. No global `small_model` is pinned, so OpenCode chooses title/summary helpers from the active provider instead of automatically sending every root prompt to Baseten. A long Luna session still compacts through Sonnet, so the default lane is not provider-contained and its end-to-end cost includes any Anthropic compaction call. The OpenAI model overrides correct OpenCode's stale Luna, Sol, and Terra context, input, output, cache-read, and cache-write metadata from official model pages and extend transport timeouts for long xhigh responses. OpenCode 1.17.20 drops `variant` from command definitions and lets the UI's current variant override an agent variant, so `/luna`, `/terra`, `/sonnet`, and `/ultra` target provider-model aliases whose base options pin the intended effort while disabling inherited variant overlays. `/ultra` adds bounded native subagents instead of a workflow plugin that could launch writable workers. Goal 0.1.24 is pinned with a 200,000-token default budget, 25 automatic continuations, and a one-hour duration cap.

The Notion advisor plugin is refreshed through the supported repository tooling and its machine-local override is reproducibly set to GPT-5.6 Sol xhigh. Only primary controllers can reach it, preventing delegated fan-out from multiplying expensive advisor calls. `build`, `plan`, `/luna`, `/terra`, and `/sonnet` require interactive approval unless the user grants session-wide approval; explicit `/ultra` may call it directly. Routine work is advisor-free; non-Ultra workflows use at most one Sol call unless contradictory evidence requires reconciliation. Advisor calls send roughly 60,000 recent characters of conversation and tool context to OpenAI; Luna- or Terra-to-Sol stays within OpenAI, while Sonnet and Ultra cross the provider boundary. The global rules skip that gate for transcripts not approved for OpenAI. Mobile, mobile iOS, observability, and Tuist bundles are refreshed through the same supported flow. A clean installation requires the `notion` CLI; an existing installation can continue with a warning if the CLI is temporarily unavailable.

Machine-local JSON settings are merged into `opencode.json`; valid JSONC comments and trailing commas are parsed, then `opencode.jsonc` is backed up and consolidated so it cannot silently override managed roles afterward. Managed JSON and agent inputs are preflighted before installation; installed Goal and advisor tools receive a post-install runtime validation. Config and backup files are restricted to the current user. The observability bundle's known Codex-only AWS MCP entries are pruned from OpenCode; unrelated MCP entries remain intact. Global runtime rules translate cross-harness `mcp__server__tool` references to exact identifiers from OpenCode's active MCP catalog and reject named-but-absent tools. The two mobile on-call commands and mobile design-review prerequisites that require literal harness syntax are copied into config-local regular files and normalized without mutating their plugin sources.

Codex connector/plugin packages are not portable OpenCode packages. This setup does not migrate the Codex browser/computer-use, documents, spreadsheets, presentations, Gmail, Google Calendar, Workspace Agents, or GitHub connector runtimes. GitHub repository work remains available through the project CLI, and Sentry is supplied through the installed Notion observability bundle, but those are not connector-equivalent migrations. OpenCode receives compatible personal and Notion skills plus configured MCP tools; workflows that require the remaining Codex-only runtimes remain Codex-only.

OpenCode exposes `apply_patch` to GPT-family models and its `Edit`/`Write` tools to other model families. The global rules tell each model to use the editing tool it actually receives, which avoids a tool-name mismatch when repository instructions were written for another harness.

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
