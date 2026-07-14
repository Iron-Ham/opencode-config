# KISS Review Reference

## Evidence ladder

Rank evidence from strongest to weakest:

1. Current merged-head red/green regression through the real product boundary.
2. Current-head integration test observing the complete user/system outcome.
3. Current-head focused unit tests proving individual invariants.
4. Current-head build and broad regression suite.
5. Live interaction on the exact current-head binary with reproducible setup.
6. Tests from a different branch, combined stack, or older implementation.
7. After-only screenshots/video and implementation-shaped mocks.
8. Prose claims.

For each PR claim, record:

| Claim | Required observation | Current-head proof | Gap |
| --- | --- | --- | --- |
| Bug reproduced | Original failure occurs without fix | Red test or authentic before | |
| Fix works | Complete outcome succeeds | Product-boundary green test | |
| No regression | Adjacent contracts remain valid | Targeted suite/build | |
| Cancellation safe | Competing intent wins | Race/interleaving test | |
| Contributor-safe | New path is hard to misuse | Typed ownership/defaults | |

## KISS rubric

Ask these in order:

1. **Single owner:** Is there exactly one owner for focus, scroll, navigation, persistence, responder state, or another scarce resource?
2. **Reuse:** Is there an existing retry engine, registry, coordinator, reducer state, component, or lifecycle hook?
3. **Locality:** Can a contributor understand and change the behavior in one place?
4. **Typed contract:** Does the type express policy, or must callers remember a Boolean/flag/order?
5. **Preemption:** When intents compete, is priority explicit and tested?
6. **Surface area:** Does the fix alter unrelated accessibility, styling, platform adaptation, menus, persistence, or public API behavior?
7. **Removal test:** If half the new machinery were removed, what invariant would actually be lost?

A meaningful KISS finding names the operational cost: a reproduced race, divergent state machines, hidden call-site convention, parity burden, or future regression path.

## Adversarial probe matrix

Prefer small behavioral probes. Avoid source-text assertions.

- Reverse lifecycle order: unregister-before-register and register-before-unregister.
- Concurrent owners: two retry loops or navigation intents targeting different IDs.
- Generation replacement: stale task completes after a newer request.
- Success boundary: completion immediately before/after the final retry.
- Cancellation ownership: drag, menu, navigation, dismissal, selection, and focus change.
- Partial materialization: model exists but view is unmounted; view mounts without responder.
- Identity reuse: same logical ID with a replacement view/store.
- Failure rollback: optimistic state succeeds while commit fails.
- Platform variants: keyboard modes, iPad presentation, accessibility activation, reduced motion.

For every probe:

1. State the production-reachable ordering.
2. Use real owners/helpers where practical.
3. Assert an observable contract.
4. Run twice and require the same failure.
5. Remove the probe after capture unless the user asks to keep it.
6. Preserve the test shape in the review comment so the author can add it.

## Live verification

- Build the exact merged state, not the base checkout or a stale installed binary.
- Inspect accessibility state before coordinate interaction.
- Capture video for multi-step behavior and screenshots at assertion/blocker points.
- Check logs for relevant crashes/assertions/errors.
- Distinguish `PASS`, `FAIL`, and `BLOCKED`.
- A setup failure is not evidence against the PR.
- If the live path does not expose the changed component, say so.

## Stacked PR checks

- Record and poll both the head SHA and declared-base SHA. Re-review when either changes, or when the effective branch-local patch ID changes.
- Review the branch-local delta against its declared parent.
- Validate prerequisite invariants that the child treats as guaranteed.
- Do not attribute base-only code to the child inline diff.
- A combined harness cannot isolate which fix caused success.
- Recheck evidence against the current implementation when a stack was rebased or rewritten.

## Critical product and coverage boundary

Apply this boundary rigorously to editors and other high-blast-radius product surfaces:

1. Establish the intended product behavior independently of the implementation and proposed tests. Check existing product authority, cross-platform behavior, specifications, and maintainer decisions.
2. Classify every changed production hunk. A coverage/harness PR may add observation seams that are behaviorally inert; it must not carry product fixes, alternate state machines, or behavioral policy.
3. If coverage exposes a product defect, stop and require a separate authoritative product PR. Review and land that change on its own merits, then rebase the coverage stack and remove copied hunks.
4. Treat tests that assert a newly invented behavior as untrusted oracles. Prove the behavior is intended before treating green results as evidence.
5. Validate behavior at its real boundary. For editor changes, consider rapid input, IME/composition, focus and first-responder transfer, selection direction/crossing, virtualization, undo/redo, persistence/reopen, accessibility, cancellation, and stale-generation ordering.
6. State this ownership determination explicitly in the review, including whether the PR merely observes production or changes it.

Canonical failure pattern: a coverage PR assumes an incorrect editor behavior, adds production state and coordination to make that assumption pass, and then cites its own green test as proof. This is circular evidence and a merge blocker even when the implementation is internally coherent.

## Posting checklist

- User explicitly authorized posting.
- Findings are deduplicated against existing threads.
- Inline lines exist on the right side of the current diff.
- Each comment states severity, impact, evidence, and a concrete fix.
- Top-level review gives a merge determination and validation summary.
- User-token comments include the required bot disclosure.
- No local paths appear as evidence.
- Referenced artifacts are uploaded first, then embedded or linked from GitHub.
- Ephemeral probe code is removed from the worktree.

## Top-level review template

```markdown
## Final determination: request changes | approve

### Blocking behavior
- Finding, impact, and proof.

### Evidence sufficiency
- What current-head evidence proves and what it does not.

### KISS and architecture
- Existing owner/primitive, duplicated machinery, contributor burden, smallest sound shape.

### Validation
- Tests/build/live PASS, FAIL, or BLOCKED with uploaded artifact URLs.

### Required before re-review
- Minimal concrete checklist.
```
