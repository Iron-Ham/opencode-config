Audit the native iOS grid-cell behavior for page properties whose values are email addresses, web URLs, or phone numbers.

Trace the complete production control flow from the property/schema value through URL construction, rendering, hit testing or gesture handling, state/action routing, and the eventual external-open call. Cover both the UIKit collection-view treatment and the SwiftUI fallback, including the experiment boundary between them. Establish what happens when a user taps rendered text versus surrounding cell space.

Return:

1. The intended contract and safety invariants.
2. A causal trace for each rendering path with exact `path:line` evidence.
3. The strongest real behavioral, safety, or accessibility defect/risk you can falsify from source. If the implementation is sound, say so rather than inventing a bug.
4. The smallest repair design without code.
5. Existing direct and adjacent tests, the most important missing causal test, and exact repo-native validation commands.
6. Any runtime behavior that cannot be determined from the repository alone.

Pay particular attention to URL scheme filtering, phone-number normalization, accessibility activation, link hit targets, context-menu-only actions, and experiment-cohort differences. Do not assume a test is relevant from its filename; inspect its assertions.
