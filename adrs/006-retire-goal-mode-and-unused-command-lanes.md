# ADR 006: Retire Goal Mode and Unused Command Lanes

## Status

Accepted on 2026-07-21.

## Context

Goal mode added persistent lifecycle state, automatic continuation, tool
responses, completion evidence, and recurring system instructions to ordinary
OpenCode work. Its token cost is disproportionate to its value: an active goal
repeated the full continuation policy in every model request, and progress
tools returned a growing lifecycle snapshot on every update.

The problem is documented in the open issue tracker:

- https://github.com/Iron-Ham/opencode-config/issues/64
- https://github.com/Iron-Ham/opencode-config/issues/68

Ultra was coupled to Goal mode as its unattended execution profile. The
Advisor, Kimi, and GLM lanes existed only as command-specific agents and are
not needed as managed execution paths.

## Decision

Remove Goal mode, the Ultra execution profile, and the unused Advisor, Kimi,
and GLM command lanes from managed configuration. This removes their plugins,
tools, permissions, TUI, control-plane routes, agents, commands, validation,
and feature-specific tests. Installation migrates existing configurations by
removing managed assets, configuration, providers, and retired routing
overrides.

The installer does not erase historical local Goal state or completion
evidence. The retired configuration no longer loads or consumes that data.

## Future Option

Ultra may return only as a stateless prompt template. It must not create Goal
state, auto-continue, inject a lifecycle policy into ordinary requests, or add
Goal tools, permissions, or persistent workflow artifacts. A proposal to add
such a template requires a separate ADR and focused token-cost validation.
