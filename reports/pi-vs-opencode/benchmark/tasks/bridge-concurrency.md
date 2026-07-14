Perform a read-only concurrency and lifetime review of the iOS native-to-web bridge.

Center the investigation on:

- `src/mobile/ios/Apps/Notion/NotionWebView.swift`, especially `sendOutgoingBridgeMessageInternal`
- `src/mobile/ios/Apps/Notion/NativeApi.swift`, especially dispatcher selection and `requestNativeAppleAuth`
- Any directly required caller, delegate, bridge model, task dispatcher, or parallel Apple-auth implementation

Establish the end-to-end causal path from a web `requestNativeAppleAuth` promise through `WKScriptMessageHandlerWithReply`, parsing, task dispatch, AuthenticationServices, continuation resumption, serialization, and the reply handler.

Return:

1. Exact invariants for executor/thread use, exactly-once replies and continuations, request-ID or nonce association, and object lifetime.
2. The strongest real defect or a source-backed soundness conclusion. If defective, give a concrete two-request interleaving and state exactly which continuation, callback, reply, and objects survive.
3. Whether `NotionWebView`'s strong/weak captures and serialization-error branches are sound; distinguish primary from secondary risks.
4. The smallest safe repair shape, including the concurrency policy and why it preserves every request's terminal outcome.
5. A deterministic automated-test design that avoids real Apple UI, plus exact `nomo ios ...` commands that should run after implementation.

Separate verified facts from inference. Do not claim that checked continuations provide cancellation or timeout behavior.
