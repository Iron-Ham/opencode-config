# ADR 004: Protected-Environment Diagnostics

## Status

Accepted on 2026-07-18.

## Decision

Do not add doctor behavior for protected-environment diagnostics. A future
boolean-only diagnostic surface requires an approved secure prerequisite API;
no such API is present in the current managed implementation.

## Context

Current doctor behavior reads `opencode.json`, optionally reads the private
local routing JSON to validate file permissions and advisor isolation, and
validates redacted compaction-observation records. It does not enumerate
environment variables, inspect their values, call a provider, access a
keychain, or resolve merged agent-route precedence.

The existing outputs for synthetic states are:

| Synthetic state | Current doctor output | Safe next action available now |
| --- | --- | --- |
| Missing configuration | `configuration` error from the requested config path. | Supply a valid managed configuration without placing values in diagnostics. |
| Wrong variable name | Unsupported; doctor does not inspect variable names. | No doctor-derived action. |
| Invalid authentication | Unsupported; doctor does not authenticate providers. | No doctor-derived action. |
| Provider unavailable | Unsupported; doctor does not inspect provider availability. | No doctor-derived action. |
| Configuration-precedence conflict | Unsupported except for its narrow direct checks such as a separate compaction route. | No doctor-derived action for effective-route precedence. |

The observe-only policy resolver can represent provider/catalog states when it
receives synthetic catalog evidence, but doctor neither invokes it nor obtains
that evidence. Treating a resolver state as a doctor diagnostic would invent a
capability that does not exist.

## Future Boolean-Only Contract

If a supported secure prerequisite API is approved, a future doctor extension
may return records with exactly these fields:

| Field | Meaning |
| --- | --- |
| `prerequisite_id` | Opaque identifier from a fixed managed allowlist. |
| `state` | `not_configured`, `available`, `auth_failed`, or `unavailable`. |
| `source_category` | `managed_configuration`, `secure_boolean_api`, or `provider_status`. |
| `remediation` | Fixed safe action text with no variable name or value. |

The API must be internal to doctor, require no caller-supplied prerequisite ID,
and return only the fixed managed inventory. It must not expose an RPC, CLI
argument, or plugin tool that allows callers to enumerate or select IDs.
Unknown, stale, and unauthorized requests must be indistinguishable from the
same generic unavailable record.

`provider_status` may originate only from an approved cached non-interactive,
non-egress status attestation. Neither doctor nor its prerequisite API may
authenticate, probe, or call a provider to derive `auth_failed` or any other
state. If no attestation exists, the state is `unavailable`.

The future implementation must not return variable names, values, lengths,
hashes, paths, provider output, account identifiers, or useful secret
metadata. It must not offer generic environment inspection, credential
probing, provider authentication, or keychain access.

## Synthetic Examples

Normal availability:

```json
{
  "prerequisite_id": "pre-001",
  "state": "available",
  "source_category": "secure_boolean_api",
  "remediation": "No action is required."
}
```

Redacted export:

```json
{
  "prerequisite_id": "pre-002",
  "state": "not_configured",
  "source_category": "managed_configuration",
  "remediation": "Configure the approved local prerequisite; values are not reported."
}
```

Unknown prerequisite:

```json
{
  "prerequisite_id": "pre-000",
  "state": "unavailable",
  "source_category": "managed_configuration",
  "remediation": "Protected diagnostics are unavailable; use the approved local support path."
}
```

Disabled doctor:

```json
{
  "prerequisite_id": "pre-000",
  "state": "unavailable",
  "source_category": "managed_configuration",
  "remediation": "Protected diagnostics are unavailable; use the approved local support path."
}
```

## Consequences

No implementation task is created. The required secure seam would be a
documented local API that answers fixed allowlisted prerequisite IDs with the
four states above without exposing or deriving from values in doctor. A later
security-reviewed task may begin only after that API and its source categories
are approved. It must use synthetic tests for all four states, unknown IDs,
disabled diagnostics, redacted exports, and the absence of variable names,
values, lengths, hashes, paths, provider calls, caller-selected IDs, and
observable differences between unknown and unauthorized requests.
