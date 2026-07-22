# ADR 007: Stateless Ultra Prompt Template

## Status

Accepted on 2026-07-22.

## Context

The retired `/ultra` command used the retired `ultra` agent and Goal-mode
lifecycle. ADR 006 left a stateless prompt template as a possible replacement,
provided it did not restore Goal state or automatic continuation.

## Decision

Implement `/ultra` as an opt-in Markdown command template that invokes the
existing `build` agent. It is not a new agent, workflow, model mode, persistent
lifecycle, or control-plane invocation mode. Ordinary sessions do not receive
the template's full prompt.

The template preserves ordinary model and permission selection and adds no
model, variant, provider, Goal plugin, Goal permission, scheduler, persistent
state, token budget, or automatic continuation. Selective delegation is guided
by evidence rather than available-capacity fan-out. Native `Task` calls are
bounded at 10 concurrent and 20 total child tasks per root session tree, with
`subagent_depth: 1` preventing recursive native Task delegation. Controllers
dispatch specialists directly. The concurrency ceiling is a safety boundary,
not a delegation target, and does not cap plugin-created sessions or other
machine-wide APIs.

## Evidence

Focused cost and lifecycle evidence consists of the bounded command template,
captured local provider request payloads, finite delegation-guard tests, and
continued absence of retired Goal assets. The implementation follows the
one-level delegation and evidence-discipline ideas in the upstream Codex
sources:

- https://github.com/openai/codex/blob/bbfc3f0152cf332d01547ddfac835409bc8ce485/codex-rs/core/src/session/multi_agents.rs
- https://github.com/openai/codex/blob/bbfc3f0152cf332d01547ddfac835409bc8ce485/codex-rs/core/src/context/multi_agent_mode_instructions.rs
- https://github.com/openai/codex/blob/bbfc3f0152cf332d01547ddfac835409bc8ce485/codex-rs/ext/goal/templates/goals/continuation.md

[ADR 006](006-retire-goal-mode-and-unused-command-lanes.md) remains the record
of the Goal-mode retirement and its stateless template constraint.
