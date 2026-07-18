# OpenCode Control-Plane Policy Contract

## Status

This document defines policy contract version 1 for an observe-only control
plane. It is a design artifact, not an execution-routing change. The initial
resolver may report a selected policy route, but it must not set an OpenCode
model, provider, reasoning effort, fallback, agent permission, or default.

Any execution-affecting route change requires a separately reviewed policy
version, retained shadow-evaluation evidence, and explicit developer approval.

## Scope And Invariants

The control plane extends the managed configuration without replacing OpenCode
selection behavior. Its input is limited to declared invocation mode,
developer selection, repository/provider restrictions, boundedness,
verification strength, production risk, unattended authorization, and the
live provider catalog. It does not infer intent from prompts, role names, or
keywords.

The initial managed route set is deliberately small:

| Invocation | Policy route | Execution route | Notes |
| --- | --- | --- | --- |
| Build | `build-terra-xhigh` | OpenAI GPT-5.6 Terra xhigh pinned | Current managed Build baseline. |
| Ultra | `ultra-inherit-build` | The current Build route | Explicit durable workflow; no premium model claim. |
| Advise | `advise-opus-isolated` | Anthropic Claude Opus 4.8 xhigh pinned when locally enabled | Explicit, isolated, read-only review only. |

Open-weight routes, generic task tiers, personas, automatic advisor review,
provider/model fallback, and model-branded convenience commands are outside
this contract. In particular, a route is always a complete provider, model,
serving-path, and reasoning-effort identity; a role name is never evidence of
model quality.

## Files And Ownership

The future managed manifest lives at
`opencode/control-plane-policy.json`. It is JSON rather than JSONC so a
canonical byte-independent hash can be computed without stripping comments.
`opencode/control-plane-policy.md` is the human-readable contract and
changelog rationale.

The resolver reads these existing integration points:

| File | Responsibility |
| --- | --- |
| `opencode/opencode.defaults.json` | Current default routes, pinned aliases, compaction configuration, agent permissions, and Goal configuration. |
| `scripts/merge-opencode-config.mjs` | Strict local configuration parsing, managed merge, and live catalog validation. |
| `opencode/commands/ultra.md` | Explicit durable-goal entry point. |
| `opencode/commands/advise.md` | Explicit isolated-review entry point. |
| `setup-opencode.sh` | Transactional managed installation boundary. |
| `scripts/validate-opencode-agents.mjs` | Resolved post-install policy validation. |

The future local switch belongs in the existing private
`model-routing.config.local.json` because that file is already strict,
atomically written, and mode `0600`:

```json
{
  "policy_adapter_enabled": true,
  "advisor_enabled": false,
  "agents": {},
  "steps": {}
}
```

`policy_adapter_enabled: false` is the single kill switch. It disables
manifest loading, catalog validation for the adapter, session-start display,
and persisted policy observations. OpenCode then follows its ordinary merged
configuration exactly as it did before this contract. It does not mutate or
delete developer configuration. The switch has no relationship to
`advisor_enabled`, which controls only the explicit `/advise` lane.

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
| `routes[].match` | object | Contains only declared mode and declared characteristics; the initial policy matches mode only. |
| `routes[].execution` | object | Carries exact provider, model alias, serving path, and reasoning effort, or an explicit `inherits_route_id`, but never both. |
| `routes[].controls` | object | Declares continuation, compaction, delegation, and review disposition without changing them. |
| `routes[].fallback` | object | Begins as `developer_action_required`; no hidden substitution is permitted. |
| `deprecation` | array | Contains zero or more closed records with `route_id`, `replacement_route_id` or `null`, `effective_policy_version`, and `reason`. |

The resolver input has this normalized shape. Repository restrictions are a
structured declaration supplied by applicable repository instructions or the
invocation integration; the resolver does not claim to parse natural-language
instructions authoritatively.

```text
PolicyInput {
  mode: "build" | "ultra" | "advise"
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

`ExactRoute` contains `provider`, `model`, `serving_path`, and
`reasoning_effort`. A selected alias is expanded from the effective managed
configuration before it is displayed or validated. The resolver uses this
mode-to-agent mapping to derive that effective route:

| Invocation mode | Effective OpenCode agent |
| --- | --- |
| `build` | `build` |
| `ultra` | `ultra` |
| `advise` | `advisor_reviewer` |

The resolver expands an alias from the mapped agent's resolved
`provider/model` value and its effective provider definition. If the alias,
reasoning effort, serving path, enabled-provider status, or exact developer
selection cannot be resolved from that effective configuration, the result is
`unverified` or `unavailable`; it must never fill missing values from a
managed pinned route. A provider listed in `disabled_providers` is unavailable
even if its model appears in the catalog. The initial route set does not use
`characteristics` to choose a model; it records them only to make a future
policy change auditable.

### Ordinary Build Example

```json
{
  "schema_version": 1,
  "policy_version": 1,
  "changelog": [
    {
      "policy_version": 1,
      "date": "2026-07-17",
      "summary": "Establish observe-only managed routes.",
      "evidence_ref": "reports/opencode-model-routing/report.md"
    }
  ],
  "routes": [
    {
      "id": "build-terra-xhigh",
      "match": {
        "modes": ["build"]
      },
      "execution": {
        "provider": "openai",
        "model": "gpt-5.6-terra-xhigh-pinned",
        "serving_path": "openai",
        "reasoning_effort": "xhigh"
      },
      "controls": {
        "continuation": "ordinary_open_code",
        "compaction": "pinned_gpt_256k_with_20k_reserve",
        "delegation": "bounded_by_agent_policy",
        "independent_review": "developer_explicit_only"
      },
      "fallback": {
        "disposition": "developer_action_required",
        "message": "Choose an allowed exact route; the policy adapter will not substitute one."
      }
    }
  ],
  "deprecation": []
}
```

### Explicit Ultra Example

```json
{
  "schema_version": 1,
  "policy_version": 1,
  "changelog": [
    {
      "policy_version": 1,
      "date": "2026-07-17",
      "summary": "Establish observe-only managed routes.",
      "evidence_ref": "reports/opencode-model-routing/report.md"
    }
  ],
  "routes": [
    {
      "id": "ultra-inherit-build",
      "match": {
        "modes": ["ultra"]
      },
      "execution": {
        "inherits_route_id": "build-terra-xhigh"
      },
      "controls": {
        "continuation": "durable_goal_only",
        "compaction": "pinned_gpt_256k_with_20k_reserve",
        "delegation": "bounded_by_ultra_policy",
        "independent_review": "developer_explicit_only"
      },
      "fallback": {
        "disposition": "developer_action_required",
        "message": "Resolve the Build route or choose an allowed exact route; Ultra does not change providers automatically."
      }
    }
  ],
  "deprecation": []
}
```

The complete first manifest additionally includes `advise-opus-isolated` with
`mode: advise`, the current pinned Opus route, `continuation: none`,
`delegation: none`, and `independent_review: isolated_read_only`. It resolves
only when `advisor_enabled` is true. No initial route permits a fallback to
another provider, model, or reasoning effort.

`inherits_route_id` resolves only the static manifest route named by that ID.
For version 1, `ultra-inherit-build` therefore means the policy recommendation
inherits `build-terra-xhigh`; it does not follow a local `agents.build` or
`agents.ultra` override. Those overrides remain explicit developer selection
and are surfaced separately from the manifest recommendation.

## Precedence And Resolution

Resolution follows this order. A higher-precedence prohibition never causes a
lower-precedence fallback.

| Priority | Source | Result |
| --- | --- | --- |
| 1 | Repository instructions and declared provider/data-egress restrictions | Accept the compatible route or return `blocked` with the restriction and required developer action. |
| 2 | Exact developer route selection | Report that exact route if compatible; never silently replace it. |
| 3 | Explicit invocation mode | Selects only Build, Ultra, or Advise contract scope. |
| 4 | Managed policy manifest | Selects the stable matching route ID and controls. |
| 5 | Ordinary OpenCode default | May be reported as the unchanged effective route when the adapter is disabled or no policy route exists; it is never selected or applied by the adapter. |

Restriction compatibility is closed and deterministic:

1. Restriction field names, enum values, provider names, route IDs, and exact
   route identities must parse successfully. A missing or malformed normalized
   restriction yields `unverified`, not implicit unrestricted approval.
2. A prohibition wins over an allowlist. All present allowlists are
   conjunctive: a candidate must satisfy each one.
3. `allowed_providers` and `prohibited_providers` compare the exact provider
   field. `allowed_routes` and `prohibited_routes` compare a manifest route ID
   only after an exact provider/model/serving-path/effort identity match.
   A developer route with no matching manifest identity is `unverified` when
   a route-ID restriction is present.
4. `data_egress.disposition: "deny"` rejects every external provider route.
   `"provider-pinned"` requires both the declared provider and serving path
   to match the candidate exactly. `"allow"` adds no egress restriction.
5. A blocked, unavailable, or unverified candidate retains the unchanged
   effective execution route in the observation and names a developer action;
   it does not select a lower-precedence route.

Before a route is reported as available, the resolver validates the effective
provider/model alias against `opencode models <provider> --verbose --pure` in
the installed configuration. It also validates that the expanded route obeys
repository restrictions and that its pinned alias has the declared effort and
serving path. Missing credentials, an unavailable provider, or an unknown
catalog entry yields an observable unavailable result with a developer action;
it does not alter the active OpenCode route.

The observe-only resolver returns both the policy recommendation and the
actual effective execution route. These fields are intentionally separate:
the recommendation may be available while OpenCode continues using an
explicit developer model selection or an inherited route. A developer
selection is represented separately from a manifest route ID; it receives a
`manifest_route_id` only when its fully expanded identity exactly matches one.

```text
PolicyResolution {
  state: "resolved" | "blocked" | "unavailable" | "unverified" | "no_managed_route"
  schema_version: 1
  policy_version: number
  configuration_hash: "sha256:<hex>"
  adapter_enabled: boolean
  execution_altered: false
  precedence_source: "repository" | "developer" | "mode" | "managed" | "ordinary_default"
  policy_route?: ExactRoute & { id: string }
  developer_selection?: ExactRoute & { manifest_route_id?: string }
  effective_execution_route?: ExactRoute
  reason: string
  controls?: { continuation, compaction, delegation, independent_review }
  fallback: { disposition, message }
  catalog: { status: "available" | "unavailable" | "unverified", reason?: string }
  next_action?: string
}

PolicyResolutionDisabled {
  state: "disabled"
  adapter_enabled: false
  execution_altered: false
}
```

Resolver pseudocode:

```text
resolve(input, manifest, effectiveConfig):
  if local.policy_adapter_enabled is false:
    return { adapter_enabled: false, execution_altered: false }

  assertManifestSchema(manifest)
  hash = canonicalSha256(manifest)
  agent = agentForMode(input.mode)
  effectiveRoute = resolveEffectiveRoute(agent, effectiveConfig)
  if input.mode is "advise" and local.advisor_enabled is false:
    return unavailable(effectiveRoute, "Enable the explicit /advise lane first.")
  policyRoute = expandInheritedRoute(matchMode(manifest.routes, input.mode), manifest.routes)
  developerRoute = normalizeDeveloperSelection(input.developer_selection, effectiveConfig)
  candidate = developerRoute ?? policyRoute

  if candidate is absent:
    return noManagedRoute(effectiveRoute, hash)
  if repositoryRestrictionsReject(candidate, input.repository_restrictions):
    return blocked(candidate, effectiveRoute, "Repository restriction prevents this route.")
  if !validateAgainstEffectiveConfig(candidate, effectiveConfig):
    return unavailable(effectiveRoute, "Managed route is absent from the effective configuration.")
  if !validateLiveCatalog(candidate, input.live_catalog):
    return unavailable(effectiveRoute, "Route cannot be verified in the live provider catalog.")

  return observation(candidate, effectiveRoute, hash, execution_altered = false)
```

The resolver writes only a redacted local observation containing this result,
the configuration hash, and timestamps. It must not retain prompts, source
contents, credentials, raw provider output, or account identifiers. Session
start output and a later query expose the same object. The future doctor
command reads this object rather than independently reimplementing routing.

## Hash, Changelog, And Review Rules

`configuration_hash` is `sha256:` plus the SHA-256 digest of canonical JSON:
objects recursively sorted by Unicode code-point key order, arrays preserved
in order, and JSON serialization without insignificant whitespace. The hash
covers the entire manifest, including the changelog, and is recomputed by the
resolver rather than committed as a self-referential field.

Every route semantic, guard, provider, model, effort, fallback, or deprecation
change must:

1. Increment `policy_version`.
2. Add a changelog entry with an evidence reference.
3. Update schema/parser tests and a configuration-hash fixture.
4. Receive review sign-off before it can affect execution.
5. Retain shadow-evaluation outcomes keyed by policy version and configuration
   hash before any default change is proposed.

A formatting-only change that produces the same canonical JSON does not change
the hash, but must still be reviewed as a configuration change. An incompatible
schema change increments `schema_version` and provides an explicit migration;
the resolver must reject an unknown schema rather than guessing.

## Migration And Rollback

1. Land this contract and the initial JSON manifest without modifying defaults
   or execution.
2. Add a strict parser and an observe-only resolver command. Extend
   `model-routing.config.local.json` with `policy_adapter_enabled`; migrate a
   missing value to `true` only in the managed generated local file, while
   preserving existing user-owned config.
3. Validate the selected route against the installed effective configuration
   and live catalog, then persist a redacted observation for shadow evaluation.
4. Run representative shadow evaluation. Compare repair, retry, validation,
   failure class, and time-to-merge outcomes by policy hash.
5. Treat `policy_adapter_enabled: false` as the immediate rollback. It stops
   all adapter behavior and leaves ordinary OpenCode selection unchanged.
6. Do not make policy output execution-affecting until a separate reviewed
   policy update explicitly authorizes that behavior.

## Implementation Task Boundary

The next focused implementation task may change only these policy surfaces:

| File | Planned change |
| --- | --- |
| `opencode/control-plane-policy.json` | Add the version-1 manifest described above. |
| `scripts/resolve-opencode-policy.mjs` | Add strict parsing, canonical hashing, effective-config/catalog validation, and observe-only resolution. |
| `scripts/merge-opencode-config.mjs` | Add the `policy_adapter_enabled` local switch and private migration. |
| `scripts/test-opencode-policy-resolver.mjs` | Add resolver contract coverage. |
| `scripts/test-opencode-config.mjs` | Add local switch and merge preservation coverage. |
| `setup-opencode.sh` and its transaction test | Install and validate the resolver only after its focused tests pass. |
| `scripts/validate-opencode-agents.mjs` | Validate the resolved manifest and kill-switch behavior after installation. |

The task must not change `opencode/opencode.defaults.json` model defaults,
create `/luna`, `/sol`, `/sonnet`, or `/terra` commands, add telemetry, or
enable provider fallback.

## Test Matrix

| Case | Expected observe-only result |
| --- | --- |
| Compatible ordinary Build | `build-terra-xhigh`, exact pinned route, `execution_altered: false`. |
| Compatible explicit Ultra | `ultra-inherit-build`, expanded exact Build route, durable controls, `execution_altered: false`. |
| Explicit compatible developer route | Developer selection wins and is reported separately from a manifest route ID without changing execution. |
| Repository restriction conflicts with developer route | `blocked`, restriction named, no replacement route. |
| Advise while locally disabled | `unavailable`, explicit enablement action, no catalog access or selected route. |
| Provider/model missing from live catalog | `unavailable`, catalog reason and developer action, no fallback. |
| Missing provider credentials | `unavailable`, redacted authentication action, no credential value. |
| Disabled provider or unexpandable effective alias | `unavailable` or `unverified`, unchanged effective route, no inferred pinned values. |
| `policy_adapter_enabled: false` | No manifest read, no observation, no execution change. |
| Invalid schema or unsupported version | Resolver fails before reporting a route. |
| Manifest semantic change | Different policy version and canonical hash; changelog required. |
| Legacy local routing configuration | Loads safely with the documented default switch behavior and preserves `advisor_enabled`, agent overrides, and step overrides. |

The resolver's deterministic test suite must run before `setup-opencode.sh`
integrates it. Its catalog tests use a controlled command fixture; a real
installed-config smoke check remains separate and may report unavailable
credentials without exposing them.
