# iOS agent model-routing decision

_Decision memo · 14 July 2026_

## Decision

Use **GPT-5.6 Luna xhigh** as the default `build` and `general` implementer for routine iOS work, without an advisor. Keep **Claude Sonnet 5** as the broad-repository research, planning, specialist, and recovery lane. Keep **GPT-5.6 Terra xhigh** as an explicit low-latency lane. Keep **GPT-5.6 Sol xhigh** as an approval-gated advisor, never as an automatic routine tax.

The measured result is clean: Luna, Terra, and Sonnet each passed all three Swift implementation trials at 100/100. Luna had the lowest mean cost, Terra the lowest mean wall time, and Sonnet was the only controller to finish the broad monorepo forensic screen inside ten minutes.

### Recommended routing

| Work | Route | Reason |
|---|---|---|
| Routine implementation and substantial analysis | Luna xhigh (`build`, `general`, `/luna`) | Same measured Swift quality at the lowest cost |
| Latency-sensitive implementation | Terra xhigh (`/terra`) | Fastest mean Swift completion; about twice Luna's mean cost |
| Broad repository forensics or recovery after a stall | Sonnet 5 provider default (`/sonnet`) | Only controller to complete the broad forensic screen |
| Read-only planning and curated specialists | Sonnet 5 high (`plan`, specialist agents) | Deliberate research lane |
| Highest-risk work | Sonnet 5 max (`/ultra`) | Bounded subagents and direct Sol access |
| Consequential review | Sol xhigh advisor | Approval-gated; at most one call outside Ultra |
| Fast bounded discovery | Kimi K2.7 Code (`explore`) | Shell-free reader |
| Open-weight comparison | GLM 5.2 (`glm_worker`) | Explicit bounded worker; externally verified |

## Swift implementation results

Nine valid runs covered the same concurrency-sensitive Swift task, with three repetitions per model. Every model passed all public and hidden behaviors and scored 100/100.

| Implementer | Quality | Mean cost | Median cost | Mean wall | Median wall |
|---|---:|---:|---:|---:|---:|
| **Luna xhigh** | 3/3 · 100/100 | **$0.103** | **$0.081** | 200 s | 153 s |
| **Terra xhigh** | 3/3 · 100/100 | $0.203 | $0.224 | **132 s** | **140 s** |
| **Sonnet 5 default** | 3/3 · 100/100 | $0.329 | $0.354 | 213 s | 243 s |

Luna was **69% cheaper than Sonnet** on mean task cost at identical measured quality. Terra had **34% lower mean wall time than Luna** but was **97% more expensive** on mean task cost.

This is enough to choose a personal default, not enough to claim a universal ranking across all iOS work.

## Advisor results

Across three matched Sonnet drafts, Sol improved two and Terra improved one. Both advisors also introduced a material error into the same weaker draft, so review remains conditional rather than automatic.

| Route | Mean quality | Median quality | Improved draft | Score ≥8 | Mean route cost | Review increment |
|---|---:|---:|---:|---:|---:|---:|
| Matched draft, no advisor | **8.13** | 7.63 | — | 1/3 | — | $0 |
| **Sonnet + Sol** | 7.81 | **9.10** | **2/3** | 2/3 | $1.240 | $0.505 |
| **Sonnet + Terra** | 7.40 | 8.30 | 1/3 | 2/3 | **$1.099** | **$0.365** |

### Requested combination screen

| Implementer + advisor | Outcome | Interpretation |
|---|---|---|
| **Sonnet + Sol** | Completed · 9.10 quality · $1.901 | Advanced |
| **Sonnet + Terra** | Completed · 8.30 quality · $1.518 | Advanced |
| **Luna + Sol / Sonnet / Opus 4.8 / Fable 5** | Draft timed out at 600 s | Advisor never ran; advisor quality remains unmeasured |
| **Terra + Sonnet / Opus 4.8** | Draft timed out at 600 s | Same limitation |

Keep Sol because it produced the stronger median and improved 2/3 drafts for only about $0.14 more mean route cost than Terra. Require approval because either advisor can make a good draft worse, and reconcile every critique against source and test evidence.

## Cost and operational notes

| Model | Input / 1M | Output / 1M | Role |
|---|---:|---:|---|
| **Luna** | $1 | $6 | Default |
| **Terra** | $2.50 | $15 | Speed lane |
| **Sonnet 5** | $2 introductory; $3 after 31 Aug | $10 introductory; $15 after 31 Aug | Research, plan, specialists, Ultra |
| **Opus 4.8** | $5 | $25 | Screened advisor route did not reach review stage |
| **Sol** | $5 | $30 | Approval-gated advisor |
| **Fable 5** | $10 | $50 | Screened advisor route did not reach review stage |

- Measured task cost, not list price alone, drove the default.
- Long Luna sessions compact through Sonnet, so session-level spend can include an Anthropic request.
- Luna- or Terra-to-Sol review stays inside OpenAI. Sonnet- or Ultra-to-Sol review crosses from Anthropic to OpenAI and requires transcript-egress approval.

## Decision boundaries

- The Swift result is three runs per model on one concurrency-heavy task.
- The advisor result is three matched drafts across two forensic tasks; it demonstrates both lift and harm.
- Timeout rows show an end-to-end route failure on one broad task, not poor advisor quality.
- Sol should remain approval-gated, with no delegated advisor fan-out.
- Revisit the default when substantially broader iOS evidence or material price changes arrive.

## Sources

- OpenAI model pages: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- Anthropic model pages: [Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5), [Opus 4.8](https://www.anthropic.com/claude/opus), and [Fable 5](https://www.anthropic.com/claude/fable)
- [GLM 5.2 announcement](https://z.ai/blog/glm-5.2)
