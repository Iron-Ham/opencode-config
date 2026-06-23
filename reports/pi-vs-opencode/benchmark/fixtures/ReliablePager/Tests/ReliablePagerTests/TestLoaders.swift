import ReliablePager

enum LoaderFailure: Error, Equatable {
    case offline
    case unexpectedRequest
}

actor AsyncGate {
    private var isOpen = false
    private var continuations: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen {
            return
        }
        await withCheckedContinuation { continuation in
            continuations.append(continuation)
        }
    }

    func open() {
        guard !isOpen else {
            return
        }
        isOpen = true
        let pending = continuations
        continuations.removeAll()
        for continuation in pending {
            continuation.resume()
        }
    }
}

enum LoaderStep: Sendable {
    case success(FeedPage)
    case failure(LoaderFailure)
    case gatedSuccess(AsyncGate, FeedPage, ignoresCancellation: Bool)
    case gatedFailure(AsyncGate, LoaderFailure, ignoresCancellation: Bool)
}

actor ScriptedLoader {
    private let steps: [LoaderStep]
    private let repeatsLastStep: Bool
    private var cursors: [String?] = []
    private var cancellationObservations: [Bool] = []
    private var requestWaiters: [(
        count: Int,
        continuation: CheckedContinuation<Void, Never>
    )] = []

    init(steps: [LoaderStep], repeatsLastStep: Bool = false) {
        precondition(!steps.isEmpty)
        self.steps = steps
        self.repeatsLastStep = repeatsLastStep
    }

    func load(cursor: String?) async throws -> FeedPage {
        let index = cursors.count
        cursors.append(cursor)
        resumeSatisfiedWaiters()

        let step: LoaderStep
        if index < steps.count {
            step = steps[index]
        } else if repeatsLastStep, let last = steps.last {
            step = last
        } else {
            throw LoaderFailure.unexpectedRequest
        }

        switch step {
        case let .success(page):
            return page
        case let .failure(error):
            throw error
        case let .gatedSuccess(gate, page, ignoresCancellation):
            await gate.wait()
            cancellationObservations.append(Task.isCancelled)
            if !ignoresCancellation {
                try Task.checkCancellation()
            }
            return page
        case let .gatedFailure(gate, error, ignoresCancellation):
            await gate.wait()
            cancellationObservations.append(Task.isCancelled)
            if !ignoresCancellation {
                try Task.checkCancellation()
            }
            throw error
        }
    }

    func waitForRequestCount(_ count: Int) async {
        if cursors.count >= count {
            return
        }
        await withCheckedContinuation { continuation in
            requestWaiters.append((count, continuation))
        }
    }

    func recordedCursors() -> [String?] {
        cursors
    }

    func requestCount() -> Int {
        cursors.count
    }

    func observedCancellation() -> Bool {
        cancellationObservations.contains(true)
    }

    private func resumeSatisfiedWaiters() {
        var pending: [(
            count: Int,
            continuation: CheckedContinuation<Void, Never>
        )] = []
        for waiter in requestWaiters {
            if cursors.count >= waiter.count {
                waiter.continuation.resume()
            } else {
                pending.append(waiter)
            }
        }
        requestWaiters = pending
    }
}

func item(_ id: String) -> FeedItem {
    FeedItem(id: id, title: "Item \(id)")
}

func allowConcurrentCallersToEnterPager() async {
    for _ in 0..<100 {
        await Task.yield()
    }
}
