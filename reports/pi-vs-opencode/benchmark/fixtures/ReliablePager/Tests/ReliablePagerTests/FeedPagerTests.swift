import ReliablePager
import Testing

@Test
func sequentialPaginationStopsAtEnd() async throws {
    let loader = ScriptedLoader(steps: [
        .success(FeedPage(items: [item("a"), item("b")], nextCursor: "p2")),
        .success(FeedPage(items: [item("c")], nextCursor: nil)),
    ])
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }

    try await pager.loadNext()
    try await pager.loadNext()
    try await pager.loadNext()

    #expect(await loader.recordedCursors() == [nil, "p2"])
    let snapshot = await pager.snapshot()
    #expect(snapshot.items == [item("a"), item("b"), item("c")])
    #expect(snapshot.nextCursor == nil)
    #expect(!snapshot.canLoadMore)
    #expect(!snapshot.isLoading)
}

@Test
func failureRetriesCommittedCursor() async throws {
    let loader = ScriptedLoader(steps: [
        .failure(.offline),
        .success(FeedPage(items: [item("a")], nextCursor: "p2")),
    ])
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }

    do {
        try await pager.loadNext()
        Issue.record("Expected the first load to fail")
    } catch LoaderFailure.offline {
    }

    let snapshot = await pager.snapshot()
    #expect(snapshot.items.isEmpty)
    #expect(snapshot.nextCursor == nil)
    #expect(snapshot.canLoadMore)
    #expect(!snapshot.isLoading)

    try await pager.loadNext()
    #expect(await loader.recordedCursors() == [nil, nil])
}

@Test
func concurrentLoadsShareRequest() async throws {
    let gate = AsyncGate()
    let loader = ScriptedLoader(
        steps: [
            .gatedSuccess(
                gate,
                FeedPage(items: [item("a")], nextCursor: nil),
                ignoresCancellation: false,
            ),
        ],
        repeatsLastStep: true,
    )
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }

    let callers = (0..<8).map { _ in
        Task {
            try await pager.loadNext()
        }
    }
    await loader.waitForRequestCount(1)
    await allowConcurrentCallersToEnterPager()

    #expect((await pager.snapshot()).isLoading)
    await gate.open()
    for caller in callers {
        try await caller.value
    }

    #expect(await loader.requestCount() == 1)
    #expect((await pager.snapshot()).items == [item("a")])
}

@Test
func resetCancelsAndRejectsLateResponse() async throws {
    let gate = AsyncGate()
    let loader = ScriptedLoader(steps: [
        .gatedSuccess(
            gate,
            FeedPage(items: [item("stale")], nextCursor: nil),
            ignoresCancellation: true,
        ),
    ])
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }
    let load = Task {
        try await pager.loadNext()
    }

    await loader.waitForRequestCount(1)
    #expect((await pager.snapshot()).isLoading)
    await pager.reset()
    await gate.open()

    do {
        try await load.value
        Issue.record("Expected reset to invalidate the pending load")
    } catch is CancellationError {
    }

    #expect(await loader.observedCancellation())
    let snapshot = await pager.snapshot()
    #expect(snapshot.items.isEmpty)
    #expect(snapshot.nextCursor == nil)
    #expect(snapshot.canLoadMore)
    #expect(!snapshot.isLoading)
}

@Test
func deduplicatesWithinAndAcrossPages() async throws {
    let loader = ScriptedLoader(steps: [
        .success(
            FeedPage(
                items: [item("a"), item("a"), item("b")],
                nextCursor: "p2",
            )
        ),
        .success(
            FeedPage(
                items: [item("b"), item("c")],
                nextCursor: nil,
            )
        ),
    ])
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }

    try await pager.loadNext()
    try await pager.loadNext()

    #expect((await pager.snapshot()).items == [item("a"), item("b"), item("c")])
}
