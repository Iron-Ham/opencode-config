# ADR 005: Redacted Ultra Event Contract

## Status

Accepted on 2026-07-18.

## Decision

Define a schema-first optional Ultra event contract with no live emitter. It
reuses the existing durable goal ID, session ID, completion-evidence artifact
ID, and child session ID where available. Policy receipt ID is optional until
the receipt surface is available. The future integration seam is **adapter
required**: no committed generic OpenCode event hook is verified.

## Contract

Each NDJSON event has exactly `schema_version`, `event_id`, `goal_id`,
`session_id`, `observed_at`, `event_type`, `causal_parent_id`, `reason_code`,
and `metadata`. Event types are limited to `goal_created`, `goal_resumed`,
`goal_checkpointed`, `child_started`, `child_completed`, `child_blocked`,
`validation_passed`, `validation_failed`, `provider_failure`, `no_progress_stop`,
and `final_handoff`. Metadata may contain only opaque existing identifiers,
safe repo-relative references, counts, and enumerated statuses.

No event may contain prompt text, secret-like text, raw command output,
absolute paths, patches, transcript content, credentials, or network payloads.
Observer failure must be isolated: an event adapter may fail closed for its own
output without blocking goal lifecycle, delegation, validation, or completion.

## Retention And Future Work

This task creates no persistence store. A future opt-in adapter must use a
developer-selected private output location, bounded retention, explicit
deletion, and best-effort observation only. It must prove non-interference,
redaction, causality, and no stdout/network behavior with this synthetic corpus
before connecting any verified OpenCode hook.
