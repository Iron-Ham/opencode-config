# OpenCode model routing

_A cost-aware OpenCode decision memo · 17 July 2026_

## Decision

Use **GPT-5.6 Terra xhigh** as the provisional production controller across engineering under the pre-registered switch rule. **GPT-5.6 Sol high is the stronger measured quality challenger**: across six repeated attempts on three matched production-shaped tasks, Sol produced more valid results, cleared the 85-point floor twice while Terra never did, and had nearly identical model-session time. Sol passed the completion, quality, time/stability, and developer-control gates, but failed the cost gate: its cost per valid result was **1.349× Terra**, above the locked **1.25×** ceiling. Keep **GPT-5.6 Luna high** as an explicit lane for small, well-specified work with strong deterministic checks. Keep automatic advisor review **off by default**. The developer-invoked **`/advise`** command remains an optional, isolated review escape hatch; it is not part of default routing or the active evaluation program.

This is a conservative operating default, not a claim that Terra matched Sol's observed quality. No matched attempt from either route was carry-as-is after source reconciliation, and Terra produced no result at or above 85, so the cost-per-floor-result comparison is undefined. The production implementation cohorts remain workload-dependent: Terra leads some cohorts, Sol and GLM lead others, Luna can lead a pure value metric without producing the best production handoff, and effort changes do not transfer consistently across domains. Keep the default provisional while representative gaps and the downstream cost of repair remain unresolved.

| Role | Current route or measured recommendation | Evidence status | Reason |
|---|---|---|---|
| Build controller | Terra xhigh | **Pre-registered conservative policy** | Sol passed four of five switch gates but cost per valid result was 1.349× Terra, above the locked 1.25× ceiling |
| Ultra | Terra xhigh with Goal and expanded bounded delegation | **Configuration fact** | A workflow mode, not a claim that another premium model is unnecessary |
| Bounded cost-sensitive work | Luna high via explicit model selection | **Policy from directional evidence** | One compliant matched cluster at lower cost; use only where checks make failure inexpensive |
| Premium implementation | Sol high via explicit model selection | **Within-experiment challenger** | More valid and 85-point results, higher valid-artifact quality, and effectively equal model-session time in the matched repeated cohort; explicit because the cost gate failed |
| Planning | Terra xhigh | **Within-experiment** | Only finalist to finish all four production-shaped plans without a fatal safety cap |
| Automatic advisor | Disabled | **Policy** | The causal pilot showed a modest lift without an outcome change at materially higher cost |
| Explicit advisor | `/advise` → configurable model | **Policy** | Developer opt-in only; existing evidence does not justify further advisor study or an automatic route |
| Compaction | Active session model | **Configuration fact** | Compaction is not separately routed; no separate benchmark is planned |
| Project-copy naming utility | Luna low, measured recommendation | **Within-experiment; not an installed default** | Zero defects across 16 outputs, an aggregate panel decision of Ship, and the best value rank |
| Session-title utility | Kimi K2.7 Code · Baseten, measured recommendation | **Within-experiment; not an installed default** | Production-ready quality, best value and speed, and roughly one quarter of Luna low's median latency |
| Open-weight routes | Provider-pinned Kimi/GLM commands; selectable DeepSeek Baseten route | **Within-experiment for Baseten; Fireworks unmeasured** | Baseten results are workload-specific and do not justify automatic coding or role routing; Fireworks still lacks matched outcomes |

### How to read the labels

- **Within-experiment** — directly observed under the published aggregate protocol.
- **Task-class transfer** — a default inferred from the nearest measured workload, not directly proven for the routed task.
- **Configuration fact** — what the checked-in setup does; it is not an outcome claim.
- **Policy** — an explicit cost, risk, or consent choice informed by evidence.
- **Unmeasured** — no controlled result currently supports a ranking.

For every reported score, **higher is better and rank 1 is best**. Quality:Value cubically weights judged quality and then applies cost efficiency. The weighted metric is 60% cubic quality, 25% cost efficiency, and 15% speed efficiency. Invalid or noncompliant artifacts may retain descriptive scores and ranks, but cannot win a promotion decision.

## Production implementation evidence

The strongest current evidence is the **final, source-adjudicated matched switch gate**: two repeats per route on each of three production-shaped tasks—native editor, native offline/data, and modern client. Every attempt completed, and no provider terminal failure or benchmark wall-time limit occurred.

The frozen judge-packet provenance is intentionally mixed: the native-editor task used packet schema v1, while native offline/data and modern client used schema v2. Historical judge outputs were not silently regenerated after the harness changed. Final source reconciliation and scoring were applied to the retained outputs under a common decision process; future matched runs use schema v2.

A **valid result** means the candidate run completed, passed the declared policy boundary, and passed effective deterministic validation. Invalid artifacts keep their blind scores and handoff assessments for diagnosis, but cannot qualify for promotion or the cost-per-valid denominator.

| Route | Valid results | Results ≥85 | Valid mean | Total observed cost | Cost per valid | Mean model-session time |
|---|---:|---:|---:|---:|---:|---:|
| Terra xhigh | 3/6 | 0 | 76.44 | $9.806 | $3.269 | 587.8 s |
| **Sol high** | **4/6** | **2** | **85.58** | $17.638 | $4.410 | 591.6 s |

The switch rule was locked before outcomes were known. Sol had to match or beat Terra's valid-result count; average at least 85 on valid artifacts; finish no more than three aggregate quality points below Terra; stay within ten points of Terra on each risk-critical task; keep cost per valid and floor-clearing result within **1.25× Terra**; keep mean event-derived model-session time within **1.5×**; and preserve compliance and explicit developer control.

| Gate | Result | Evidence |
|---|---|---|
| Completion and correctness | **Pass** | Source adjudication complete; Sol produced 4 valid results versus Terra's 3, with no catastrophic-regression finding |
| Quality | **Pass** | Sol's 85.58 valid mean cleared 85 and led Terra by 9.14 points; it led by 6.33 on native editor, while native offline/data had no valid Terra comparator and one valid Sol result |
| Cost | **Fail** | Sol cost per valid was 1.349× Terra, above 1.25×; Terra had zero 85-point results, so the floor-result ratio is undefined |
| Time and stability | **Pass** | Sol/Terra model-session ratio 1.0065; zero provider terminal failures |
| Developer control and auditability | **Pass** | The comparison does not alter explicit overrides or route auditability |

**Decision:** retain Terra xhigh as the provisional conservative default because the pre-registered rule requires every gate to pass. Sol is the stronger measured quality challenger and remains the explicit premium route; the failed cost gate is the only reason it is not promoted. This result does **not** establish Terra quality parity: no matched attempt from either route was carry-as-is, and Terra produced no 85-point result, making the cost-per-floor comparison undefined rather than favorable to Terra. The [privacy-safe final aggregate](benchmark/matched-switch-gate-final.json) records the exact arithmetic, generic task-level summaries, and gate outcomes.

The earlier seven-workload cohort remains useful supporting evidence. Among routes present in all seven published workloads, Sol produced **7/7 valid results and 5/7 results at or above 85**; Terra xhigh produced **4/7 valid and 3/7 floor-clearing results**. Those cells contain one attempt each, so the repeated matched gate—not that historical cohort—drives the default decision.

An internal recent-merge classification exposed clear sample mismatch: the selected backend, legacy-client frontend, and iOS references skew smaller than their recent domain distributions, while tooling and IaC are closer to representative size and task shape. The audit window was short, so it is a recency snapshot rather than a stable prior for work across engineering. The cohort revision retains all historical results but demotes broad labels to precise workload identities. Ten additional workloads now have calibrated historical definitions spanning modern-client collections, iOS editor and offline collections, query execution, agent-runtime protocols, external API contracts, realtime, non-AI Android maintenance, desktop native, and mixed monetization. All ten observed merged references pass their effective checks; one raw iOS broad-suite failure is retained and adjudicated to an unchanged flaky test. This establishes runnable workloads, not candidate-model quality. Exact repository, ownership, change-distribution, prompts, PRs, and commit details remain in the private internal report. The [privacy-safe calibration aggregate](benchmark/expanded-production-reference-calibration.json) records the gate.

<details>
<summary><strong>Historical source-analysis and pricing screen</strong></summary>

The public production aggregate covers two production-shaped source-analysis clusters, with three blind graders per workload and one attempt per included model and cluster. It records completion, policy compliance, quality, latency, and normalized list-price cost while excluding source, repository identity, paths, symbols, prompts, rubrics, raw answers, grader keys, and session identifiers.

### Historical matched xhigh result

| Route | Compliant completions | Mean blind score | Combined observed cost | Combined wall time |
|---|---:|---:|---:|---:|
| **Terra xhigh** | **2/2** | **80.88** | **$4.541, complete** | **20.6 min** |
| Luna xhigh | 0/2 | 46.83 | ≥$4.190, lower bound | 27.3 min |

**Within-experiment:** Terra was 24.6% faster, and its complete cost was only 8.4% above Luna's incomplete lower bound. The cheaper per-token model did not produce the cheaper valid result for these workloads.

**Task-class transfer:** that operational gap was early directional evidence for retaining Terra xhigh. The final switch gate above now governs the default decision. Neither result establishes production sufficiency: the historical Terra mean remained below the locked 85-point floor.

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

**Directional Terra comparison:** Terra's observed route cost was 56.6% below GPT-5.5 and 31.7% below Sol high. Terra was slower than both, but its prior blind mean exceeded GPT-5.5 by 9.75 points; Sol exceeded Terra by 5.25 points across separate grader panels. This historical sample is consistent with Terra as the lower-cost route and Sol as an explicit premium lane, but the final matched switch gate above—not this separate-panel comparison—governs the default decision. It does not make GPT-5.5 xhigh a sensible default for this workload.

</details>

### Production-shaped implementation checkpoint

Seven additional cohorts reconstructed previously selected merged changes from frozen pre-change snapshots. They are realistic workloads, but the recent-merge audit shows that they are not a representative cross-section of every labeled domain. Each route produced a patch under the same boundary, deterministic validation was recorded separately, and Sol high, Opus 4.8 xhigh, and Fable 5 xhigh blind-graded every retained artifact. The table shows the highest **compliant, validation-passing weighted result** in each complete cohort. The ten-route iOS cohort is final for its exact native comment-identity workload; representative iOS follow-ups remain necessary before broader routing changes.

| Cohort | Weighted leader | Blind mean | Recomputed cost | Wall time | Interpretation |
|---|---|---:|---:|---:|---|
| Backend access-control migration · nine routes | **Terra high** | **93.67** | **$1.045** | 8.5 min | Led quality and both value metrics; beat xhigh on quality and cost but not latency |
| Legacy-client permission UI · nine routes | **Terra xhigh** | **93.33** | $0.767 | 5.6 min | Highest compliant weighted result; Luna xhigh led pure value but required repair |
| Mixed admin-capability gating · ten routes | **Terra high** | 85.67 | $0.878 | 7.0 min | Weighted leader; Luna retained the pure Quality:Value lead |
| Release orchestration tooling · nine routes | **GLM 5.2 max · Baseten** | **91.00** | $4.221 | 12.3 min | Tied Opus on quality at lower cost; the result did not transfer to IaC |
| Cross-service access IaC · nine routes | **Sol high** | **91.00** | $1.553 | **5.3 min** | Only route combining high blind quality, validation pass, and compliance in this workload |
| iOS comment identity · ten routes | **Sol high** | **90.00** | $3.417 | 22.7 min | Only Carry artifact and weighted leader; DeepSeek led pure Quality:Value, while Terra max timed out and still needed repair |
| Android persisted-thread lifecycle · nine entries | **Sol high** | **90.33** | $3.177 | **10.0 min** | Only validation-passing mergeable artifact; ranked first on both value metrics |

**Within-experiment:** there is no universal winner. Terra led the backend access-control, legacy-client permission, and mixed admin-capability weighted metrics; Luna retained the mixed pure-value lead; GLM led release-orchestration tooling; and Sol led cross-service access IaC, iOS comment identity, and Android persisted-thread lifecycle. Validation and compliance changed the economics: Android Terra ranked second on both value metrics but did not compile, while Sol was the only passing mergeable result.

The complete nine-route backend access-control migration is the clearest positive effort comparison. Terra high passed validation and compliance, scored **93.67**, cost **$1.0449**, and ranked first on both Quality:Value and the weighted metric. Against Terra xhigh on the same frozen task and judge panel, high gained **5.33 quality points** and cost **16.2% less**, while taking **13.8% longer**. Sol high tied Sonnet at **92.67**, but cost **75% more** than Terra high. Kimi and GLM were mergeable at **92.00** and **91.67**, but cost more than four times Terra high; GLM took 2.8 times as long. DeepSeek passed validation at **79.33**, **$3.1917**, and **1,544.1 seconds**; its production logic matches the merged approach, but its tests need routine assertion and helper cleanup, so it ranks **6/9 Quality:Value** and **8/9 weighted** with a carry-with-repair handoff. Sonnet's artifact was mergeable at **92.67**, but its process entered and listed an external benchmark directory, cost 6.4 times Terra high, and took 3.0 times as long. Opus needs a one-line duplicate-import repair and revalidation; Luna's candidate-added tests and changed-file lint failed, so it is a redrive. The matched iOS result below did not preserve high's backend advantage, so **Terra xhigh remains the provisional iOS-weighted default**. Sol high remains the explicit premium implementation lane.

The legacy-client permission workload adds DeepSeek V4 Pro and a matched Luna xhigh effort run. Luna xhigh scored **83.33** at **$0.3651** in **360.3 seconds**, versus Luna high at **81.33**, **$0.3584**, and **349.8 seconds**. Both were carry-with-repair artifacts: xhigh cost 1.9% more, took 3.0% longer, gained two mean-quality points, and did not improve the handoff class. **Luna high therefore remains the bounded cost-sensitive lane; Terra xhigh remains the production controller.**

The IAC effort comparison is more decisive. Luna xhigh cost effectively the same as Luna high (**$0.78209 versus $0.78214**), ran **29.7% longer**, scored **55.67 versus 84**, and failed the same deterministic gate. Its apparent external-path violation was a classifier false positive: the retained search stayed inside its own isolated workspace. Compliance correction does not rescue the artifact—production-significant region and network-boundary behavior was structurally wrong. **Luna high remains the sensible Luna effort.**

The matched mixed Terra effort result reinforces backend. Terra high scored **85.67** at **$0.8779** in **420.4 seconds**, versus xhigh at **79.67**, **$0.9332**, and **377.3 seconds**. High gained six quality points and cost 5.9% less while taking 11.4% longer; it ranks first weighted among ten completed routes. Luna high retains the pure Quality:Value lead. This positive result did not transfer to the matched iOS workload.

The matched Sonnet effort result is decisive for this workload. High and xhigh both scored **89.33** and both require the same small UI repair, but high cost **$5.2019** versus **$9.1255** and finished in **1,244.5 seconds** versus **2,101.5 seconds**. High was 43.0% cheaper and 40.8% faster with no measured quality or handoff loss. Xhigh therefore adds no measured value for this task.

That result did not transfer to release-orchestration tooling. Sonnet high passed the focused tests and cost **$5.2846**, 15.8% less than xhigh, but its blind mean fell to **75.33** versus **88**. It also ran a prohibited scoped typecheck and Git-history discovery. Most importantly, source reconciliation confirmed a merge-blocking command-construction security defect. The panel split 49 unsafe / 88 mergeable / 89 mergeable; the raw mean is retained, but the artifact is a redrive. High's observed **1,229.5-second** time was 3.5% longer than xhigh, but that small difference is not treated as causal because the run overlapped other controlled benchmark work. On this workload, xhigh is the safer Sonnet effort.

The mixed DeepSeek V4 Pro route completed compliantly, passed all locked checks, and scored **85.67** at **$1.9467** in **652.6 seconds**. It ranks fifth on Quality:Value and seventh on the weighted metric in the complete ten-route cohort. The result is a useful carry-with-repair artifact, but one sample does not justify automatic mixed-work routing.

DeepSeek did not transfer to tooling. It completed compliantly and passed the focused checks, but the blind panel scored it **56** at **$2.1969** in **639.7 seconds**, ranking ninth on both Quality:Value and weighted Q/C/speed in the completed nine-route cohort. The patch omitted required deployable artifacts and production lifecycle controls. This is a redrive and a concrete example of why focused validation and blind production review remain separate signals.

DeepSeek also did not transfer to IaC. It completed compliantly but failed locked validation, scored **48**, cost **$4.4085**, took **1,252.2 seconds**, and ranked ninth of nine on both value metrics. Source reconciliation found production-significant region, account, and network-boundary defects that the candidate's tests did not expose. This is a true production redrive, not a policy-classification artifact.

The final iOS cohort contains ten routes. **Sol high** produced the only Carry artifact, led judged quality at **90**, and ranked first on the weighted metric at **$3.4169** in **1,362.4 seconds**. Its raw validation failed only because an unrelated untouched suite emitted the same flaky failure in the Opus run; every task-area check passed. Its raw compliance flag likewise came from inspecting its own captured command output. The corrected packet preserved both raw findings and their audit dispositions before a fresh blind panel rescored the artifact.

DeepSeek V4 Pro led pure Quality:Value with a **70.33** mean at **$1.2223** in **855.1 seconds**, but it retained stale identity during one transition and therefore needs repair; price efficiency is not production-quality parity with Sol. GLM passed at **82** but cost **$3.6251** and took **1,311.8 seconds**. Sonnet passed validation and scored **79.33**, but the unattended route exceeded the real-time limit and read a generated snapshot through an external temporary file; its **1,821.6-second** comparable time measures active process time and excludes machine sleep. Opus passed task-area validation and scored **67.67**, but had the same stale-identity defect as DeepSeek and cost **$5.9691**. Kimi passed at **67** and needs repair. Terra xhigh, Terra high, and Luna failed validation; Luna remains a redrive.

Terra max reached the normalized one-hour boundary with a **165,859-byte compliant patch**, task-focused validation pass, and a corrected raw panel of **93/56/67** for a conservative mean of **72**. Two judges repeated an unsupported claim that snapshot record mode caused the broad failures; the retained log shows every snapshot suite passed and the two failures belonged to untouched tests. The raw panel remains unchanged rather than being manually inflated. Against Terra xhigh, max gained **8.33 judge points** but cost **2.49 times as much**, took **6.91 times as long**, timed out, and still needs a localized scheme cleanup plus a bot-to-human transition regression test. It does not justify an automatic premium/default route on this workload. Sol remains the premium lane for this exact task, while Terra xhigh remains the conservative controller; the completed editor and offline/data repeats still leave broader CRDT, IME, and interaction coverage unresolved.

The completed Android persisted-thread cohort reinforces Sol's cross-workload reliability. **Sol high** passed the corrected module test, scored **90.33**, cost **$3.1772**, finished in **598.5 seconds**, and ranked first on both Quality:Value and weighted Q/C/Speed. It was the only validation-passing mergeable result among nine judged entries. Terra xhigh was the closest repairable alternative: its design approached the merged bar and ranked second on value, but a missing coroutine import left it uncompilable. Opus passed tests at **76.67** but retained lifecycle and persistence gaps requiring repair. Luna, DeepSeek, GLM, both Kimi attempts, and Sonnet required redrive; Sonnet also crossed the workspace boundary. Kimi's initial **325.2-second** timing is retained model-session time, not the later process-lifecycle stall. This result materially strengthens Sol as the default challenger, but the task remains concentrated in one Android AI-chat surface.

A duplicate Fable pass exposed a 59-versus-94 repeat disagreement on the Luna xhigh patch. The lower judgment identified a deterministic test/codegen failure that source inspection confirmed, so 59 is retained. This is a useful warning against treating judge consensus or repetition as ground truth without reconciling material claims against deterministic evidence.

**Policy:** these seven single-attempt cohorts are strong enough to publish workload-specific outcomes, while the completed repeated switch gate drives the provisional default decision. Representative-workload expansion remains necessary before treating the result as universal. The [privacy-safe cohort aggregate](benchmark/production-coding-cohorts.json) contains every retained route, including failed and noncompliant outcomes.

The cohort labels are workload names, not claims of coverage for an entire platform or for work across engineering. The current frontend task is a small legacy-client change, the original iOS route matrix is confined to native comment identity, and the Android shortlist is concentrated in AI chat. A stratified follow-up should add broader iOS CRDT, IME, and editor-interaction coverage beyond the completed matched editor/offline tasks, plus query execution, agent-runtime protocols, external-API security contracts, realtime distributed state, complex client/accessibility work, and Android work outside AI before broad routing claims across engineering are credible.

## Planning

`plan` uses **Terra xhigh** and remains uncapped by an OpenCode step limit. Direct edits are denied and shell access requires approval. The evaluation used two production-shaped iOS planning clusters, four finalist attempts per model, and three blind graders per eligible plan.

| Planner | Completed | Fatal safety caps | Median plan score | Combined observed cost |
|---|---:|---:|---:|---:|
| **Terra xhigh** | **4/4** | **0** | **88** | **$8.303, complete** |
| Sonnet 5 default | 4/4 | 4 | 30 | $2.814, complete |
| Sol xhigh | 3/4 | 1 among completed | 89 among completed | ≥$40.883 |

**Within-experiment:** Terra was the only finalist to complete all four plans without a fatal safety cap. Sonnet was faster and cheaper but repeatedly omitted central isolation or shared-boundary constraints. Sol produced two excellent plans, while another proposed a prohibited live mutation. The fourth attempt hit the legacy evaluation's 15-minute cutoff, not a known model or provider limit, so its cost and completion rate are censored rather than evidence that Sol cannot finish. Its observed total was already 4.9 times Terra's.

Opus 4.8 and Fable 5 were screened twice. Opus scored 45 and 92 at a combined $4.943; Fable scored 15 and 40 at $6.830. Their variance or repeated caps did not justify finalist expansion.

**Decision:** Terra is the sensible planning default for this production-risk profile. This establishes plan quality and stability under the tested protocol; it does not yet prove that a Terra plan causes a cheaper implementer to deliver better code. That downstream plan-to-implementation effect remains unmeasured.

## Open-weight provider frontier

GLM 5.2 and Kimi K2.7 Code are available through both Baseten and Fireworks; DeepSeek V4 Pro is selectable through Baseten. They are not one treatment: the route is **model + provider + serving path + reasoning setting**. Baseten now has matched production-shaped coding and bounded-utility outcomes. OpenCode resolves the managed Fireworks Standard and Fast IDs, but no Fireworks credential was present for authenticated trials in this snapshot, so Fireworks quality, reliability, and realized latency remain **unmeasured**.

“DeepSeek V4 Pro” is the retained OpenCode evaluation-route label. Provider catalog display names can differ; comparisons are keyed by the recorded provider and exact route identifier, not the display label alone.

The measured Baseten GLM endpoint rejected inputs above **202,720 tokens**, even though OpenCode's catalog advertised roughly 1.05M. Two retained attempts therefore ended after producing substantive patches. Those are **benchmark-configuration incidents, not model-quality failures**: their patches remain eligible for validation and blind judging, while their completion outcomes are censored. The managed Baseten route now sets a 202,720-token operational input limit; with the 20,000-token reserve, automatic compaction begins around **182,720 tokens**.

### Cost and time context

| Route | Input / cached / output per 1M | Operational input ceiling | Time evidence |
|---|---:|---:|---|
| DeepSeek V4 Pro · Baseten | $1.74 / $0.145 / $3.48 | ≈262K | Matched outcomes range from a carryable 85.67 mixed result to a 48 IaC redrive; iOS scored 70.33 and led pure Quality:Value but required repair |
| GLM 5.2 · Baseten Standard | $1.40 / $0.26 / $4.40 | **202,720 measured** | Matched OpenCode outcomes range from a 91 tooling mean to a 58 IaC mean; two context terminations are censored configuration incidents |
| GLM 5.2 · Fireworks Standard | $1.40 / $0.14 / $4.40 | Catalog ≈1.05M; unverified | Unmeasured in OpenCode |
| GLM 5.2 · Fireworks Fast | $2.10 / $0.21 / $6.60 | Catalog ≈1.05M; unverified | Fireworks targets 100+ generated tokens/s; vendor claim only |
| Kimi K2.7 Code · Baseten Standard | $0.95 / $0.16 / $4.00 | Catalog ≈262K | Matched coding outcomes are mixed; a separate utility study found production-ready session titles but unstable project-copy names |
| Kimi K2.7 Code · Fireworks Standard | $0.95 / $0.19 / $4.00 | Catalog ≈262K | Unmeasured in OpenCode |
| Kimi K2.7 Code · Fireworks Fast | $1.90 / $0.38 / $8.00 | Catalog ≈262K | Explicit 2× price latency experiment; OpenCode time unmeasured |

Fireworks Standard and Baseten have the same fresh-input and output rates. Fireworks has cheaper GLM cache reads; Baseten has slightly cheaper Kimi cache reads. Fireworks Fast costs **1.5×** Standard for GLM and **2×** for Kimi. It cannot win on a throughput claim alone: the relevant metric is total spend and model-session time per completed, policy-compliant result above the quality floor.

The benchmark runners pin trusted provider metadata, reject a selected route that does not resolve to its expected API identity, can execute through a direct or workspace launcher route, and record launcher startup, first observed model action, first text, model-session duration, and per-step decision latency. These event-derived measures are not vendor TTFT.

### Role decision

| Candidate role | Current decision | Evidence needed to change it |
|---|---|---|
| Production controller | Keep Terra xhigh provisionally | Sol must clear the pre-registered cost gate or a prospectively revised decision rule; the current matched gate failed only on cost |
| Bounded implementer | Keep GLM, Kimi, and DeepSeek explicit only | Results vary materially by workload; require repeated route-specific success before automatic use |
| Plan | Keep Terra xhigh | Repeated production-shaped planning with blind grading and fatal-safety caps |
| Reader | Keep Kimi explicit only | Exact-file answer-key citation precision, recall, completion, cost, and latency |
| Advisor | No default advisor; keep `/advise` opt-in | No separate study planned |
| Session-title utility | Kimi K2.7 Code · Baseten, measured recommendation | Not an installed default; re-evaluate if provider, prompt, or output contract changes |
| Project-copy utility | Luna low, measured recommendation | Not an installed default; re-evaluate if provider, prompt, or output contract changes |

The explicit command surface keeps provider comparisons reproducible: `/glm` and `/kimi` retain Baseten; `/glm-fireworks` and `/kimi-fireworks` use Fireworks Standard; the `-fireworks-fast` variants isolate the latency premium. None is reachable through automatic Task routing.

### Bounded small-model utility recommendations

The utility study used eight production-shaped contexts, two repetitions, two output contracts, and three routes: 96 total invocations. Deterministic checks were combined with an uncapped blind Sol/Opus/Fable panel. The native endpoints did not expose usage, so exact run USD is intentionally absent; cost comparisons use a disclosed 90/10 input/output list-rate proxy.

| Utility | Measured recommendation, not installed default | Combined quality | Median latency | Material defects | Weighted rank |
|---|---|---:|---:|---:|---:|
| Project-copy name | **Luna low** | **97.40** | 1.146 s | **0/16** | **1** |
| Session title | **Kimi K2.7 Code · Baseten** | 96.32 | **0.317 s** | **0/16** | **1** |

Luna low also produced excellent session titles at 97.18 combined quality, but Kimi was about 3.8 times faster at the median and had the better rate proxy. Kimi was not reliable for project-copy names: four of 16 outputs were materially defective, including instruction or tool-scaffold fragments. GLM non-thinking passed deterministic session-title shape checks but exposed reasoning/self-correction artifacts to the blind graders. These are workload-specific routing results, not evidence for coding, planning, reading, or advising. See the [privacy-safe utility aggregate](benchmark/small-model-utility.json).

## Operational configuration

- This describes the user-level configuration used for the study, not a repository-level default across engineering.
- `build`, `plan`, and `ultra` use Terra xhigh. Personal Luna, Terra, Sonnet, and Sol slash commands are not installed; those evaluated models remain available through explicit model selection. The optional `/advise` lane currently uses Opus 4.8 xhigh.
- `plan` uses Terra xhigh based on the repeated planning evaluation.
- Build, plan, Luna, Terra, Sonnet, Sol, and Ultra have no OpenCode step cap.
- Goal is available to the build and explicit model controllers with configured ordinary-run limits. Ultra creates a durable Goal without a default token, automatic-turn, or elapsed-time cap; provider-failure and no-progress loop guards still apply.
- The legacy advisor tool is denied everywhere. `/advise` is developer-invoked, isolated, read-only, and locally disableable; disabling the lane also removes the command so it cannot resolve to a missing agent.
- Compaction keeps the active session model, prunes old tool output, preserves the three most recent turns and 12,000 recent tokens, and reserves 20,000 tokens. It is not a separately routed role.
- Fireworks GLM/Kimi Standard and Fast models are selectable with exact provider-pinned commands, but remain outside default models, `small_model`, and automatic Task routing.

## Limits and next decisions

1. **No full shipping loop.** The implementation cohorts produced and validated patches, but did not complete an edit-build-simulator-CI-release sequence for every route.
2. **Small and uneven production sample.** The seven historical implementation cohorts have one attempt per route, while the switch cohort has six attempts per route across three tasks. Several large product-risk surfaces remain unsampled. These results support a provisional routing policy, not a universal model ranking across engineering.
3. **The original source-analysis routes did not pass 85.** Several implementation artifacts did, but no model substitutes for tests, runtime evidence, independent review, or human ownership.
4. **Incomplete attempts have lower-bound cost.** The historical source-analysis Luna xhigh and Terra max figures exclude unfinished future work and cannot be compared as complete route totals. The separate iOS Terra max run reached the normalized one-hour boundary and is reported as a censored route with its retained patch and observed cost.
5. **Luna high remains workload-sensitive.** It led the mixed value frontier and was inexpensive in frontend, but scored poorly in tooling, failed IaC validation, and produced a redrive iOS artifact; it should remain bounded.
6. **Planner-to-implementer effect unmeasured.** Terra produced the most stable plans; this study did not execute each plan with a cheaper downstream implementer.
7. **Open-weight outcomes are provider-specific.** Baseten has matched results, but no authenticated matched Fireworks trial supports transferring its quality, reliability, or time ranking.
8. **Vendor speed is not end-to-end OpenCode speed.** Published tokens-per-second claims do not include tool decisions, retries, launcher time, or task completion.
9. **Cost uses normalized list price.** Subscription terms, provider discounts, caching, and regional or long-context rules can change out-of-pocket spend.
10. **Deferred effort study.** Sol high versus xhigh versus max remains a separate decision.
11. **No carry-as-is parity.** None of the 12 matched attempts cleared source reconciliation without repair. The gate measures relative route performance, not proof that either route can replace production verification.

## Public evidence

- [Production-controller aggregate](benchmark/production-confirmation.json)
- [Planning evaluation aggregate](benchmark/planning-evaluation.json)
- [Pricing-frontier sample](benchmark/pricing-frontier-sample.json)
- [Production-shaped coding cohorts](benchmark/production-coding-cohorts.json)
- [Matched default-switch gate — final aggregate](benchmark/matched-switch-gate-final.json)
- [Small-model utility study](benchmark/small-model-utility.json)
- [Open-weight provider frontier and matched protocol](benchmark/open-weight-provider-frontier.json)
- Official model pages: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), and [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- Provider sources: [OpenCode providers](https://opencode.ai/docs/providers), [Fireworks pricing](https://docs.fireworks.ai/serverless/pricing), [Fireworks serving paths](https://docs.fireworks.ai/serverless/serving-paths), and [Baseten pricing](https://www.baseten.co/pricing/)

The public report excludes source, repository identity, paths, symbols, prompts, rubrics, raw answers, grader keys, and session identifiers.
