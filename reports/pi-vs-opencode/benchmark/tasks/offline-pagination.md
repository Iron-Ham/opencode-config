Audit this deterministic native iOS offline-pagination scenario:

- `ios_local_collection_query` is enabled and the on-device query is active.
- SQLite contains rows 1–25; `offlineFullResultBlocks` therefore contains 25 rows, the local window is 25, and the latest server signal says more rows exist.
- The user taps ungrouped “load more.”
- Query Collection returns rows 1–50 with `hasMore: false`.
- `SaveRecordService.save` throws before committing to SQLite or triggering a GRDB observation.

Bound the investigation primarily to `CollectionViewStore.swift`, `OfflineCollectionQueryProvider.swift`, `CollectionRowBlocksQuery.swift`, `RecordServiceV2.swift`, `SaveRecordService.swift`, and `CollectionViewStoreTests.swift`.

Trace the exact causal flow from the tap through local windowing, request mutation, network response, reducer state changes, persistence, and the reactive query. Return:

1. The rows and pagination affordances that remain after failure, including loading state, stored request limit, `offlineServerHasMore`, and whether the merged in-memory `recordMap` can drive row selection.
2. The strongest concrete defect or, if sound, a proof of soundness.
3. The same persistence failure when the offline gate/path is inactive.
4. The smallest repair that preserves immediate local pagination and gate-off behavior, including ordering and error-state restoration.
5. The minimum regression test in the existing Swift Testing and dependency-injection style. It must fail against current code for the identified causal reason, not merely assert that `save` was called.
6. Exact repo-native lint, module-build, and test-target commands to run after a fix.

Do not rely solely on comments or commit messages. Distinguish a user-visible visibility/retry defect from server-side data loss and state every unresolved uncertainty.
