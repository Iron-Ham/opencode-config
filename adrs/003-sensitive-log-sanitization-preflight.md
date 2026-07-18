# ADR 003: Sensitive-Log Sanitization Preflight

## Status

Accepted on 2026-07-18.

## Decision

**No change.** The repository has narrow, purpose-specific credential
validation and redaction rules, but no approved generic local detector. This
task ships only a synthetic expected-result corpus and an integrity check; it
does not scan data, invoke a detector, or alter OpenCode behavior.

## Context

A future explicit preflight may provide a local preview and, only after a
separate user action, write a separately named sanitized copy. The original
must remain unchanged. Every detection must carry a visible **review required**
label, and no output may claim that its contents are safe.

Each detector result may contain only category, line/span, matched length,
confidence, and a replacement marker. It must never retain or return the raw
matched value. A future implementation must not add a global hook, automatic
prompt rewriting, upload, CI enforcement, or a non-interactive bypass.

## Evidence

`sanitization-preflight-corpus.json` contains synthetic redaction controls for
JWT-like material, authorization headers, private-key markers, connection
strings, cookies, and signed URLs. It also contains preservation controls for
a long base64-like value, TypeScript/Swift/Kotlin literals, JSON, and a stack
trace. The integrity script validates expected-result metadata only; it does
not execute candidate rules.

The candidate rules are deliberately marked unapproved. Expected outcomes are
therefore paper evaluation targets, not a claim that the repository detects or
sanitizes those patterns today.

### Data Retention And Restore Boundary

- The committed corpus contains only conspicuously synthetic values.
- A future preview must retain only result metadata in memory for the current
  invocation unless an explicit user-selected output path is supplied.
- A sanitized copy must be a new file chosen by the developer; it must not
  overwrite the original, persist an allow list, or retain raw match values.
- The minimum restore/allow action is to dismiss the preview and keep the
  original unchanged. A one-time exception for a manually reviewed export must
  be explicit and non-persistent.

### False-Positive Risks

JWT-like/base64-like strings, connection-like documentation, signed URLs, and
code literals can be benign. The long-base64 and language-literal controls are
included to prevent a detector from treating shape alone as proof of sensitive
content. Any future detector must favor review-required results over silent
rewriting.

## Consequences

No implementation task is created because no approved generic detector exists.
If a developer later approves exact local rules and retention behavior, create
a separate security-reviewed implementation task that starts from this corpus.
That task must run the corpus only against synthetic input and preserve the
contract above.
