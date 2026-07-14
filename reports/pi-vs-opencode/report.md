# Pi vs OpenCode: iOS model-routing decision

_Decision memo · 14 July 2026 · OpenCode 1.17.20_

## Decision

Use **OpenCode** as the daily driver. Use **GPT-5.6 Luna xhigh** as the default `build` and `general` implementer for routine iOS work, without an advisor. Keep **Claude Sonnet 5** as the broad-repository research, planning, specialist, and recovery lane. Keep **GPT-5.6 Terra xhigh** as an explicit low-latency lane. Keep **GPT-5.6 Sol xhigh** as an approval-gated advisor, never as an automatic routine tax.

The core measured result is unusually clean: Luna, Terra, and Sonnet each passed all three controlled Swift implementation trials at 100/100. Luna had the lowest mean cost, Terra the lowest mean wall time, and Sonnet was the only controller to finish a separate broad monorepo forensic screen inside ten minutes.

### Configured routing

| Work | Route | Reason |
|---|---|---|
| Routine implementation and substantial analysis | Luna xhigh (`build`, `general`, `/luna`) | Same measured Swift quality at the lowest cost |
| Latency-sensitive implementation | Terra xhigh (`/terra`) | Fastest mean Swift completion; about twice Luna's mean cost |
| Broad repository forensics or recovery after a stall | Sonnet 5 provider default (`/sonnet`) | Only controller to complete the broad forensic screen |
| Read-only planning and curated specialists | Sonnet 5 high (`plan`, specialist agents) | Configured deliberate research lane |
| Highest-risk work | Sonnet 5 max (`/ultra`) | Bounded native subagents and direct Sol access |
| Consequential review | Sol xhigh advisor | Approval-gated; at most one call outside Ultra |
| Fast bounded discovery | Kimi K2.7 Code (`explore`) | Shell-free reader |
| Open-weight comparison | GLM 5.2 (`glm_worker`) | Explicit bounded worker; instructions require external verification |

## Why OpenCode, not Pi

Both harnesses are open source. Pi is the better extension laboratory: its official package catalog currently lists **5,296** installable extensions, skills, prompt templates, and themes with search, package types, popularity, recency, and install metadata. Awesome OpenCode is a useful curated GitHub list, but it is not the same kind of package catalog.

OpenCode is the better deployment for this workflow. It already provides native primary agents and subagents, per-agent model routing, allow/ask/deny permissions, skills, commands, MCP, and plugin hooks. The user-level Codex setup maps into those concepts with less third-party orchestration code. Pi can reach similar behavior, but selecting and reconciling overlapping lifecycle extensions adds operational and security work; Pi's own package documentation warns that packages run with full system access.

## Source-level prompt comparison

The system prompt materially changes how a model performs as an agent.

- **Codex** has the densest default autonomy, persistence, safety, collaboration, dirty-worktree, and verification contract.
- **OpenCode GPT-family** models receive its Codex-derived prompt and `apply_patch`; this is the closest default fit to Codex behavior, despite an upstream reference to a parallel tool OpenCode does not expose.
- **OpenCode Claude-family** models receive an Anthropic-specific Read/Edit/Task/Todo prompt. It matches OpenCode's tools literally but carries less of Codex's explicit persistence and completion contract.
- **OpenCode generic** models, including GLM 5.2, receive a thinner generic prompt. Open-weight models are consequently more dependent on a strong custom agent body and deterministic verification.
- **Pi** deliberately starts with a tiny prompt—tools, command preferences, and concision. That is an excellent extension substrate and the least governed raw environment for long mutation-heavy work.

OpenCode custom agent bodies replace the family prompt, after which repository instructions and skills are appended. This is why the setup leaves primary controller prompts intact and uses custom bodies mainly for bounded specialists.

## Controlled Swift implementation trials

Each model received the same private `ReliablePager` Swift package through read, glob, grep, and edit tools only. It could not use shell, network, advisors, subagents, Goal, or paths outside its trial workspace. A fixed harness ran the Swift tests after each turn in a network-denied macOS sandbox with isolated SwiftPM state. The hidden test was added only after the model's final turn.

The quality gate required all public and hidden tests—including concurrency, reset, stale-result, failure, cursor, and deduplication cases—plus compliance and a score of at least 85/100. Three repetitions per model ran in Latin-square order.

| Implementer | Quality floor | Mean cost | Median cost | Mean wall | Median wall |
|---|---:|---:|---:|---:|---:|
| **Luna xhigh** | 3/3 · 100/100 | **$0.103** | **$0.081** | 200 s | 153 s |
| **Terra xhigh** | 3/3 · 100/100 | $0.203 | $0.224 | **132 s** | **140 s** |
| **Sonnet 5 default** | 3/3 · 100/100 | $0.329 | $0.354 | 213 s | 243 s |

Luna was **69% cheaper than Sonnet** on mean task cost at identical measured quality. Terra had **34% lower mean wall time than Luna** but was **97% more expensive** on mean task cost.

An earlier v2 run is excluded. OpenCode trusted inherited `PWD` and edited the canonical fixture instead of the isolated workspace. The retained v3 runner fixes `--dir`, subprocess `cwd`, `PWD`, and `INIT_CWD`; rejects out-of-workspace tool paths; copies from a read-only private snapshot; and verifies the canonical fixture hash.

## Advisor combination trials

The advisor protocol was staged: controller draft → tool-less advisor critique → controller revision in a fork of the original session. It used the installed Advisor's static system prompt and transcript serialization, but it was **not** a native in-turn Advisor tool call. The screen used an offline-pagination investigation; two finalist repetitions used a bridge-concurrency investigation. Answers were randomized and blind graded by two or three independent graders.

### End-to-end screen

| Implementer + advisor | Outcome | Interpretation |
|---|---|---|
| **Sonnet + Sol** | Completed · final quality 9.10 · $1.901 | Advanced |
| **Sonnet + Terra** | Completed · final quality 8.30 · $1.518 | Advanced |
| **Luna + Sol / Sonnet / Opus 4.8 / Fable 5** | Controller draft timed out at 600 s | Advisor never ran; end-to-end route failed this task |
| **Terra + Sonnet / Opus 4.8** | Controller draft timed out at 600 s | Advisor never ran; same limitation |

The timeout rows do **not** show that Opus, Fable, or Sonnet are poor advisors. They show that the complete route was not viable on that broad forensic task because the implementer never produced a draft.

### Advisor aggregates across three matched Sonnet drafts

| Route | Mean quality | Median quality | Improved draft | Score ≥8 | Mean total route cost | Mean incremental review cost |
|---|---:|---:|---:|---:|---:|---:|
| Matched draft, no advisor | **8.13** | 7.63 | — | 1/3 | — | $0 |
| **Sonnet + Sol** | 7.81 | **9.10** | **2/3** | 2/3 | $1.240 | $0.505 |
| **Sonnet + Terra** | 7.40 | 8.30 | 1/3 | 2/3 | **$1.099** | **$0.365** |

The score-count column does not adjudicate the rubric's separate no-material-error requirement. Sol is the advisor to keep because it improved two of three drafts, had the stronger median, and cost only about $0.14 more per mean route than Terra. It must remain approval-gated because both advisors introduced a material error into the same weaker draft, capping both revised answers at 5/10. The retained rubric required a cap but did not define its numeric ceiling; all three blind graders independently chose the conventional 5.0/10 maximum, and these aggregates preserve that evaluator convention. The controller must reconcile advice against source and test evidence rather than accepting it blindly.

Recorded valid advisor experiment spend was **$5.255**; valid Swift implementation spend was **$1.905**. Route totals include a shared draft counterfactually. Experiment spend counts that draft once.

## Installed OpenCode setup

- Global `AGENTS.md` is shared at user level while project instructions retain precedence.
- Curated underscore-named specialists mirror the useful Codex custom agents.
- Goal plugin 0.1.24 is pinned to a 200,000-token default budget, 25 automatic continuations, and a one-hour duration cap.
- The global instruction policy limits normal delegation to two concurrent and four total subagents, and Ultra to four concurrent and eight total. These are model-enforced limits rather than scheduler-enforced quotas.
- Advisor calls are denied to delegated agents, approval-gated for normal primary controllers, and allowed directly only in Ultra.
- The supported Notion advisor, mobile, mobile-ios, observability, and Tuist bundles are refreshed through Notion tooling; notion-dev MCP is configured.
- Claude source skills, Codex-normalized skills, shared third-party skills, and OpenCode-only skills are kept in deterministic discovery locations.
- The JSONC-aware merger uses atomic private writes, preflight/runtime validation, backups, unmanaged-provider/MCP preservation, and stale managed-key cleanup.
- Pinned model aliases work around OpenCode 1.17.20 dropping command `variant` and allowing the UI variant to override agent variants.

## Cost and operational caveats

Official per-million-token prices at this snapshot: Luna $1 input / $6 output; Terra $2.50 / $15; Sol $5 / $30; Opus 4.8 $5 / $25; Fable 5 $10 / $50. Sonnet 5 is $2 / $10 through 31 August 2026 and then $3 / $15.

OpenAI charges requests above 272k input tokens at 2× input and 1.5× output for the full request and charges cache writes at 1.25× input. OpenCode 1.17.20 cannot express the tiered surcharge cleanly, so the benchmark repriced it externally. Long Luna sessions compact through Sonnet in this configuration, so the default route is not fully provider-contained.

Calling Sol from Luna or Terra stays within OpenAI. Calling Sol from Sonnet or Ultra crosses from Anthropic to OpenAI and sends recent conversation and tool context; the rules skip that gate for transcripts not approved for OpenAI.

Codex browser/computer-use, documents, spreadsheets, presentations, Gmail, Calendar, Workspace Agents, and GitHub connector runtimes are not portable OpenCode packages. Compatible skills, Notion plugins, and notion-dev MCP do port.

## Sources

- [Pi package catalog](https://pi.dev/packages) and [Pi package security/documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [Pi default system prompt at reviewed commit](https://github.com/earendil-works/pi/blob/0e6909f050eeb15e8f6c05185511f3788357ddb3/packages/coding-agent/src/core/system-prompt.ts)
- [OpenCode model-family prompt routing at reviewed commit](https://github.com/anomalyco/opencode/blob/4473fc3c9055046183990a965d68df3db7ea6f62/packages/opencode/src/session/system.ts), [GPT prompt](https://github.com/anomalyco/opencode/blob/4473fc3c9055046183990a965d68df3db7ea6f62/packages/opencode/src/session/prompt/gpt.txt), [agents](https://opencode.ai/docs/agents/), and [plugins](https://opencode.ai/docs/plugins/)
- [Awesome OpenCode](https://github.com/awesome-opencode/awesome-opencode)
- OpenAI model pages: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- Anthropic model pages: [Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5), [Opus 4.8](https://www.anthropic.com/claude/opus), and [Fable 5](https://www.anthropic.com/claude/fable)
- [GLM 5.2 announcement](https://z.ai/blog/glm-5.2)
- Local benchmark protocol: `reports/pi-vs-opencode/benchmark/README.md`

## Methodology limits

These are small-sample personal routing trials, not vendor benchmarks. The Swift implementation protocol covers one bounded concurrency task. The advisor protocol covers two read-only iOS investigations, and timed-out costs are lower bounds. The result is an operational default for this model roster, harness version, configuration, and workload—not a universal model ranking.
