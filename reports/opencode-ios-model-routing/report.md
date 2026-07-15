# Production iOS agent routing

_A cost-aware OpenCode decision memo · 14 July 2026_

## Decision

Use **GPT-5.6 Terra xhigh** as the provisional default controller for production iOS work. Keep **GPT-5.6 Luna high** as an explicit lane for small, well-specified work with strong deterministic checks. Keep automatic advisor review **off by default**. The developer-invoked **`/advise`** command remains available as an isolated, read-only review; **Claude Opus 4.8 xhigh is its provisional, configurable default**.

The production-controller result is directional. Across two matched production-shaped source-analysis workloads, Terra completed within policy twice while Luna xhigh crossed the read boundary twice. Terra's complete cost was 8.4% above Luna's incomplete lower-bound cost and Terra was 24.6% faster. Neither route cleared the locked 85-point quality floor, and the experiment did not execute a complete edit-build-simulator-CI-shipping cycle.

| Route | Current default | Evidence status | Reason |
|---|---|---|---|
| Build controller | Terra xhigh | **Task-class transfer** | Strongest production-shaped controller result; transferred to production implementation pending full delivery trials |
| Writable `general` child | Inherit Build or Ultra | **Configuration fact** | Prevents a local controller override from silently switching providers; explicit local override remains available |
| Ultra | Terra xhigh with Goal and expanded bounded delegation | **Configuration fact** | A workflow mode, not a claim that another premium model is unnecessary |
| Bounded cost-sensitive work | Luna high via `/luna` | **Policy from directional evidence** | One compliant matched cluster at lower cost; use only where checks make failure inexpensive |
| Planning | Terra xhigh | **Within-experiment** | Only finalist to finish all four production-shaped plans without a fatal safety cap |
| Automatic advisor | Disabled | **Policy** | The causal pilot showed a modest lift without an outcome change at materially higher cost |
| Explicit advisor | `/advise` → Opus 4.8 xhigh | **Task-class transfer** | Best observed quality/cost frontier in a two-cluster planning-review proxy; isolated `/advise` behavior remains unmeasured |
| Compaction | Active session model | **Configuration fact** | No fixed universal compactor is configured; semantic-retention quality remains unmeasured |
| Open-weight routes | Explicit provider-pinned Kimi/GLM commands | **Configuration fact; outcomes unmeasured** | Fireworks and Baseten are selectable, but no production role changes without matched quality, cost, and time evidence |

### How to read the labels

- **Within-experiment** — directly observed under the published aggregate protocol.
- **Task-class transfer** — a default inferred from the nearest measured workload, not directly proven for the routed task.
- **Configuration fact** — what the checked-in setup does; it is not an outcome claim.
- **Policy** — an explicit cost, risk, or consent choice informed by evidence.
- **Unmeasured** — no controlled result currently supports a ranking.

## Production controller

The public production aggregate covers two production-shaped source-analysis clusters, with three blind graders per workload and one attempt per included model and cluster. It records completion, policy compliance, quality, latency, and normalized list-price cost while excluding source, repository identity, paths, symbols, prompts, rubrics, raw answers, grader keys, and session identifiers.

### Matched xhigh result

| Route | Compliant completions | Mean blind score | Combined observed cost | Combined wall time |
|---|---:|---:|---:|---:|
| **Terra xhigh** | **2/2** | **80.88** | **$4.541, complete** | **20.6 min** |
| Luna xhigh | 0/2 | 46.83 | ≥$4.190, lower bound | 27.3 min |

**Within-experiment:** Terra was 24.6% faster, and its complete cost was only 8.4% above Luna's incomplete lower bound. The cheaper per-token model did not produce the cheaper valid result for these workloads.

**Task-class transfer:** that operational gap is enough to make Terra xhigh the production iOS controller. It is not evidence that Terra is production-sufficient by itself: its 80.88 mean remained below the locked 85-point floor.

### Effort and premium lanes

Luna high was included in one cluster. It completed within policy at **73.42** for **$0.849**. Luna xhigh scored **73.00** in the same cluster, crossed the boundary, took more than twice as long, and incurred at least **$1.581**. This is directional support for Luna high as the bounded lane, not broad Luna-versus-Terra parity.

Terra max had one timed-out attempt at a cost of at least **$5.538**. That narrow result is enough not to ship it as the default route; it does not establish that max effort is never useful.

### Published rate context

Standard published API rates explain the attraction of cheaper lanes, but do not predict route-level cost or correctness.

| Model | Input / 1M tokens | Cached input / 1M | Output / 1M |
|---|---:|---:|---:|
| [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | $1.00 | $0.10 | $6.00 |
| [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) | $2.50 | $0.25 | $15.00 |
| [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) | $5.00 | $0.50 | $30.00 |
| [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5) | $5.00 | $0.50 | $30.00 |

Terra's matched published token rates are half GPT-5.5's and Sol's; Luna's are 60% below Terra's. These ratios are pricing facts, not iOS quality comparisons. Actual route cost also depends on token use, retries, cache behavior, completion, and downstream rework.

### Real pricing sample

One additional production-shaped source-analysis workload compared GPT-5.5 xhigh and GPT-5.6 Sol high contemporaneously. A prior Terra xhigh run used the same frozen workload and protocol, but a separate seed and blind-grader panel, so its quality comparison is directional.

| Route | Blind result | Observed cost | Wall time |
|---|---:|---:|---:|
| GPT-5.5 xhigh | Median 73; mean 73 | $6.460 | 8.9 min |
| Sol high | **Median 89; mean 88** | $4.100 | **7.9 min** |
| Terra xhigh reference | Mean 82.75, separate panel | **$2.802** | 11.1 min |

**Within the contemporaneous sample:** Sol high cost 36.5% less than GPT-5.5 xhigh, finished 11.7% faster, and gained 15 mean points despite identical published token rates. Model behavior and cache traffic mattered more than list-price parity.

**Directional Terra comparison:** Terra's observed route cost was 56.6% below GPT-5.5 and 31.7% below Sol high. Terra was slower than both, but its prior blind mean exceeded GPT-5.5 by 9.75 points; Sol exceeded Terra by 5.25 points across separate grader panels. This supports Terra as the cost-aware production default and Sol as an explicit premium lane, not GPT-5.5 xhigh as a sensible default for this workload.

## Planning

`plan` uses **Terra xhigh** and remains uncapped by an OpenCode step limit. Direct edits are denied and shell access requires approval. The evaluation used two production-shaped iOS planning clusters, four finalist attempts per model, and three blind graders per eligible plan.

| Planner | Completed | Fatal safety caps | Median plan score | Combined observed cost |
|---|---:|---:|---:|---:|
| **Terra xhigh** | **4/4** | **0** | **88** | **$8.303, complete** |
| Sonnet 5 default | 4/4 | 4 | 30 | $2.814, complete |
| Sol xhigh | 3/4 | 1 among completed | 89 among completed | ≥$40.883 |

**Within-experiment:** Terra was the only finalist to complete all four plans without a fatal safety cap. Sonnet was faster and cheaper but repeatedly omitted central isolation or shared-boundary constraints. Sol produced two excellent plans, but another proposed a prohibited live mutation and the fourth timed out after 15 minutes. Its observed total was already 4.9 times Terra's, with the timeout still a lower bound.

Opus 4.8 and Fable 5 were screened twice. Opus scored 45 and 92 at a combined $4.943; Fable scored 15 and 40 at $6.830. Their variance or repeated caps did not justify finalist expansion.

**Decision:** Terra is the sensible planning default for this production-risk profile. This establishes plan quality and stability under the tested protocol; it does not yet prove that a Terra plan causes a cheaper implementer to deliver better code. That downstream plan-to-implementation effect remains unmeasured.

## Advisor effect

The advisor causal pilot used two production-shaped source-analysis clusters, three matched frozen drafts per cluster, and three blind graders per answer. It compared:

1. a direct Terra draft;
2. the same draft after Terra self-review; and
3. the same draft after tool-less Sol review followed by Terra reconciliation.

| Treatment | Median quality delta vs direct | Mean route cost | Mean wall time |
|---|---:|---:|---:|
| Terra direct | — | $1.137 | 6.3 min |
| Terra self-review | 0 | $1.511 | 7.7 min |
| Sol review + Terra reconciliation | **+2** | **$1.619** | **7.5 min** |

**Within-experiment:** Sol assistance produced a median **+2 points** over direct and **+2.5 points** over Terra self-review. One of six matched drafts improved by at least five points; none worsened by at least five. There were no passes of the locked **85-point quality floor** and no failed-to-pass rescues. Sol assistance cost **42.35% more than direct** and **7.16% more than self-review**, and took **20.24% longer than direct**.

**Policy:** automatic transcript-fed review stays off by default. The result is a modest directional benefit without an outcome change in this sample—not evidence that advisors are ineffective. Explicit review remains available when the developer judges the residual production risk worth the extra context and spend.

**Unmeasured:** the causal pilot did not test the shipped `/advise` mechanism, which receives only developer-supplied context in a separate read-only session.

### Advisor-model comparison

A separate planning-review proxy held one Terra draft fixed in each of two production-shaped clusters. Each reviewer received the same bounded transcript; Terra then reconciled the advice. Three blind graders scored every final answer.

| Route | Cluster median scores | Mean of cluster medians | Total observed route cost |
|---|---:|---:|---:|
| Untreated Terra draft | 87, 78 | 82.5 | $4.713 |
| Terra self-review | 87, 78 | 82.5 | $6.058 |
| Sol xhigh review | 85, 81 | 83 | $5.893 |
| Sonnet xhigh review | 89, 83 | 86 | $5.813 |
| **Opus 4.8 xhigh review** | **83, 95** | **89** | **$5.598** |
| Fable xhigh review | 81, 81 | 81 | $6.245 |

**Within-experiment:** Opus had the highest mean of cluster medians and the lowest total observed cost among the four advisor routes. Relative to leaving the drafts untreated, the Opus route cost 18.79% more and improved the mean cluster median by 6.5 points. There were no fatal caps.

**Task-class transfer:** `/advise` therefore defaults provisionally to **Opus 4.8 xhigh**. The workload winner changed—Sonnet led the first cluster and Opus the second—and two clusters are not enough for a universal advisor ranking. The shipped command also receives developer-selected context rather than the benchmark transcript, so the model remains locally replaceable or disableable.

## Open-weight provider frontier

GLM 5.2 and Kimi K2.7 Code are available through both Baseten and Fireworks. They are not one treatment: the route is **model + provider + serving path + reasoning setting**. OpenCode resolves the managed Fireworks Standard and Fast IDs, but no Fireworks credential was present for authenticated trials in this snapshot. Quality, reliability, and realized OpenCode latency therefore remain **unmeasured**, and no production role changes.

### Cost and time context

| Route | Input / cached / output per 1M | Context | Time evidence |
|---|---:|---:|---|
| GLM 5.2 · Baseten Standard | $1.40 / $0.26 / $4.40 | ≈1.05M | Baseten vendor benchmark; prior harness use was experienced as slow, but no retained matched provider timing exists |
| GLM 5.2 · Fireworks Standard | $1.40 / $0.14 / $4.40 | ≈1.05M | Unmeasured in OpenCode |
| GLM 5.2 · Fireworks Fast | $2.10 / $0.21 / $6.60 | ≈1.05M | Fireworks targets 100+ generated tokens/s; vendor claim only |
| Kimi K2.7 Code · Baseten Standard | $0.95 / $0.16 / $4.00 | ≈262K | Unmeasured in the retained matched protocol |
| Kimi K2.7 Code · Fireworks Standard | $0.95 / $0.19 / $4.00 | ≈262K | Unmeasured in OpenCode |
| Kimi K2.7 Code · Fireworks Fast | $1.90 / $0.38 / $8.00 | ≈262K | Explicit 2× price latency experiment; OpenCode time unmeasured |

Fireworks Standard and Baseten have the same fresh-input and output rates. Fireworks has cheaper GLM cache reads; Baseten has slightly cheaper Kimi cache reads. Fireworks Fast costs **1.5×** Standard for GLM and **2×** for Kimi. It cannot win on a throughput claim alone: the relevant metric is total spend and model-session time per completed, policy-compliant result above the quality floor.

The benchmark runners pin trusted provider metadata, reject a selected route that does not resolve to its expected API identity, can execute through a direct or workspace launcher route, and record launcher startup, first observed model action, first text, model-session duration, and per-step decision latency. These event-derived measures are not vendor TTFT.

### Role decision

| Candidate role | Current decision | Evidence needed to change it |
|---|---|---|
| Production controller or writable `general` | Keep Terra xhigh | Three repeated production-shaped iOS implementation workloads with hidden-test correctness and policy compliance |
| Bounded implementer | Keep GLM explicit only | Non-inferior correctness plus lower total cost or time per valid result |
| Plan | Keep Terra xhigh | Repeated production-shaped planning with blind grading and fatal-safety caps |
| Reader or retained specialist | Keep Kimi explicit only | Exact-file answer-key citation precision, recall, completion, cost, and latency |
| Advisor | Keep provisional Opus 4.8 xhigh | Frozen-draft advice followed by reconciliation and outcome grading |
| Compaction | Inherit the active model | Semantic and instruction retention, privacy, and explicit transcript-egress approval |

The explicit command surface keeps provider comparisons reproducible: `/glm` and `/kimi` retain Baseten; `/glm-fireworks` and `/kimi-fireworks` use Fireworks Standard; the `-fireworks-fast` variants isolate the latency premium. None is reachable through automatic Task routing.

## Deliberate subagent roster

The OpenCode roster keeps narrow, evidence-bound roles and rejects broad persona routing. A specialist name is not evidence that delegation improves an outcome. The controller remains responsible for implementation, reconciliation, and final verification.

| Agent | Retained purpose | Boundary | Evidence status |
|---|---|---|---|
| `general` | Substantial independent writable slice from Build or Ultra | Inherits the controller model; no recursive Task, Goal, advisor, interactive question, unknown external tool, or authority-requiring shell action | **Configuration fact; outcome benefit unmeasured** |
| `code_reviewer` | Independent review of a concrete change for material correctness and regression risk | Read-only; delegated request must include the diff or exact changed files; no broad content search | **Configuration fact; outcome benefit unmeasured** |
| `security_engineer` | Bounded threat review for an identified trust boundary or consequential change | Read-only; parent supplies the boundary and evidence; no broad content search | **Configuration fact; outcome benefit unmeasured** |
| `software_architect` | Challenge a consequential cross-boundary decision | Read-only; parent supplies relevant source and current-system evidence; no broad content search | **Configuration fact; outcome benefit unmeasured** |
| `accessibility_auditor` | Platform-specific review grounded in source or supplied runtime evidence | Read-only; no broad search or commands; absent runtime evidence is reported as unverified | **Configuration fact; outcome benefit unmeasured** |
| `database_optimizer` | Optional analysis of a concrete query, schema, locking, migration, or rollout risk | Read-only; requires workload evidence and never treats an index as automatically beneficial | **Configuration fact; outcome benefit unmeasured** |
| `evidence_analyst` | Independent analysis of an exact claim checklist and collected evidence | Artifact-only; no shell or interactive tools; the controller runs verification commands | **Configuration fact; outcome benefit unmeasured** |
| `explore` | Bounded repository discovery | Read-only, no shell or delegation | **Configuration fact; outcome benefit unmeasured** |

The generic Mobile App Builder, backend/frontend implementer personas, Git workflow persona, and technical-writer persona are not part of the OpenCode roster. Mobile implementation stays with the production controller plus repository-local mobile instructions and skills. That avoids treating borrowed role prose as battle-tested capability or letting a generic subagent silently own production edits.

Setup also removes a known plugin-generated agent whose source package does not support OpenCode. Plugin installation is not treated as evidence that every emitted agent is safe or intentional; unsupported agents stay unavailable until their canonical source is explicitly hardened and reviewed.

`kimi_reader` and `glm_worker` remain hidden command-only experiments. Kimi is read-only; GLM is a bounded writable experiment whose shell and broad search require approval. Provider-pinned Baseten, Fireworks Standard, and Fireworks Fast commands reuse these permission boundaries. None is a default, because no controlled matched quality, latency, or total-cost study supports one. `advisor_reviewer` is also a hidden subagent: `/advise` is its only visible entry point, and every controller denies it as a Task target.

The retained specialists and `explore` inherit the invoking primary model by default and have 100-step limits. The writable `general` child also inherits its Build or Ultra controller and is uncapped by default so a production-sized delegated slice does not fail at an arbitrary iteration ceiling. A Luna controller therefore stays Luna-backed and a Terra controller stays Terra-backed unless the developer explicitly supplies a role-specific local override. Children cannot open an interactive question prompt: missing scope or evidence is returned as `unverified`, so a child does not quietly stall an unattended controller. This avoids pretending that Sonnet is a proven specialist while preserving optional local experimentation.

## Operational configuration

- `build`, `terra`, and `ultra` use Terra xhigh. `general` inherits its invoking Build or Ultra model unless explicitly overridden. `luna` uses Luna high; `sonnet` uses provider-default Sonnet 5; `sol` uses Sol xhigh; `/advise` provisionally uses Opus 4.8 xhigh.
- `plan` uses Terra xhigh based on the repeated planning evaluation. Retained thin specialists and `explore` inherit the invoking primary model.
- Build, plan, `general`, Luna, Terra, Sonnet, Sol, and Ultra have no OpenCode step cap. `explore`, specialists, and experimental children have 100; the focused advisor has 60.
- Goal is available to the build and explicit model controllers, with a 200,000-token default budget, at most 25 automatic continuations, a one-hour duration cap, and no-progress stops. Ultra explicitly uses Goal for multi-turn work.
- The legacy advisor tool is denied everywhere. `/advise` is developer-invoked, isolated, read-only, and locally disableable; disabling the lane also removes the command so it cannot resolve to a missing agent.
- Compaction keeps the active session model, prunes old tool output, preserves the three most recent turns and 12,000 recent tokens, and reserves 20,000 tokens. Retention quality has not been benchmarked.
- Fireworks GLM/Kimi Standard and Fast models are selectable with exact provider-pinned commands, but remain outside default models, `small_model`, compaction, and automatic Task routing.
- Role-based Build and Ultra may delegate writable work to `general`, which inherits the controller model unless explicitly overridden. Model-branded controllers keep implementation in their pinned lane and can delegate only to inherited-model read-only roles. Subagents cannot recursively delegate or invoke advisor/Goal tools.
- Sensitive environment-file reads are denied. Thin specialists deny broad content search and interactive questions. `general` denies unknown external tools and authority-requiring shell operations so an unattended child returns the need to its controller instead of waiting.

Machine-local `model-routing.config.local.json` keeps the defaults developer-owned:

```json
{
  "advisor_enabled": true,
  "agents": {
    "advisor_reviewer": "anthropic/claude-opus-4-8-xhigh-pinned"
  },
  "steps": {
    "general": 300,
    "code_reviewer": null
  }
}
```

`advisor_enabled` controls both the explicit `/advise` command and its hidden agent. Allowlisted `agents` entries replace a managed model locally; setting a model for an inherited specialist is therefore an explicit provider/cost choice. A positive `steps` value changes the limit; `null` removes it. These are sane defaults, not centrally locked policy.

## Limits and next decisions

1. **No full shipping loop.** The production confirmation is source analysis, not a complete edit-build-simulator-CI-release run.
2. **Small production sample.** The matched controller result covers two clusters with one attempt per included route. The operational gap is large; the sample is not broad.
3. **No route passed 85.** Terra is the strongest tested controller, not a substitute for tests, runtime evidence, independent review, or human ownership.
4. **Incomplete attempts have lower-bound cost.** The Luna xhigh and Terra max figures exclude unfinished future work and cannot be compared as complete route totals.
5. **Luna high is directional.** It appears in one matched cluster and should stay bounded until broader evidence exists.
6. **Planner-to-implementer effect unmeasured.** Terra produced the most stable plans; this study did not execute each plan with a cheaper downstream implementer.
7. **Luna plus advisor versus Terra is unmeasured.** Both advisor studies begin with Terra drafts; they do not establish that Luna plus Sol, Sonnet, Opus, or Fable reaches direct Terra quality or lowers cost per valid result.
8. **Advisor transfer remains provisional.** Opus led the two-cluster planning-review aggregate, but the winning reviewer changed by workload and the isolated `/advise` mechanism was not directly tested.
9. **`/advise` outcome unmeasured.** The shipped isolated mechanism differs from the transcript-fed automatic treatment.
10. **Subagent outcomes unmeasured.** The current roster is justified by narrow scope and permissions, not proof that each role improves production results.
11. **Open-weight provider outcomes pending.** Fireworks and Baseten routes resolve, but no authenticated matched Fireworks trial supports a quality, reliability, or time ranking in this snapshot.
12. **Vendor speed is not harness speed.** Published tokens-per-second claims do not include OpenCode tool decisions, retries, launcher time, or task completion.
13. **Cost uses normalized list price.** Subscription terms, provider discounts, caching, and regional or long-context rules can change out-of-pocket spend.
14. **Deferred effort study.** Sol high versus xhigh versus max remains a separate decision.

## Public evidence

- [Production-controller aggregate](benchmark/production-confirmation.json)
- [Planning evaluation aggregate](benchmark/planning-evaluation.json)
- [Automatic-advisor causal aggregate](benchmark/automatic-advisor-causal.json)
- [Pricing-frontier sample](benchmark/pricing-frontier-sample.json)
- [Advisor-model comparison](benchmark/advisor-model-comparison.json)
- [Open-weight provider frontier and matched protocol](benchmark/open-weight-provider-frontier.json)
- [Subagent roster audit](benchmark/subagent-roster-audit.json)
- Official model pages: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), and [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- Provider sources: [OpenCode providers](https://opencode.ai/docs/providers), [Fireworks pricing](https://docs.fireworks.ai/serverless/pricing), [Fireworks serving paths](https://docs.fireworks.ai/serverless/serving-paths), and [Baseten pricing](https://www.baseten.co/pricing/)

The public report excludes source, repository identity, paths, symbols, prompts, rubrics, raw answers, grader keys, and session identifiers.
