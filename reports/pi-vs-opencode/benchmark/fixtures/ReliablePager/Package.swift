// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ReliablePager",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "ReliablePager", targets: ["ReliablePager"]),
    ],
    targets: [
        .target(name: "ReliablePager"),
        .testTarget(
            name: "ReliablePagerTests",
            dependencies: ["ReliablePager"],
        ),
    ],
)
