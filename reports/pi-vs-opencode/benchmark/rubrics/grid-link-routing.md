# Grid link routing rubric

## Ground truth

With the UIKit collection-view gate enabled, tapping rendered text opens the schema-derived link while padding requests editing. The SwiftUI fallback makes the whole editable cell request editing and has no link-open path. URL construction supports `mailto:`, filtered `tel:`, and HTTP(S). Existing tests cover URL construction and context-menu availability, not actual hit-testing, link activation, `UIApplication.open`, or accessibility activation.

## Scoring

- 3 points: resolves both UIKit and SwiftUI experiment branches.
- 2 points: traces tap target through URL construction and opening behavior.
- 2 points: distinguishes direct `tel`/`mailto` opening from HTTP(S) routing.
- 2 points: identifies the real test and accessibility gaps without inventing coverage.
- 1 point: precise evidence, calibrated uncertainty, and targeted commands.

Cap answers that leave one cohort unresolved, claim every link is opened directly by `UIApplication`, or present adjacent snapshots as link-activation coverage.
