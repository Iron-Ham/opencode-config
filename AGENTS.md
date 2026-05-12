# Personal Agent Instructions

## Agent Delegation Strategy

### General Rules
- **Prefer delegating** to a specialized agent when the task requires domain depth (architecture, security, UX, performance, etc.) — don't do specialist work inline when a purpose-built agent exists
- **Do work inline** for quick, focused tasks that don't need specialist knowledge
- **Parallel-spawn** independent agents when a task decomposes into sub-problems in different domains
- Use `isolation: "worktree"` for agents making code changes in parallel to avoid conflicts
- For Claude Code, route to the matching Markdown agent under `agents/`.
- For Codex, route to the matching custom agent from `codex/agents/*.toml` when one exists; otherwise use the built-in `explorer`, `worker`, or `default` agent roles.

### Task → Agent Routing

When you recognize these patterns, spawn the matching agent:

| Task pattern | Claude Code agent | Codex agent |
|---|---|---|
| System design, architecture decisions | Software Architect | `software_architect` |
| Deep code review | Code Reviewer | `code_reviewer` |
| Security audit, threat modeling | Security Engineer | `security_engineer` |
| Database schema/query optimization | Database Optimizer | `database_optimizer` |
| Complex frontend implementation | Frontend Developer | `frontend_developer` |
| API design/backend implementation | Backend Architect | `backend_architect` |
| Comprehensive test execution | Evidence Collector, API Tester | `evidence_collector` |
| Developer documentation | Technical Writer | `technical_writer` |
| Git workflow complexity | Git Workflow Master | `git_workflow_master` |
| Accessibility audit | Accessibility Auditor | `accessibility_auditor` |
| CI/CD, deployment, infrastructure | DevOps Automator | `worker` |
| Performance investigation | Performance Benchmarker | `worker` |
| UX/design decisions | UX Architect, UI Designer | `frontend_developer` or a design skill |
| Production incident | Incident Response Commander | `worker` |
| Mobile app work | Mobile App Builder | `worker` |
| AI/ML features | AI Engineer | `worker` |

### Multi-Agent Orchestration (NEXUS)

For tasks requiring multiple specialists, reference the NEXUS framework:
- **Docs:** `~/Developer/claude-config/agents/strategy/QUICKSTART.md` (start here)
- **Full doctrine:** `~/Developer/claude-config/agents/strategy/nexus-strategy.md`
- **Activation prompts:** `~/Developer/claude-config/agents/strategy/coordination/agent-activation-prompts.md`
- **Runbooks:** `~/Developer/claude-config/agents/strategy/runbooks/` (MVP, enterprise feature, marketing campaign, incident response)

Modes:
- **NEXUS-Micro** (1-5 days): bug fix, audit, single campaign — 5-10 agents
- **NEXUS-Sprint** (2-6 weeks): feature or MVP — 15-25 agents
- **NEXUS-Full** (12-24 weeks): complete product — all agents

When a task is clearly multi-phase or cross-domain, spawn the **Agents Orchestrator** to coordinate rather than managing agents yourself.

### Domain-Specific Agent Groups

Beyond engineering, remember these specialist clusters exist:
- **Sales:** Discovery Coach, Deal Strategist, Pipeline Analyst, Sales Engineer, Outbound Strategist
- **Marketing:** Platform specialists (TikTok, Instagram, LinkedIn, Reddit, Twitter, etc.), Content Creator, Growth Hacker, SEO Specialist
- **Product:** Product Manager, Sprint Prioritizer, Trend Researcher, Feedback Synthesizer
- **Design:** UX Architect, UI Designer, Brand Guardian, UX Researcher
- **Testing/QA:** Reality Checker (final authority), Evidence Collector, Performance Benchmarker, API Tester
- **Project Management:** Studio Producer, Senior Project Manager, Jira Workflow Steward
- **Spatial Computing:** visionOS Spatial Engineer, macOS Spatial/Metal Engineer, XR agents
- **Game Development:** Unity, Unreal, Godot, Roblox specialists + Narrative/Game/Level designers

## Semantic Git Tooling (`sem`)

[`sem`](https://ataraxy-labs.github.io/sem/) is installed globally and provides entity-level (function/class/method) understanding of code rather than line-level diffs. After `sem setup`, `git diff` is already routed through sem — so the guidance below is about the *other* sem subcommands that raw git can't express.

### Reach for sem when

| Task | Command |
|---|---|
| Blast radius before editing an entity | `sem impact <entity> [--file <path>] --json` |
| Per-entity authorship in a file | `sem blame <file>` |
| History of a single function/class | `sem log <entity>` |
| Discover entities in an unfamiliar file | `sem entities <file>` |
| Build an LLM-ready context block | `sem context <entity> --budget <tokens> --json` |

### Agent workflow rules

- **Before editing a non-trivial function**, run `sem impact <entity> --json` and fold dependents/affected tests into your plan.
- **When spawning a sub-agent that needs code context**, prefer `sem context <entity> --budget 4000 --json` over pasting whole files — it stays within the target agent's prompt budget and includes only the relevant dependency graph.
- **Always pass `--json`** when output feeds a programmatic consumer (another tool call, a sub-agent prompt). Plain output is for terminal rendering only.
- **Prefer the MCP integration** (`sem mcp` is an MCP stdio server) for repos you touch often — wire it into `.mcp.json` rather than shelling out repeatedly.

### Caveats

- sem supports ~26 languages; on unsupported files, fall back to standard git.
- **Do not** run `sem setup` or `sem unsetup` without explicit user confirmation — both mutate global git config.
- If you specifically need a raw unified line diff (patch application, parser expecting `--- +++` headers), use `git diff --no-ext-diff` to bypass the sem wrapper.

## Git Commit Guidelines

When creating git commits:

- **NEVER** add co-author lines (e.g., `Co-Authored-By: ...`)
- **NEVER** add "Generated with Claude Code" or similar attribution phrases
- **NEVER** reference Claude, Claude Code, AI, or any assistant in commit messages
- **NEVER** add links to claude.ai or anthropic.com in commits
- **NEVER** add emoji attributions like 🤖

### Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

- `feat: add user authentication endpoint`
- `fix: resolve memory leak in cache handler`
- `docs: update API documentation`
- `refactor: extract validation logic`
- `test: add unit tests for auth module`
- `chore: update dependencies`

Rules:
- Use lowercase for the type and description
- Keep subject line under 72 characters
- Use imperative mood ("add" not "added")
- No period at end of subject line

## Pull Request Guidelines

When creating pull requests:

- **ALWAYS** open PRs as **drafts** (`gh pr create --draft`) unless the user explicitly asks for a non-draft / ready-for-review PR
- **NEVER** add "Generated with Claude Code" or similar attribution phrases
- **NEVER** reference Claude, Claude Code, AI, or any assistant in PR titles or bodies
- **NEVER** add links to claude.ai or anthropic.com
- **NEVER** add emoji attributions like 🤖

### PR Format

- Title should be a meaningful, human-readable description of the change
- Do NOT use conventional commit prefixes like `feat:`, `fix:`, `chore:` in PR titles
- Write titles that clearly communicate what the PR accomplishes to reviewers
- Link to GitHub issues when applicable using `Closes #123` or `Fixes #456`
- Focus on the **what** and **why**, not the how
- Include a test plan section

Examples of good PR titles:
- "Add user authentication endpoint"
- "Fix memory leak in cache handler"
- "Update API documentation for v2 endpoints"
- "Extract validation logic into shared utility"

Examples of bad PR titles:
- "feat: add user authentication endpoint"
- "chore: update dependencies"
- "fix: bug"

## Branch Workflow

### Protected Branches

- **NEVER** commit directly to `main` or `master`
- **ALWAYS** create a feature branch before making changes
- If already on main/master, create a branch first before any commits

### Branch Naming

Use the format: `Iron-Ham/<description>`

Examples:
- `Iron-Ham/add-user-auth`
- `Iron-Ham/fix-memory-leak`
- `Iron-Ham/refactor-api-client`

For stacked branches, add numbered suffixes:
- `Iron-Ham/auth-1-models`
- `Iron-Ham/auth-2-endpoints`
- `Iron-Ham/auth-3-tests`

### One Commit Per Branch

Prefer working in branches where **each branch contains exactly one commit**. This supports a stacked branch workflow where:

- Each feature branch has a single, well-crafted commit
- When making the **first change** on a branch, **create a new commit**
- When making **additional changes** to a branch, **amend the existing commit** rather than creating new commits
- This makes rebasing stacked branches trivial after parent branches are squash-merged into `main`

When working on a branch:
- Use `git commit` for the initial commit
- Use `git commit --amend` for all subsequent changes
- Use `git push --force-with-lease` when updating remote branches after amending

### Working Branches for Multi-Phase Epics

For large, multi-phase efforts where work fans out into multiple parallel sessions and must re-converge before the next fan-out — the one-commit-per-branch rule does **not** apply. Use a dedicated **staging branch** named `Working-Branch/<identifier>` to incubate the entire epic before final review.

**When to use a `Working-Branch/*`:**

- The work decomposes into multiple phases that each require parallel sub-agents/sessions
- Each phase must complete and merge before the next phase can begin (fan-out → sync → fan-out)
- The end state is too large or interdependent for a single PR, but the intermediate boundaries are not the natural review boundaries
- The real human review pass should happen at the **end** of the epic, not at every intermediate checkpoint

**Branch identity and rules:**

- Naming: `Working-Branch/<identifier>` (e.g., `Working-Branch/auth-rewrite`, `Working-Branch/observability-v2`)
- A `Working-Branch/*` is **mine**, not collaborative — it has the same force-push freedom as `Iron-Ham/*` branches. The "any branch NOT matching `Iron-Ham/*` is shared" rule (see Edge Cases below) does **not** apply to `Working-Branch/*`
- **Multiple commits are allowed and expected.** Do NOT amend, squash, or rewrite history on the working branch during the epic — phase branches need a stable target to rebase against
- Branched from `main` (or the appropriate base) at the start of the epic
- Lives until the epic is fully complete, validated, and verified — then dies after the split (see below)

**Phase workflow:**

1. Create `Working-Branch/<id>` from `main` and push it
2. For each phase, spawn parallel sub-branches off the working branch using standard `Iron-Ham/<id>-N-<phase>` naming
3. Each phase opens its own draft PR **targeting the working branch** (not `main`), gets a light validation pass, and merges into the working branch
4. Subsequent phases rebase against the updated working branch before opening their PRs
5. Repeat until the epic is functionally complete

**Closing the epic:**

1. Confirm the working branch is fully validated and verified end-to-end (tests pass, feature works)
2. Use the `split` skill to break the working branch into _n_ logically stacked PRs targeting `main`
3. The **real** review pass happens here — each split PR is a coherent, reviewable unit
4. Use the `rebase-stack` skill to cascade changes through the stack as upstream merges land
5. Once all split PRs are merged into `main`, delete `Working-Branch/<id>`

This pattern trades intermediate-PR review rigor for end-of-epic review coherence: the in-epic PRs are checkpoints, not the review surface.

### Edge Cases

**If branch already has multiple commits:**
- Do NOT squash or rewrite history without explicit user confirmation
- Ask user how they want to proceed
- Exception: `Working-Branch/*` branches are expected to have multiple commits — this rule does not apply to them

**If working on a shared/collaborative branch:**
- Do NOT force push without explicit user instruction
- Use regular `git push` and handle conflicts normally
- **Assume any branch NOT matching `Iron-Ham/*` or `Working-Branch/*` is shared/collaborative** (e.g., someone else's PR, a release branch, etc.)

**If branch is stale and needs updating:**
- Use `git pull --rebase` to keep history linear

### Pre-Push / Pre-PR Rebase

Before pushing to remote or opening a pull request, **always** ensure the branch is rebased on the latest base branch (which may be `main`, `master`, or a parent feature branch in a stacked PR workflow):

1. Run `git fetch origin` to get the latest remote state
2. Determine the correct base branch (e.g., `main` for standalone PRs, or the parent branch for stacked PRs)
3. Run `git rebase origin/<base-branch>` to rebase onto the latest base
4. Resolve any conflicts before proceeding
5. Only then push or create the PR

This ensures PRs are always up-to-date and minimizes merge conflicts.

## Config Sync

This file and the surrounding config (`settings.json`, `agents/`, `codex/agents/`, `skills/`, `codex/skills/`, `commands/`) are backed up to `~/Developer/claude-config/` (repo: `Iron-Ham/claude-config`). Claude Code config is symlinked into `~/.claude/`; Codex instructions, custom agents, and Codex-normalized skills are symlinked by `setup-codex.sh`.

- After modifying any of these files, **commit and push** the changes:
  ```
  cd ~/Developer/claude-config && git add -A && git commit -m "chore: <describe change>" && git push
  ```
- On a new machine, clone and run `setup.sh` to restore symlinks:
  ```
  git clone git@github.com:Iron-Ham/claude-config.git ~/Developer/claude-config
  cd ~/Developer/claude-config && ./setup.sh
  ```
- For Codex, also run:
  ```
  cd ~/Developer/claude-config && ./setup-codex.sh
  ```

## Testing Requirements

- Write tests for new functionality when a test suite exists in the project
- Run existing tests before committing to ensure no regressions
- If tests fail, fix them before proceeding (unless user explicitly says otherwise)
- Match the testing patterns and frameworks already used in the project

## Documentation Style

- Add inline comments only for complex or non-obvious logic
- Do NOT add comments that merely restate what the code does
- Update existing documentation (README, docstrings) when changing public APIs
- Do NOT create new documentation files unless explicitly requested
- Match the documentation style already present in the project
