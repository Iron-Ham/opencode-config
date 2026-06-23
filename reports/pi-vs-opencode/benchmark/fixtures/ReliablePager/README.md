# ReliablePager

`FeedPager` loads cursor-based pages for an offline-capable feed.

- The first request uses a `nil` cursor.
- A successful response commits its items and next cursor atomically.
- Concurrent `loadNext()` calls share one in-flight loader operation and commit a page at most once.
- While an operation is in flight, `snapshot().isLoading` is `true`.
- Loader failure changes no items or cursor. A later call retries the same cursor.
- Duplicate item IDs are discarded while preserving first-seen order, including duplicates within one page.
- A `nil` response cursor marks the pager complete. Later loads are no-ops.
- `reset()` immediately restores the initial snapshot, cancels the current loader task, and invalidates its response.
- An invalidated `loadNext()` finishes with `CancellationError`, even if the loader ignores task cancellation and eventually returns a value.
- A response from an earlier generation must never commit or clear a request started after `reset()`.
- An empty page with a non-nil cursor still advances pagination.
