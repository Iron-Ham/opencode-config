# ReliablePager benchmark instructions

- Modify only `Sources/ReliablePager/FeedPager.swift`.
- Preserve every existing public declaration and function signature.
- Do not modify tests, `README.md`, or `Package.swift`.
- Do not add dependencies, network access, timers, sleeps, or blocking synchronization.
- Use Swift 6 concurrency without `@unchecked Sendable`, `nonisolated(unsafe)`, `Task.detached`, or diagnostic suppressions.
- Keep mutable pager state actor-isolated.
- Run `swift test` before finishing.
