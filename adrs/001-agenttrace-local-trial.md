# ADR 001: Decline AgentTrace Local Trial

## Status

Accepted on 2026-07-18.

## Context

The evaluation considered `github.com/luoyuctl/agenttrace` at
`9b76fb61cb32a33b9a0859c533bdea051d0df76c` under its MIT license. The scope
was a disposable local clone, two synthetic OpenCode JSON fixtures, and a
network-denied local build. Real session logs, prompts, production source,
managed OpenCode configuration, shell startup, global installation, and
telemetry were excluded.

Static review found an OpenCode wrapper/storage parser. It normalizes message
content and tool arguments, while its default cache serializes full parsed
session records keyed by absolute file path. The privacy document states that
prompts, code, logs, reports, and telemetry are not uploaded, but generated
reports can contain local filenames, command names, model names, metrics, and
excerpts. Explicit pricing refresh is the inspected runtime network path;
installation can also download a release.

## Decision

Decline AgentTrace integration and any follow-on implementation. No
configuration, installation, plugin, telemetry, or lifecycle behavior changes
are authorized by this ADR.

## Evidence

Two standalone synthetic fixtures were created only in the disposable
directory:

- Completed run: known model, 100 input tokens, 20 output tokens, and a
  five-second duration.
- Interrupted run: known model, 80 input tokens, zero output tokens, and one
  synthetic failed provider tool result.

The fixtures were intended to test displayed model/session duration, failure
classification, and metadata. Correctness is not assessed because the
network-denied build attempted public module resolution before an AgentTrace
binary existed. No real logs were substituted.

The trial read the pinned source license, privacy document, README, parser
guide, OpenCode parser/tests, cache implementation, CLI entry point, pricing
implementation, doctor implementation, and module manifest. It wrote a
disposable source checkout, the two synthetic fixtures, and an isolated Go
build cache; all were deleted. Git and Go launched, but no AgentTrace binary
process launched. Source pinning/check-out contacted GitHub intentionally; the
network-denied build attempted missing module resolution through the public Go
proxy and failed. No AgentTrace runtime network activity occurred.

## Consequences

The task's network-attempt hard stop requires declining the trial. Local
full-session caching and report excerpts would require an explicit privacy
design even if the build had succeeded. This decision does not change managed
defaults, routing, secret handling, persistence, or live OpenCode lifecycle
behavior.
