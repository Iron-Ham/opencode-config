public struct FeedItem: Identifiable, Sendable, Equatable {
    public let id: String
    public let title: String

    public init(id: String, title: String) {
        self.id = id
        self.title = title
    }
}

public struct FeedPage: Sendable, Equatable {
    public let items: [FeedItem]
    public let nextCursor: String?

    public init(items: [FeedItem], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

public struct FeedSnapshot: Sendable, Equatable {
    public let items: [FeedItem]
    public let nextCursor: String?
    public let canLoadMore: Bool
    public let isLoading: Bool
}

public typealias FeedPageLoader =
    @Sendable (_ cursor: String?) async throws -> FeedPage

public actor FeedPager {
    private let loader: FeedPageLoader
    private var items: [FeedItem] = []
    private var nextCursor: String?
    private var hasReachedEnd = false

    public init(loader: @escaping FeedPageLoader) {
        self.loader = loader
    }

    public func snapshot() -> FeedSnapshot {
        FeedSnapshot(
            items: items,
            nextCursor: nextCursor,
            canLoadMore: !hasReachedEnd,
            isLoading: false,
        )
    }

    public func loadNext() async throws {
        guard !hasReachedEnd else {
            return
        }

        let page = try await loader(nextCursor)
        items.append(contentsOf: page.items)
        nextCursor = page.nextCursor
        hasReachedEnd = page.nextCursor == nil
    }

    public func reset() {
        items = []
        nextCursor = nil
        hasReachedEnd = false
    }
}
