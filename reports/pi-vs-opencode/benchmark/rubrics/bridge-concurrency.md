# Bridge concurrency rubric

## Ground truth

Apple-auth requests use the parallel dispatcher while `NotionInAppActionManager` stores one shared nonce and completion. Request B can overwrite A; controller A's callback can then resolve B with crossed context and leave A's continuation and web reply orphaned. `NotionWebView`'s normal executor/capture path is mostly sound. Failure to invoke `webReponseHandler` after serialization failure is a secondary completion bug.

The safe minimal repair is single-flight rejection using the existing conflict error or state keyed by the actual authorization controller. Serial dispatch removes the overwrite only if every Apple flow terminates and can strand every later request behind one missing callback. Tests must avoid real Apple UI through an extracted/injected seam and prove one terminal result per request. Checked continuations do not add cancellation or timeout.

## Scoring

- 3 points: parallel dispatch plus the single shared nonce/completion slot.
- 2 points: concrete A/B overwrite, crossed result, and orphaned A reply.
- 2 points: accurate WebView executor/capture analysis.
- 2 points: safe repair and executable deterministic test seam.
- 1 point: precise source evidence and valid repository-native commands.

Cap answers that claim auth is already serialized, both requests complete, checked continuations auto-timeout, weak `self` suppresses the reply, or an unsupported test seam already exists.
