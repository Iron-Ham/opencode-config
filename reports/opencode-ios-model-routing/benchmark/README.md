# Production iOS routing evidence

This directory contains only privacy-safe aggregates used by the OpenCode routing report.

## Published evidence

- `production-confirmation.json` compares controller completion, boundary compliance, quality, latency, and cost on two production-shaped source-analysis workloads.
- `automatic-advisor-causal.json` compares a frozen Terra draft, Terra self-review, and transcript-fed Sol review followed by Terra reconciliation across two workload clusters and three repetitions.
- `planning-evaluation.json` records the repeated production-shaped planning comparison.
- `advisor-model-comparison.json` records the matched advisor-model comparison.
- `pricing-frontier-sample.json` records the matched GPT-5.5 xhigh and Sol high pricing sample.
- `open-weight-provider-frontier.json` records the Fireworks/Baseten route catalog, cost and timing evidence boundary, role decisions, and matched evaluation protocol.
- `subagent-roster-audit.json` records the retained, retired, and command-only OpenCode roles plus the limits of that configuration evidence.

The HTML report labels configuration facts, within-experiment findings, task-class transfer, policy choices, and unmeasured questions separately. Results from one protocol are not treated as results from another.

## Private evaluation boundary

Production source, repository and product identity, paths, symbols, commit and snapshot identifiers, prompts, rubrics, raw answers, grader keys, grader identity, session IDs, and run fingerprints are not published. Public workloads use generic labels only.

Raw runs live outside the repository in private directories. The runner:

- requires a clean frozen worktree;
- denies edits, shell, network, Goal, advisor, and subagent access to planning and source-analysis controllers;
- validates that tool paths stay inside the worktree;
- removes the controller step ceiling while retaining a 15-minute request timeout;
- records stage completion and incomplete-cost lower bounds;
- pins trusted provider/model metadata and rejects route identity mismatches while replacing permissions, agents, MCP access, and instructions with the locked benchmark boundary;
- recomputes known OpenAI, Fireworks, and Baseten costs from observed usage;
- records launcher startup, time to first observed action, time to first text, model-session duration, and per-step decision latency without mislabeling those event-derived metrics as vendor TTFT;
- binds configuration, model catalogs, repository state, runner source, seed, execution order, session, and transcript hashes into artifact fingerprints;
- revalidates reused raw event logs and text before reuse; and
- emits anonymous grading packets only from completed, policy-compliant artifacts.

`scripts/benchmark-opencode-model-pairs.mjs` runs the production planning, source-analysis, and staged reviewer protocols. `scripts/summarize-blind-grades.mjs` joins independent blind grades to private answer keys without publishing those keys.

The open-weight provider study treats `(model, provider, serving path, reasoning setting)` as the route. Fireworks Standard, Fireworks Fast, and Baseten must use exact pinned IDs and a contemporaneous Terra reference. Implementation screens use the three production-shaped Swift fixtures and hidden tests; only completed, policy-compliant routes advance to three balanced repeats. Planning and bounded-reader roles require separate repeated protocols. Advisor and compaction choices cannot be inferred from implementer results.

No authenticated Fireworks outcome is published in this snapshot because the evaluation environment did not expose a Fireworks credential. The installed provider catalog and commands were resolved successfully, but availability is not reported as quality or latency evidence. Fireworks Fast's vendor throughput claims remain contextual until end-to-end OpenCode measurements justify its 1.5× GLM or 2× Kimi list-price premium.

These evaluations inform a personal default for high-stakes iOS work. They do not establish a universal model ranking, and they do not replace edit, build, simulator, CI, rollout, or production verification.
