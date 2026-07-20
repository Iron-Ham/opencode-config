---
description: Ask the configured advisor model for an isolated, read-only review of explicitly supplied context.
agent: advisor_reviewer
subtask: true
---

Independently review the following developer-supplied question, decision, or risk:

$ARGUMENTS

Only this command prompt and its arguments are supplied from the parent session. Use this compact brief format:

```text
Source boundary: exact files, diff, or evidence bundle to inspect
Question: one concrete decision or risk
Required evidence: the claim or acceptance condition to assess
Exclusions: unrelated files, implementation, or unsupported inference
```

If the source boundary or question is missing, return `unverified`. Inspect the current workspace read-only when needed, then return concise evidence, the most material concern or an explicit clean verdict, and the decisive next verification. Do not implement changes.
