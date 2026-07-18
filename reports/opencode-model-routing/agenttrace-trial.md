# AgentTrace Local Trial Decision

## Verdict

**Decline.** The synthetic-only local trial stopped before AgentTrace ran because
the pinned source could not build without attempting public network access for
missing Go modules. No integration, installation, configuration change, or
follow-on implementation is proposed.

## Scope And Source

- Evaluated source: `github.com/luoyuctl/agenttrace` at
  `9b76fb61cb32a33b9a0859c533bdea051d0df76c`.
- License: MIT.
- Boundary: disposable local clone, two synthetic OpenCode JSON fixtures, and
  network denied during the local build attempt.
- Excluded: real session logs, real prompts, production source, managed
  OpenCode configuration, shell startup, global installation, and telemetry.

## Static Compatibility And Privacy Inventory

- The source includes an OpenCode wrapper/storage parser and documents
  OpenCode support.
- The parser normalizes message content and tool arguments. Its default session
  cache serializes full parsed session records, keyed by absolute file path.
- The privacy document states that prompts, code, logs, reports, and telemetry
  are not uploaded. Generated reports can still contain local filenames,
  command names, model names, metrics, and excerpts.
- The only inspected runtime network path is explicit pricing refresh; the
  ordinary analysis path uses built-in or cached pricing. The source also has
  an installation path that downloads a release, which was not used.

## Synthetic Trial

Two standalone synthetic JSON fixtures were created only in the disposable
directory:

- Completed run: known model, 100 input tokens, 20 output tokens, and a
  five-second duration.
- Interrupted run: known model, 80 input tokens, zero output tokens, and one
  synthetic failed provider tool result.

The fixtures were intended to test displayed model/session duration, failure
classification, and metadata. Correctness is **not assessed**: the build hard
stop occurred before an AgentTrace binary existed, so neither fixture was
parsed. Substituting real logs would violate the task boundary.

## Observed Inventory

- Files read: the pinned source license, privacy document, README, parser
  guide, OpenCode parser/tests, cache implementation, CLI entry point, pricing
  implementation, doctor implementation, and module manifest.
- Files written: a disposable source checkout, the two synthetic fixtures, and
  an isolated Go build cache. All were deleted after the stop.
- Processes launched: Git for source pinning and checkout; Go for the local
  build attempt. No AgentTrace binary process launched.
- Network: source pinning/check-out intentionally contacted GitHub. The
  network-denied build attempted missing module resolution through the public
  Go proxy and failed. No AgentTrace runtime network activity occurred.
- Resource use: no AgentTrace runtime resource measurement is available;
  compilation did not complete and produced no executable.

## Decision Basis

The task requires stopping immediately on a network attempt. The failed,
network-denied build is therefore sufficient evidence to decline this trial.
Even absent that stop, local full-session caching and report excerpts would
need an explicit privacy design before any optional evaluation. This decision
does not change managed defaults, routing, secret handling, persistence, or
live OpenCode lifecycle behavior.
