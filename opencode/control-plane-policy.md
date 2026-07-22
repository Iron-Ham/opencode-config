# OpenCode Control-Plane Policy Contract

## Status

This document defines policy contract version 3 for an observe-only control
plane. The resolver may report a selected policy route, but it must not set an
OpenCode model, provider, reasoning effort, fallback, agent permission, or
default.

Any execution-affecting route change requires a separately reviewed policy
version, retained shadow-evaluation evidence, and explicit developer approval.

## Scope And Invariants

The control plane extends managed configuration without replacing OpenCode
selection behavior. Its input is limited to declared invocation mode,
developer selection, repository/provider restrictions, boundedness,
verification strength, production risk, unattended authorization, and the
live provider catalog. It does not infer intent from prompts, role names, or
keywords.

The managed route set contains one ordinary execution route:

| Invocation | Policy route | Execution route | Notes |
| --- | --- | --- | --- |
| Build | `build-terra` | `openai/gpt-5.6-terra` | Current managed Build baseline; no fixed reasoning variant. |

Provider/model fallback, automatic review, model-branded convenience commands,
and role-based route selection are outside this contract. A route is always a
complete provider, model, and serving-path identity; reasoning effort is
optional runtime metadata and a role name is never evidence of model quality.

`/ultra` is a Build command template, not a policy invocation mode. The policy
resolver remains Build-only and rejects `ultra` as an invocation mode.

## Files And Ownership

The managed manifest lives at `opencode/control-plane-policy.json`. It is JSON
rather than JSONC so a canonical byte-independent hash can be computed without
stripping comments. This document is the human-readable contract and
changelog rationale.

| File | Responsibility |
| --- | --- |
| `opencode/opencode.defaults.json` | Current default routes, provider definitions, compaction configuration, and agent permissions. |
| `scripts/merge-opencode-config.mjs` | Strict local configuration parsing, managed merge, and live catalog validation. |
| `setup-opencode.sh` | Transactional managed installation boundary. |
| `scripts/validate-opencode-agents.mjs` | Resolved post-install policy validation. |

The private local switch belongs in `model-routing.config.local.json`:

```json
{
  "policy_adapter_enabled": true,
  "agents": {},
  "steps": {}
}
```

`policy_adapter_enabled: false` disables manifest loading, catalog validation
for the adapter, session-start display, and persisted policy observations.
OpenCode then follows its ordinary merged configuration. The switch does not
mutate or delete developer configuration.

## Manifest Schema

The resolver rejects unknown required fields and unsupported enum values. It
must validate the manifest before resolving a route. A route may match only
the declared input fields below; it must not inspect prompt text or introduce
an unstated task class.

| Field | Type | Rule |
| --- | --- | --- |
| `schema_version` | integer | Starts at `1`; incompatible parsing changes require a new schema version. |
| `policy_version` | positive integer | Bumps for every semantic or route-data change. |
| `changelog` | non-empty array | Each entry names its policy version, date, summary, and retained evidence reference. |
| `routes` | non-empty array | Route IDs are unique and stable within a policy version. |
| `routes[].match` | object | Contains only declared mode and declared characteristics. |
| `routes[].execution` | object | Carries an exact provider, model, and serving path, with optional reasoning effort. |
| `routes[].controls` | object | Declares continuation, compaction, delegation, and review disposition without changing them. |
| `routes[].fallback` | object | Begins as `developer_action_required`; no hidden substitution is permitted. |
| `deprecation` | array | Contains zero or more closed records with `route_id`, `replacement_route_id` or `null`, `effective_policy_version`, and `reason`. |

The resolver input has this normalized shape:

```text
PolicyInput {
  mode: "build"
  developer_selection?: ExactRoute
  repository_restrictions: {
    allowed_providers?: string[]
    allowed_routes?: string[]
    prohibited_providers?: string[]
    prohibited_routes?: string[]
    data_egress?: {
      disposition: "allow" | "deny" | "provider-pinned"
      provider?: string
      serving_path?: string
    }
  }
  characteristics: {
    boundedness: "bounded_verifiable" | "normal_production" | "premium_quality"
    verification_strength: "weak" | "deterministic" | "runtime"
    production_risk: "bounded" | "normal" | "high"
    unattended_authorized: boolean
  }
  live_catalog: CatalogAvailability
}
```

`ExactRoute` contains `provider`, `model`, and `serving_path`, with optional
`reasoning_effort` metadata. The resolver expands a selected model from the
effective Build configuration before it is displayed or validated. When the
effective configuration or catalog does not expose reasoning effort, the
observation reports it as unavailable without failing the route solely for
that omission.

## Resolution

Resolution follows this order. A higher-precedence prohibition never causes a
lower-precedence fallback.

| Priority | Source | Result |
| --- | --- | --- |
| 1 | Repository instructions and declared provider/data-egress restrictions | Accept the compatible route or return `blocked` with the restriction and required developer action. |
| 2 | Exact developer route selection | Report that exact route if compatible; never silently replace it. |
| 3 | Explicit invocation mode | Selects the Build contract scope. |
| 4 | Managed policy manifest | Selects the stable matching route ID and controls. |
| 5 | Ordinary OpenCode default | May be reported as the unchanged effective route when the adapter is disabled or no policy route exists; it is never selected or applied by the adapter. |

Restriction compatibility is closed and deterministic:

1. Restriction field names, enum values, provider names, route IDs, and exact
   route identities must parse successfully. A missing or malformed normalized
   restriction yields `unverified`, not implicit unrestricted approval.
2. A prohibition wins over an allowlist. All present allowlists are
   conjunctive: a candidate must satisfy each one.
3. Provider restrictions compare the exact provider field. Route restrictions
   compare a manifest route ID only after an exact provider/model/serving-path
   identity match, including effort when both sides declare it.
4. `data_egress.disposition: "deny"` rejects every external provider route.
   `"provider-pinned"` requires both the declared provider and serving path to
   match the candidate exactly. `"allow"` adds no egress restriction.
5. A blocked, unavailable, or unverified candidate retains the unchanged
   effective execution route in the observation and names a developer action.

The resolver returns both the policy recommendation and the actual effective
execution route. These fields are intentionally separate: the recommendation
may be available while OpenCode continues using an explicit developer model
selection.

## Hash And Review Rules

`configuration_hash` is `sha256:` plus the SHA-256 digest of canonical JSON:
objects recursively sorted by Unicode code-point key order, arrays preserved in
order, and JSON serialization without insignificant whitespace. The hash
covers the entire manifest, including the changelog.

Every route semantic, guard, provider, model, effort metadata, fallback, or
deprecation change must increment `policy_version`, add a changelog entry with
an evidence reference, update parser tests and the configuration-hash fixture,
and receive review before it can affect execution.

## Test Matrix

| Case | Expected observe-only result |
| --- | --- |
| Compatible ordinary Build | `build-terra`, exact `openai/gpt-5.6-terra` route, optional effort metadata, `execution_altered: false`. |
| Explicit compatible developer route | Developer selection wins and is reported separately from a manifest route ID without changing execution. |
| Repository restriction conflicts with developer route | `blocked`, restriction named, no replacement route. |
| Provider/model missing from live catalog | `unavailable`, catalog reason and developer action, no fallback. |
| Disabled provider or unexpandable effective alias | `unavailable` or `unverified`, unchanged effective route, no inferred model or effort values. |
| `policy_adapter_enabled: false` | No manifest read, no observation, no execution change. |
| Invalid schema or unsupported version | Resolver fails before reporting a route. |
| Manifest semantic change | Different policy version and canonical hash; changelog required. |
