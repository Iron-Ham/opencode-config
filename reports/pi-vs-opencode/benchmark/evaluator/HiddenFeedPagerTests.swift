import ReliablePager
import Testing

@Test
func thirtyTwoConcurrentCallersCommitExactlyOnce() async throws {
    let gate = AsyncGate()
    let loader = ScriptedLoader(
        steps: [
            .gatedSuccess(
                gate,
                FeedPage(items: [item("a"), item("a")], nextCursor: nil),
                ignoresCancellation: false,
            ),
        ],
        repeatsLastStep: true,
    )
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }
    let callers = (0..<32).map { _ in
        Task {
            try await pager.loadNext()
        }
    }

    await loader.waitForRequestCount(1)
    await allowConcurrentCallersToEnterPager()
    await gate.open()
    for caller in callers {
        try await caller.value
    }

    #expect(await loader.requestCount() == 1)
    #expect((await pager.snapshot()).items == [item("a")])
}

@Test
func coalescedFailureIsSharedAndRetryable() async throws {
    let gate = AsyncGate()
    let loader = ScriptedLoader(steps: [
        .gatedFailure(gate, .offline, ignoresCancellation: false),
        .success(FeedPage(items: [item("a")], nextCursor: nil)),
    ])
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
    await gate.open()
    for caller in callers {
        do {
            try await caller.value
            Issue.record("Expected the coalesced request to fail")
        } catch LoaderFailure.offline {
        }
    }

    #expect(await loader.requestCount() == 1)
    try await pager.loadNext()
    #expect(await loader.recordedCursors() == [nil, nil])
    #expect((await pager.snapshot()).items == [item("a")])
}

@Test
func resetThenReloadProtectsTheNewGeneration() async throws {
    let staleGate = AsyncGate()
    let freshGate = AsyncGate()
    let loader = ScriptedLoader(steps: [
        .gatedSuccess(
            staleGate,
            FeedPage(items: [item("stale")], nextCursor: nil),
            ignoresCancellation: true,
        ),
        .gatedSuccess(
            freshGate,
            FeedPage(items: [item("fresh")], nextCursor: nil),
            ignoresCancellation: true,
        ),
    ])
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }

    let staleLoad = Task {
        try await pager.loadNext()
    }
    await loader.waitForRequestCount(1)
    await pager.reset()
    let freshLoad = Task {
        try await pager.loadNext()
    }
    await loader.waitForRequestCount(2)

    await staleGate.open()
    do {
        try await staleLoad.value
        Issue.record("Expected the stale generation to be rejected")
    } catch is CancellationError {
    }
    #expect((await pager.snapshot()).isLoading)
    #expect((await pager.snapshot()).items.isEmpty)

    await freshGate.open()
    try await freshLoad.value
    #expect((await pager.snapshot()).items == [item("fresh")])
}

@Test
func staleFailureAfterResetDoesNotClearFreshLoad() async throws {
    let staleGate = AsyncGate()
    let freshGate = AsyncGate()
    let loader = ScriptedLoader(steps: [
        .gatedFailure(staleGate, .offline, ignoresCancellation: true),
        .gatedSuccess(
            freshGate,
            FeedPage(items: [item("fresh")], nextCursor: nil),
            ignoresCancellation: true,
        ),
    ])
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }

    let staleLoad = Task {
        try await pager.loadNext()
    }
    await loader.waitForRequestCount(1)
    await pager.reset()
    let freshLoad = Task {
        try await pager.loadNext()
    }
    await loader.waitForRequestCount(2)

    await staleGate.open()
    do {
        try await staleLoad.value
        Issue.record("Expected the stale failure to be invalidated")
    } catch is CancellationError {
    } catch {
        Issue.record("Expected CancellationError, got \(error)")
    }
    let pendingSnapshot = await pager.snapshot()
    #expect(pendingSnapshot.isLoading)
    #expect(pendingSnapshot.items.isEmpty)

    await freshGate.open()
    try await freshLoad.value
    #expect((await pager.snapshot()).items == [item("fresh")])
}

@Test
func emptyPageAdvancesCursorAndFailureDoesNot() async throws {
    let loader = ScriptedLoader(steps: [
        .success(FeedPage(items: [item("a")], nextCursor: "p1")),
        .failure(.offline),
        .success(FeedPage(items: [], nextCursor: "p2")),
        .success(FeedPage(items: [item("b")], nextCursor: nil)),
    ])
    let pager = FeedPager { cursor in
        try await loader.load(cursor: cursor)
    }

    try await pager.loadNext()
    do {
        try await pager.loadNext()
        Issue.record("Expected the second load to fail")
    } catch LoaderFailure.offline {
    }
    try await pager.loadNext()
    try await pager.loadNext()

    #expect(await loader.recordedCursors() == [nil, "p1", "p1", "p2"])
    #expect((await pager.snapshot()).items == [item("a"), item("b")])
}
