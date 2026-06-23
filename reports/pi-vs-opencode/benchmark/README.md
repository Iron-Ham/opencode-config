# iOS model-routing benchmark

This directory documents two separate OpenCode 1.17.20 protocols. Results from one protocol are never treated as results from the other.

## Controlled Swift implementation trials

`benchmark-opencode-swift-implementers.mjs` gives each model the same small `ReliablePager` Swift package through a private, per-trial workspace. The model receives only read, glob, grep, and edit tools. It cannot use shell, network, advisors, subagents, Goal, or paths outside the trial. After every model turn, the runner executes the package tests in a macOS sandbox with network denied, an empty home directory, and isolated SwiftPM state. A hidden regression test is added only after the final turn.

Each model ran three times in Latin-square order. The quality gate requires all public and hidden tests, critical concurrency and stale-result cases, instruction compliance, a completed stage, and a score of at least 85/100. Cost is taken from OpenCode events and wall time from the runner.

```bash
bun scripts/benchmark-opencode-swift-implementers.mjs \
  --output-dir /private/tmp/opencode-swift-implementers-v3 \
  --repeats 3 \
  --models luna,terra,sonnet
```

The earlier `v2` directory is protocol-invalid and excluded: OpenCode trusted an inherited `PWD` and edited the canonical fixture instead of the isolated trial. The retained runner sets `--dir`, subprocess `cwd`, `PWD`, and `INIT_CWD`; rejects out-of-workspace tool paths; copies from a read-only private snapshot; and verifies the canonical fixture hash.

## Staged advisor-routing trials

`benchmark-opencode-model-pairs.mjs` measures a staged draft → critique → revision route on fixed, read-only iOS source investigations at one `notion-next` commit. This is not a native in-turn call to the installed Advisor tool. It reproduces the installed advisor's static system prompt and transcript serialization in a standalone, tool-less advisor stage, then asks the original controller to revise a fork of its draft session.

Controllers receive read, glob, and grep only. Advisors receive no tools. Shell, network, edits, native subagents, Goal, and the installed Advisor tool are denied. Each stage has a ten-minute cap. Completed drafts are reused across advisor routes only when a SHA-256 fingerprint matches the task, controller, configuration, runner source, working directory, and OpenCode version.

Screening round:

```bash
bun scripts/benchmark-opencode-model-pairs.mjs \
  --workdir ~/Developer/Notion/notion-next \
  --task-file reports/pi-vs-opencode/benchmark/tasks/offline-pagination.md \
  --rubric-file reports/pi-vs-opencode/benchmark/rubrics/offline-pagination.md \
  --round offline \
  --output-dir /private/tmp/opencode-ios-advisor-staged-v1 \
  --combos sonnet-terra,sonnet-sol,terra-sonnet,terra-opus,luna-sonnet,luna-sol,luna-opus,luna-fable
```

Finalist extension:

```bash
bun scripts/benchmark-opencode-model-pairs.mjs \
  --workdir ~/Developer/Notion/notion-next \
  --task-file reports/pi-vs-opencode/benchmark/tasks/bridge-concurrency.md \
  --rubric-file reports/pi-vs-opencode/benchmark/rubrics/bridge-concurrency.md \
  --round bridge \
  --output-dir /private/tmp/opencode-ios-advisor-staged-v2 \
  --repeats 2 \
  --combos sonnet-terra,sonnet-sol
```

Answers are randomized and graded blind against fixed rubrics. Three independent graders scored the finalist extension; two independently graded the screen. A route passes the quality floor at 8.0/10 with no material safety error. Both route cost and unique experiment cost are recorded: route cost includes the shared draft counterfactually, while experiment cost counts a reused draft once.

`advisor-grades.json` preserves the route-level scores and aggregates used by the report without publishing the private randomized answer keys.

OpenAI requests beyond the official long-context threshold are repriced outside OpenCode because 1.17.20 cannot encode the tiered surcharge without discarding the base model metadata. Benchmark state and answer keys stay in private `0700` output directories with `0600` files; copied authentication is scrubbed after execution.

The first source-investigation attempt, earlier tool-enabled reviewer experiments, and every run with a path-permission failure are protocol-invalid and excluded. These small-sample trials support a personal routing decision, not a universal vendor ranking.
