# ADR 002: On-Demand Session Provenance

## Status

Accepted on 2026-07-18.

## Decision

**Design-only follow-on is justified.** Existing managed state establishes
limited provenance but cannot attribute an individual historical turn to its
agent, model identity, and policy route. No plugin, transcript mutation, prompt
injection, or live provenance surface is included in this change.

## Context

Current managed interfaces provide separate, incomplete views:

- The observe-only resolver exposes the current effective route, policy
  version, and availability of reasoning-effort metadata. It is not associated
  with a session or individual message.
- Delegation tracking keeps parent/child lifecycle state in memory for limits;
  it is not a durable message-attribution ledger.
- The total-cost TUI can traverse session `id` and `parentID`, but its declared
  session shape contains only identity and cost.

For example, a synthetic session whose current route is
`openai/gpt-5.6-terra` cannot establish whether an earlier assistant turn was
produced by Build, Plan, or a delegated child. It also cannot establish the
effective route at that earlier turn. This ambiguity is material for on-demand
review but does not justify changing model-visible history.

### Existing Surfaces

- Normal Build: the declared default is `openai/gpt-5.6-terra`; no fixed
  reasoning variant is declared.
- Delegated child: parent/child linkage is observable while delegation state is
  live, but no persisted child turn metadata is available through the managed
  guard.

The installed OpenCode CLI is `1.18.3`. This decision does not claim that
OpenCode exposes internal per-message attribution fields beyond the managed
source evidence above.

### External Comparison

The relevant concept in `gotgenes/opencode-agent-identity` is an on-demand
per-message attribution tool. Its rationale for avoiding inline tags matches
this design: attribution must not alter the model-visible transcript. Its
system-prompt identity injection is explicitly out of scope here.

### Future Read-Only Contract

A later, opt-in tool may return an array of records with exactly these fields:

| Field | Meaning |
| --- | --- |
| `turn_id` | Opaque stable identifier for one visible turn. |
| `role` | `user`, `assistant`, or `tool`. |
| `agent` | Agent name when OpenCode supplies immutable turn metadata; otherwise `null`. |
| `provider` | Provider identifier when available; otherwise `null`. |
| `model` | Model identifier when available; otherwise `null`. |
| `effort` | Effective reasoning effort when OpenCode exposes it; otherwise `null`. Never infer a pinned alias. |
| `route_id` | Observe-only policy route identifier when an immutable route snapshot is available; otherwise `null`. |
| `policy_version` | Observe-only policy version from the same route snapshot as `route_id`; otherwise `null`. |
| `availability` | `available`, `partial`, or `unavailable` for this record. |

`route_id` and `policy_version` are an atomic nullable pair: both are present
only when they originate from the same immutable turn snapshot. The allowed
contract fields do not represent serving-path provenance, so a record must not
claim that provider/model alone establishes an exact data-egress route.

Availability is deterministic per record:

- `available`: `agent`, `provider`, `model`, `effort`, `route_id`, and
  `policy_version` are all present.
- `partial`: at least one provenance field is present, but the complete set is
  not available, including an unavailable effort or absent route snapshot.
- `unavailable`: all provenance fields except `turn_id`, `role`, and
  `availability` are `null`.

The tool would read only the calling session, accept no arbitrary session ID,
return no message text, prompt, tool arguments, tool output, file path, or
session identifier, and make no writes. It must not modify system prompts,
message history, agent selection, routing, defaults, or lifecycle hooks.
Child sessions are deliberately excluded: a root session cannot query child
turns, and a child may query only its own turns. This preserves session
isolation and avoids implying a cross-session transcript ledger.

## Evidence

Normal Build with unavailable effort metadata:

```json
[
  {
    "turn_id": "synthetic-normal-user",
    "role": "user",
    "agent": null,
    "provider": null,
    "model": null,
    "effort": null,
    "route_id": null,
    "policy_version": null,
    "availability": "unavailable"
  },
  {
    "turn_id": "synthetic-normal-assistant",
    "role": "assistant",
    "agent": "build",
    "provider": "openai",
    "model": "gpt-5.6-terra",
    "effort": null,
    "route_id": "build-terra",
    "policy_version": 1,
    "availability": "partial"
  }
]
```

Agent switch with independently attributed assistant turns:

```json
[
  {
    "turn_id": "synthetic-switch-one",
    "role": "assistant",
    "agent": "plan",
    "provider": "openai",
    "model": "gpt-5.6-terra",
    "effort": null,
    "route_id": null,
    "policy_version": null,
    "availability": "partial"
  },
  {
    "turn_id": "synthetic-switch-two",
    "role": "assistant",
    "agent": "build",
    "provider": "openai",
    "model": "gpt-5.6-terra",
    "effort": null,
    "route_id": "build-terra",
    "policy_version": 1,
    "availability": "partial"
  }
]
```

Delegated-child isolation: a root-session response contains no child turns;
the child session receives an independent response using the same record shape.

Compacted or otherwise missing metadata:

```json
[
  {
    "turn_id": "synthetic-compacted-assistant",
    "role": "assistant",
    "agent": null,
    "provider": null,
    "model": null,
    "effort": null,
    "route_id": null,
    "policy_version": null,
    "availability": "unavailable"
  }
]
```

## Consequences

The minimum implementation prerequisite is a documented OpenCode read API that
returns, for each turn, an immutable turn ID, role, agent, provider, model,
and optional effort. The resolver must additionally expose an immutable
session/turn-associated observation snapshot containing route ID and policy
version as an atomic pair. Neither seam exists in this repository today.

A later opt-in implementation task must first verify those public interfaces,
then add synthetic tests for normal attribution, an agent switch, missing or
compacted metadata, session isolation, transcript immutability, unavailable
effort, resolver-disabled availability, every availability state, the atomic
route pair, and delegated-child isolation. It must not reconstruct model
aliases, infer serving paths, or retroactively infer missing metadata.
