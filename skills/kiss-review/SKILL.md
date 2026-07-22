---
name: kiss-review
description: Performs an adversarial, evidence-driven review of a pull request or diff, emphasizing KISS, architectural ownership, contributor ergonomics, causal tests, and live verification. Use when the user asks for a critical PR review, evidence sufficiency assessment, architectural soundness review, or whether a change is the simplest appropriate solution.
---

# KISS Review

Review the change as a strong maintainer deciding whether it should merge, not as a patch summarizer.

## Inputs

Resolve the review target, exact head SHA, latest base SHA, PR title/body/commits, stack dependencies, changed files, CI state, and whether the user authorized posting. Treat linked evidence as claims to verify.

## Workflow

1. Read repository and path-local instructions. Load applicable review, platform, testing, simulator, security, or performance skills.
2. Fetch current refs. Record both exact head SHA and exact declared-base SHA. Create an isolated worktree from the latest base and merge the head with `--no-commit --no-ff`. Review the merged result plus the branch-only diff. In a stack, invalidate the review when either head or base changes; a force-pushed parent can change the effective child patch without changing the child head SHA.
3. Read every changed file in full. Trace owners, callers, callees, lifecycle hooks, competing state machines, tests, and equivalent implementations.
4. Build an intent-to-evidence map: every material claim must have current-head evidence that observes the claimed outcome.
5. Enforce the critical-behavior coverage boundary. For editors, authentication, permissions, data integrity, persistence, payments, and similarly high-impact surfaces:
   - Treat a coverage or harness PR as an observer of established behavior, never as an alternate route for shipping, redefining, or "stabilizing" production behavior.
   - Verify the product contract and cross-platform invariant before accepting the test oracle. A green test can faithfully encode the wrong behavior.
   - Require every production-facing or behavioral change to have one authoritative product PR, an explicit product rationale, and independent adversarial evidence through the real product boundary.
   - Block copied production fixes in a coverage stack until the owning PR lands and the copy is removed. Do not approve duplicate merge authorities because the harness needs the behavior.
   - Apply scrutiny proportional to blast radius. For an editor, validate focus/responder ownership, selection, composition, undo/redo, persistence/reopen, virtualization, accessibility, rapid input, cancellation, and competing generations as applicable.
6. Apply the KISS test before endorsing the architecture:
   - Can an established owner or primitive solve this?
   - Does the change duplicate retries, timers, registries, state, or cancellation?
   - Does correctness depend on opt-in booleans or contributors remembering scattered call sites?
   - Does a narrow fix rewrite unrelated UI or broaden platform behavior?
   - Is the added abstraction smaller than the coordination burden it creates?
7. Try to falsify the solution. Author temporary behavioral probes for inverse lifecycle order, concurrent owners, stale generations, timeout boundaries, cancellation races, partial state, and failure paths. Run a failing probe twice, capture exact output, then remove it.
8. Run targeted checked-in tests, builds, and live app verification when authorized. Use the real product path and exact merged head. Record `BLOCKED` honestly when environment or auth prevents the scenario.
9. Synthesize only findings supported by code or runtime evidence. Separate correctness blockers, evidence gaps, architectural/KISS concerns, and residual risks.
10. If posting is authorized, post inline findings plus a top-level determination. Never cite local-only paths. Upload every referenced screenshot, video, log, or report to the PR or durable GitHub assets and embed/link those uploaded assets.

See [REFERENCE.md](REFERENCE.md) for the evidence ladder, adversarial probe matrix, KISS rubric, and posting template.

## Decision rules

- Green CI proves only what ran.
- Component tests do not prove an end-to-end interaction chain.
- Evidence from another branch, combined stack, stale commit, closed harness, or after-only recording is supporting evidence, not current-head causal proof.
- A deterministic failure under a production-reachable ordering outranks a passing happy-path test.
- Coverage evidence cannot authorize a production behavior change. A test stack that needs different behavior has discovered product work and must defer to its separate authority.
- Reject implementation-shaped test oracles until the intended product behavior is independently established.
- Line count alone is not a KISS finding; duplicated ownership and contributor obligations are.
- Do not approve when unresolved P0/P1 findings remain.
- Do not post or mutate the PR without explicit user authorization.

## Output

Lead with `approve`, `request changes`, or `no material findings`, then list findings by severity with file/line, observable impact, proof, and smallest credible fix. Include validation performed, validation blocked, evidence sufficiency, KISS verdict, and artifact URLs when posted.
