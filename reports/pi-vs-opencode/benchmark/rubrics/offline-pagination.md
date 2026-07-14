# Offline pagination rubric

## Ground truth

Load-more widens the local window and server request. The network response is accepted before persistence: loading clears, `offlineServerHasMore` becomes false, and rows are republished from the still-25-row `offlineFullResultBlocks`. Offline row selection is SQLite/GRDB-driven, so a merged 50-row in-memory `recordMap` cannot make rows 26–50 visible. The failed save is only logged and never sends `.loadMoreFailed`. The user is left with 25 rows, the incremented request, no spinner, and no load-more affordance. This is a visibility/retry defect, not server-side data loss. With the offline path inactive, the server result remains usable despite best-effort persistence failure.

The repair must make persistence a prerequisite only while offline results are authoritative. On offline save failure, do not accept terminal response state; send `.loadMoreFailed` with the request from before increment so the same page is retryable. Preserve the gate-off response-first/best-effort-save behavior. The regression test must enable the experiment, exercise `.loadMoreTapped`, inject a throwing save, observe the effect sequence, and assert request restoration plus a surviving retry affordance.

## Scoring

- 3.5 points: response-before-save and GRDB-driven row selection.
- 2.5 points: exact stranded 25-row/no-retry state.
- 2 points: offline-only durability ordering and correct failure restoration.
- 1.5 points: throwing-save effect test that proves retryability.
- 0.5 points: accurate source evidence and repository-native commands.

Cap answers that treat `recordMap` as the offline selector, claim save failure already dispatches `.loadMoreFailed`, call this server-side data loss, or make persistence failure fatal to the gate-off path.
