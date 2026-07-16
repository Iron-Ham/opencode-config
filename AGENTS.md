# Personal Agent Instructions

## Agent Delegation Strategy

### General Rules
- Delegate only when the child adds a useful permission boundary, independent context, parallelism, or a reviewed domain procedure. A specialist name or borrowed persona is not evidence of specialist capability.
- **Do work inline** for quick, focused tasks that don't need specialist knowledge
- **Parallel-spawn** independent agents when a task decomposes into sub-problems in different domains
- Use `isolation: "worktree"` for agents making code changes in parallel when the harness and repository permit it. OpenCode native Task agents share the active workspace, so delegate only non-overlapping writes there.
- For Claude Code, route to the matching Markdown agent under `agents/`.
- For Codex, route to the matching custom agent from `codex/agents/*.toml` when one exists; otherwise use the built-in `explorer`, `worker`, or `default` agent roles.
- For OpenCode, route to the matching global underscore-named subagent when one exists; otherwise use `explore` for bounded discovery. Use `general` for independent writable analysis only when the active controller permits it; otherwise work inline.

### Task → Agent Routing

Use this table only after delegation passes the general rules above. A matching task pattern is a routing hint, not an instruction to spawn a child.

| Task pattern | Claude Code agent | Codex agent | OpenCode agent |
|---|---|---|---|
| System design, architecture decisions | Software Architect | `software_architect` | `software_architect` |
| Deep code review | Code Reviewer | `code_reviewer` | `code_reviewer` |
| Security audit, threat modeling | Security Engineer | `security_engineer` | `security_engineer` |
| Database schema/query optimization | Database Optimizer | `database_optimizer` | `database_optimizer` |
| Complex frontend implementation | Frontend Developer | `frontend_developer` | `general` + applicable design skill |
| API design/backend implementation | Backend Architect | `backend_architect` | `general` |
| Comprehensive test execution | Evidence Collector, API Tester | `evidence_collector` | controller commands + `evidence_analyst` |
| Developer documentation | Technical Writer | `technical_writer` | `general` + repository documentation guidance |
| Git workflow complexity | Git Workflow Master | `git_workflow_master` | controller + applicable Git skill |
| Accessibility audit | Accessibility Auditor | `accessibility_auditor` | `accessibility_auditor` |
| CI/CD, deployment, infrastructure | DevOps Automator | `worker` | `general` |
| Performance investigation | Performance Benchmarker | `worker` | `general` |
| UX/design decisions | UX Architect, UI Designer | `frontend_developer` or a design skill | `general` or a design skill |
| Production incident | Incident Response Commander | `worker` | `general` |
| Mobile app work | Mobile App Builder | `worker` | `build` + applicable mobile skill |
| AI/ML features | AI Engineer | `worker` | `general` |

For mobile verification in OpenCode, use the applicable `verify-mobile-change`, iOS simulator, Android UI, or performance skill. The controller runs commands and may give the resulting artifacts to `evidence_analyst` for independent interpretation.

### OpenCode Runtime Semantics

When running under OpenCode:

- Use `build` as the GPT-5.6 Terra xhigh controller and owner of durable production implementation. Use `general` for a substantial independent writable slice; it inherits the invoking Build or Ultra model unless the developer explicitly overrides it. Use Terra-backed `plan` for read-only planning, `/luna` for bounded cost-sensitive implementation with strong deterministic checks, `/sonnet` for an explicit Sonnet session, `/sol` when Sol itself should implement, and `explore` for bounded repository discovery. Use inline read/search tools for trivial lookups. Machine-local routing may replace role-based models; model-branded `/luna`, `/terra`, `/sonnet`, and `/sol` lanes remain pinned. Open-weight experiment commands pin both model and provider.
- Use the thin OpenCode specialists only for a bounded independent review: `code_reviewer`, `software_architect`, `security_engineer`, `accessibility_auditor`, and optional `database_optimizer`. Skills and repository instructions own domain procedure; the specialist supplies isolation and a second context. They inherit the invoking primary model unless the developer explicitly configures a local model override, so a role name does not silently change the model or provider. A code-review request must include the diff or exact changed files and intended behavior. `evidence_analyst` analyzes an exact claim checklist and already-produced artifacts only; the controller runs deterministic verification commands. When these instructions call for an unavailable role, use `general` only if the active controller permits it; otherwise work inline.
- Proactively delegate independent, bounded work when it improves latency or confidence. Native Task children share the active workspace, so never assign overlapping writes and keep the controller responsible for reconciling changes.
- Outside `/ultra`, keep OpenCode delegation to an instructional ceiling of two concurrent and four total subagents unless the user explicitly requests broader orchestration. `/ultra` uses an instructional ceiling of four concurrent and eight total. OpenCode does not enforce these counters at runtime, so the controller must track them.
- Do not treat a specialist prompt as a model-quality claim. Long-horizon production implementation stays with `build`; independent writable slices use `general`. The reviewed specialists are read-only procedural wrappers, not simulated experts. They receive an exact diff, source boundary, or evidence bundle from the controller and cannot run broad content search or open an interactive question prompt; missing context is returned as `unverified`. `general`, `explore`, and every subagent also deny interactive questions so unattended delegation cannot quietly pause. For a consequential developer-selected challenge, `/advise` remains a separate isolated command whose model is locally configurable.
- Use the hidden experimental open-weight agents only through developer-invoked commands. `/kimi` and `/glm` retain Baseten as a comparison route; `/kimi-fireworks`, `/glm-fireworks`, `/kimi-fireworks-fast`, and `/glm-fireworks-fast` pin exact Fireworks Standard or Fast model IDs. Ordinary controller Task allowlists deny both agents. Provider availability is not role evidence: Kimi and GLM have no retained matched provider outcome data and must not be selected automatically for Build, Plan, compaction, advisors, or specialists. Compare the complete model/provider/serving-path/reasoning route, and stop after repeated provider errors.
- The legacy automatic `advisor` tool is disabled and denied for every agent. `/advise` is the only independent-advisor path: it is a developer-invoked native subtask using the read-only `advisor_reviewer`. Its shipped Opus 4.8 xhigh model is a provisional transfer from a two-cluster planning-review comparison and remains locally configurable. It receives only the command prompt and arguments, not the parent transcript. Controllers must not invoke or emulate it automatically; when independent review could materially change a decision, state the exact question a developer could pass to `/advise`. The machine-local routing file can disable this lane or override `agents.advisor_reviewer` with another `provider/model` identifier.
- Create a durable goal only after an explicit `/goal`, `/ultra`, or direct request to keep working toward an objective. Keep it active until the requested outcomes have evidence or a concrete blocker requires user authority. Plan cannot execute or resume a goal.
- Goal reminders deliberately omit changing counters from the repeated system prefix. Call `get_goal` when live usage, limits, checkpoints, or status matter; the Goal runtime enforces configured limits independently. To close a goal as complete, pass `update_goal.evidence` as canonical JSON with `schema_version: 1`, a nonempty `summary`, one `passed` check with concrete typed evidence for every requested outcome, and `remaining_work: []`. The workflow guard rejects prose-only or incomplete evidence and stores a private machine-readable record; structure does not replace deterministic verification.
- `/ultra` means the configured production controller plus expanded, bounded native subagents and durable goals. Its backing `ultra` primary is hidden from the TUI primary selector and denies interactive questions and Plan entry; `/ultra` is the supported entry point because invoking the backing agent directly would not execute the command template. Hidden is a UI property, not an access-control boundary. Its durable goal inherits no token budget, automatic-turn limit, or elapsed-time limit, so it can remain active for unattended overnight or multi-day work; explicit developer-requested limits and the provider-failure and no-progress loop guards still apply. The shipped route uses Terra xhigh because no retained evidence justifies a separate premium model merely for orchestration. It approximates Codex Ultra but does not reproduce Codex runtime semantics; independent review remains an explicit developer `/advise` action.
- `/terra` explicitly selects the same pinned GPT-5.6 Terra xhigh model used by the production default. `/luna` selects pinned Luna high for small, well-specified work where deterministic checks bound the downside. In the one matched production-shaped cluster that included both Luna efforts, high completed within the boundary at nearly the same quality while xhigh crossed it, took more than twice as long, and cost more; this does not establish production-quality parity with Terra. On two production-shaped source workloads Terra completed both while Luna xhigh crossed the read boundary twice, and Terra's complete combined cost was only 8.4% above Luna's incomplete lower-bound cost. `/sonnet` and `/sol` provide explicit model lanes. `/advise` is a separate developer-invoked read-only review lane.
- Task access is allowlisted per primary controller. Role-based `build` and `/ultra` may delegate writable independent slices to `general`, which inherits the controller model unless explicitly overridden; model-branded `/luna`, `/terra`, `/sonnet`, and `/sol` keep implementation in their pinned controller and may delegate only to read-only children that inherit the controller model by default. `evidence_analyst` is artifact-only and may run unattended because it has no shell or interactive tools. Experimental agents and the advisor lane are never automatic Task targets.
- OpenCode exposes `apply_patch` to GPT-family models and `Edit`/`Write` to non-GPT models. Use the editing tool that the active model actually receives; a repository instruction naming an unavailable editing tool does not require inventing or shell-emulating it.
- The managed Fireworks catalog makes GLM 5.2 and Kimi K2.7 Code Standard and Fast routes selectable without storing a credential. Authenticate through OpenCode or a launcher-provided `FIREWORKS_API_KEY`. Fireworks Fast remains an explicit latency experiment because its GLM list price is 1.5 times Standard and its Kimi list price is 2 times Standard; vendor throughput claims are not OpenCode wall-time evidence.
- Skills copied from another harness may spell an MCP tool as `mcp__<server>__<tool>`. Resolve that reference against OpenCode's active tool catalog, whose equivalent is normally `<sanitized-server>_<sanitized-tool>`, and call the exact exposed identifier. Treat a named tool with no catalog match as unavailable; do not invent it. Likewise, route a Claude `general-purpose` child to OpenCode's `general` agent unless a more specific global agent matches.
- Keep Terra xhigh as the default controller for production iOS/Swift work. Across two production-shaped source workloads it completed and respected the read boundary twice, while Luna xhigh violated the boundary twice; Terra was about 25% faster, and its complete cost was only 8.4% above Luna's incomplete lower-bound cost. Neither model proved full shipping-workflow parity, so tests and runtime evidence remain mandatory. Use `/luna` only for bounded tasks where failure is cheaply detectable. Automatic transcript-fed advice and explicit `/advise` are different treatments; do not infer the value of one from evidence about the other. Reconcile every review against source and test evidence.
- Do not port or invoke the borrowed Mobile App Builder persona in OpenCode. It contains generic, stale platform guidance and has no local outcome evidence. Route mobile implementation through `build`, repository-local mobile instructions, and the applicable mobile skill.
- Let OpenCode compaction inherit the active session model. Pinned GPT-5.6 aliases use a 256,000-token operational input limit, so the 20,000-token reserve triggers compaction around 236,000 tokens before the 272,000-token pricing tier; direct base GPT routes retain full long-context capacity. This guard is not a hard ceiling for oversized individual turns. Do not add a universal cross-provider compactor without direct retention evidence and explicit transcript-egress approval.
- Native LSP support defaults to enabled while respecting a developer's global override. When the standard shell dispatcher sets the private LSP flags, SourceKit resolves from the Xcode toolchain, the model receives navigation tools, and unattended language-server downloads are disabled. Use LSP diagnostics and navigation when they shorten iOS/Swift feedback loops, but treat repository builds, tests, and runtime verification as authoritative.
- Preserve unrelated user changes, inspect the final diff, run verification proportional to risk, and restart OpenCode after configuration-time changes.

### Multi-Agent Orchestration (NEXUS)

For tasks requiring multiple specialists, reference the NEXUS framework:
- **Docs:** `~/Developer/claude-config/agents/strategy/QUICKSTART.md` (start here)
- **Full doctrine:** `~/Developer/claude-config/agents/strategy/nexus-strategy.md`
- **Activation prompts:** `~/Developer/claude-config/agents/strategy/coordination/agent-activation-prompts.md`
- **Runbooks:** `~/Developer/claude-config/agents/strategy/runbooks/` (MVP, enterprise feature, marketing campaign, incident response)

OpenCode does not install the borrowed Agents Orchestrator persona. Under OpenCode, treat NEXUS as planning guidance only and use `/ultra` for bounded native orchestration; do not invent or auto-route to an unavailable orchestrator.

Modes:
- **NEXUS-Micro** (1-5 days): bug fix, audit, single campaign — 5-10 agents
- **NEXUS-Sprint** (2-6 weeks): feature or MVP — 15-25 agents
- **NEXUS-Full** (12-24 weeks): complete product — all agents

Outside OpenCode, when a task is clearly multi-phase or cross-domain, spawn the **Agents Orchestrator** to coordinate rather than managing agents yourself. Under OpenCode, use the `/ultra` boundary above.

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

- In `notion-next`, never run a local typecheck command, including `notion typecheck`, `tsc`, or a package-level typecheck script. Typechecking is CI-owned because even scoped local runs can take an unreasonable amount of time. Use language-server diagnostics, targeted lint, focused tests, builds, and CI results for type evidence.
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
