# Personal Agent Instructions

## Agent Delegation Strategy

### General Rules
- **Prefer delegating** to a specialized agent when the task requires domain depth (architecture, security, UX, performance, etc.) — don't do specialist work inline when a purpose-built agent exists
- **Do work inline** for quick, focused tasks that don't need specialist knowledge
- **Parallel-spawn** independent agents when a task decomposes into sub-problems in different domains
- Use `isolation: "worktree"` for agents making code changes in parallel when the harness and repository permit it. OpenCode native Task agents share the active workspace, so delegate only non-overlapping writes there.
- For Claude Code, route to the matching Markdown agent under `agents/`.
- For Codex, route to the matching custom agent from `codex/agents/*.toml` when one exists; otherwise use the built-in `explorer`, `worker`, or `default` agent roles.
- For OpenCode, route to the matching global underscore-named subagent when one exists; otherwise use `explore` for bounded discovery and `general` for independent analysis.

### Task → Agent Routing

When you recognize these patterns, spawn the matching agent:

| Task pattern | Claude Code agent | Codex agent | OpenCode agent |
|---|---|---|---|
| System design, architecture decisions | Software Architect | `software_architect` | `software_architect` |
| Deep code review | Code Reviewer | `code_reviewer` | `code_reviewer` |
| Security audit, threat modeling | Security Engineer | `security_engineer` | `security_engineer` |
| Database schema/query optimization | Database Optimizer | `database_optimizer` | `database_optimizer` |
| Complex frontend implementation | Frontend Developer | `frontend_developer` | `frontend_developer` |
| API design/backend implementation | Backend Architect | `backend_architect` | `backend_architect` |
| Comprehensive test execution | Evidence Collector, API Tester | `evidence_collector` | `evidence_collector` |
| Developer documentation | Technical Writer | `technical_writer` | `technical_writer` |
| Git workflow complexity | Git Workflow Master | `git_workflow_master` | `git_workflow_master` |
| Accessibility audit | Accessibility Auditor | `accessibility_auditor` | `accessibility_auditor` |
| CI/CD, deployment, infrastructure | DevOps Automator | `worker` | `general` |
| Performance investigation | Performance Benchmarker | `worker` | `general` |
| UX/design decisions | UX Architect, UI Designer | `frontend_developer` or a design skill | `frontend_developer` or a design skill |
| Production incident | Incident Response Commander | `worker` | `general` |
| Mobile app work | Mobile App Builder | `worker` | `build` + applicable mobile skill |
| AI/ML features | AI Engineer | `worker` | `general` |

For mobile verification in OpenCode, use the applicable `verify-mobile-change`, iOS simulator, Android UI, or performance skill before falling back to the generic `evidence_collector`.

### OpenCode Runtime Semantics

When running under OpenCode:

- Use `build` as the GPT-5.6 Luna xhigh controller and owner of routine durable implementation. Use `general` for substantial independent Luna analysis, `plan` for read-only Sonnet 5 high-effort planning, `/terra` for latency-sensitive work, `/sonnet` for broad repository forensics or after Luna stalls, and `explore` for fast bounded discovery.
- Route specialist work to the matching underscore-named global subagent. When these instructions call for an Agents Orchestrator and no matching OpenCode agent exists, the `build` controller coordinates the specialist subagents directly.
- Proactively delegate independent, bounded work when it improves latency or confidence. Native Task children share the active workspace, so never assign overlapping writes and keep the controller responsible for reconciling changes.
- Outside `/ultra`, keep OpenCode delegation to at most two concurrent and four total subagents unless the user explicitly requests broader orchestration. `/ultra` may use its four-concurrent, eight-total cap.
- Use `glm_worker` only when GLM 5.2 is explicitly requested or a bounded open-weight comparison is useful. Stop after repeated provider errors.
- The `advisor` tool is the isolated GPT-5.6 Sol xhigh path. Only a primary controller calls it; delegated agents return evidence to the controller instead. Routine work is advisor-free. Call Sol for genuinely high-risk decisions, repeated stalls, or a material change of direction; outside `/ultra`, use at most one advisor call unless primary-source evidence and the advice conflict and require reconciliation. `/ultra` may use separate pre-implementation and post-verification gates.
- Advisor calls transmit the recent conversation and tool transcript to OpenAI. Luna- or Terra-to-Sol stays within OpenAI; Sonnet and Ultra calls cross from Anthropic. Do not call the advisor when the transcript contains secrets or data that is not approved for OpenAI; report the skipped gate instead.
- Create a durable goal only after an explicit `/goal`, `/ultra`, or direct request to keep working toward an objective. Keep it active until the requested outcomes have evidence or a concrete blocker requires user authority. Plan cannot execute or resume a goal.
- `/ultra` means a pinned Sonnet 5 max model alias plus proactive bounded native subagents and the isolated Sol advisor. It approximates Codex Ultra but does not reproduce Codex runtime semantics.
- `/luna` explicitly selects the same pinned GPT-5.6 Luna xhigh model used by the routine default. `/terra` selects pinned Terra xhigh as a faster but roughly twice-as-expensive measured implementation lane. `/sonnet` selects provider-default Sonnet 5 for deep repository research, high ambiguity, or recovery after Luna stalls. Sol review is same-provider for Luna and Terra and should be reserved for consequential work.
- OpenCode exposes `apply_patch` to GPT-family models and `Edit`/`Write` to non-GPT models. Use the editing tool that the active model actually receives; a repository instruction naming an unavailable editing tool does not require inventing or shell-emulating it.
- Skills copied from another harness may spell an MCP tool as `mcp__<server>__<tool>`. Resolve that reference against OpenCode's active tool catalog, whose equivalent is normally `<sanitized-server>_<sanitized-tool>`, and call the exact exposed identifier. Treat a named tool with no catalog match as unavailable; do not invent it. Likewise, route a Claude `general-purpose` child to OpenCode's `general` agent unless a more specific global agent matches.
- Keep Luna xhigh as the default controller for iOS/Swift implementation: it met the full hidden quality floor in all controlled trials at the lowest mean cost. Escalate broad monorepo forensics to `/sonnet`, because Luna can time out on long source investigations. Keep Sol approval-gated as the higher-upside but inconsistent review path: it outperformed Terra as an advisor and improved two of three drafts, but materially harmed one.
- Preserve unrelated user changes, inspect the final diff, run verification proportional to risk, and restart OpenCode after configuration-time changes.

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

This file and the surrounding config (`settings.json`, `agents/`, `codex/agents/`, `opencode/agents/`, `opencode/commands/`, `skills/`, `codex/skills/`, `commands/`) are backed up to `~/Developer/claude-config/` (repo: `Iron-Ham/claude-config`). Claude Code config is symlinked into `~/.claude/`; Codex instructions, custom agents, and Codex-normalized skills are symlinked by `setup-codex.sh`; OpenCode rules, agents, commands, and managed defaults are installed by `setup-opencode.sh`.

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
- For OpenCode, also run:
  ```
  cd ~/Developer/claude-config && ./setup-opencode.sh
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

## Comments

Every code comment must **stand alone** — fully understandable to a reader who has no access to the conversation, branch, ticket, date, or author that produced it. A comment describes the code as it is, for whoever reads it next. The following are strictly disallowed:

- **No temporal references.** A comment must not anchor to a moment in time or to the act of changing the code. Banned phrasing includes "now", "new", "old", "recently", "previously", "as of `<date>`", "for now", "temporary", "changed to", and "used to". State what the code does — never what it used to do or what it just became.
- **No references to local or ephemeral materials.** Do not point at anything a future reader cannot resolve from the code alone: "see the file we discussed", "per the conversation above", "as in the sibling branch", a colleague's name, or local-only paths. If it only makes sense in the authoring context, it does not belong in a comment.
- **External references must be durable links, never tracker IDs.** When a comment genuinely needs to cite an external source, use a full, durable URL (a spec, RFC, standards page, or permalink). Do NOT cite bare tracker IDs such as `JIRA-1234`, `#567`, or `TICKET-89` — they are opaque, mutable, and unresolvable out of context.
- **No references to merged work — at all.** Comments must never reference merged, landed, or shipped changes, whether **temporally** ("after the auth rewrite merged", "since the v2 migration") or **referentially** ("see PR #123", "introduced in commit `abc123`", "from the cache refactor"). Merged work lives in git history, not in source comments.

The test: if stripping away all surrounding context — the PR, the ticket, the date, the author, the discussion — would make the comment confusing or meaningless, rewrite it to describe the code itself.
