# OpenCode model-routing evidence

This directory contains only privacy-safe aggregates used by the OpenCode routing report.

## Published evidence

- `production-confirmation.json` compares controller completion, boundary compliance, quality, latency, and cost on two production-shaped source-analysis workloads.
- `planning-evaluation.json` records the repeated production-shaped planning comparison.
- `production-coding-cohorts.json` records privacy-safe backend, frontend, mixed, tooling, IaC, final ten-route iOS, and Android implementation outcomes, plus a seven-workload default-candidate aggregate. Validation and compliance remain separate from blind quality.
- `expanded-production-reference-calibration.json` records the privacy-safe 10/10 effective reference-calibration gate for the expanded workload definitions. Candidate trials exist for only three of those ten definitions.
- `small-model-utility.json` records the repeated session-title and project-copy-name utility comparison.
- `exact-file-reader.json` records preliminary isolated exact-file reader calibration.
- `reader-startup-crossover.json` records the preliminary full-config reader startup crossover.
- `pricing-frontier-sample.json` records the matched GPT-5.5 xhigh and Sol high pricing sample.
- `open-weight-provider-frontier.json` records the Fireworks/Baseten route catalog, cost and timing evidence boundary, role decisions, and matched evaluation protocol.
- `matched-switch-gate-final.json` records the final repeated Terra-versus-Sol gate. Its frozen judge-packet provenance is mixed: native editor uses schema v1, while native offline/data and modern client use schema v2. Historical judge outputs were not silently regenerated after the harness changed; final source reconciliation and scoring use the retained outputs under a common decision process, and future matched runs use schema v2.

The HTML report labels within-experiment findings, task-class transfer, policy choices, and unmeasured questions separately. Results from one protocol are not treated as results from another.

## Private evaluation boundary

Production source, repository and product identity, paths, symbols, commit and snapshot identifiers, prompts, rubrics, raw answers, grader keys, grader identity, session IDs, and run fingerprints are not published. Public workloads use generic labels only.

Raw runs live outside the repository in private directories. The runner:

- requires a clean frozen worktree;
- denies edits, shell, network, and advisor access to planning and source-analysis controllers;
- validates that tool paths stay inside the worktree;
- removes the controller step ceiling and gives production-shaped candidate work a configurable 3,600-second wall-time limit after setup;
- records stage completion and incomplete-cost lower bounds;
- pins trusted provider/model metadata and rejects route identity mismatches while replacing permissions, agents, MCP access, and instructions with the locked benchmark boundary;
- recomputes known OpenAI, Fireworks, and Baseten costs from observed usage;
- records launcher startup, time to first observed action, time to first text, model-session duration, and per-step decision latency without mislabeling those event-derived metrics as vendor TTFT;
- binds configuration, model catalogs, repository state, runner source, seed, execution order, session, and transcript hashes into artifact fingerprints;
- revalidates reused raw event logs and text before reuse; and
- emits anonymous grading packets for every nonempty candidate artifact, including failed or timed-out work, while keeping completion, validation, and compliance visible as separate outcomes.

`scripts/benchmark-opencode-model-pairs.mjs` runs the production planning and source-analysis protocols and retains support for reproducing the archived reviewer evidence. `scripts/summarize-blind-grades.mjs` joins independent blind grades to private answer keys without publishing those keys.

The open-weight provider study treats `(model, provider, serving path, reasoning setting)` as the route. Fireworks Standard, Fireworks Fast, and Baseten must use exact pinned IDs and a contemporaneous Terra reference. Implementation screens use the three production-shaped Swift fixtures and hidden tests; only completed, policy-compliant routes advance to three balanced repeats. Planning and bounded-reader roles require separate repeated protocols. Small-model utility results apply only to the exact output contract tested. Luna low for project-copy names and Kimi K2.7 Code through Baseten for session titles are measured recommendations, not installed defaults.

## Archived historical evidence

- `automatic-advisor-causal.json` records the completed causal pilot.
- `advisor-model-comparison.json` records the completed reviewer-model proxy.

Advisor evaluation is closed. These files remain for audit and reproducibility; neither supports automatic advisor routing or an active follow-up study.

No authenticated Fireworks outcome is published in this snapshot because the evaluation environment did not expose a Fireworks credential. The installed provider catalog and commands were resolved successfully, but availability is not reported as quality or latency evidence. Fireworks Fast's vendor throughput claims remain contextual until end-to-end OpenCode measurements justify its 1.5× GLM or 2× Kimi list-price premium.

These evaluations inform cost-aware defaults for high-stakes production work, with iOS weighted heavily because it is the primary workload. They do not establish a universal model ranking, and they do not replace edit, build, simulator, CI, rollout, or production verification.
