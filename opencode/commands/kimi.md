---
description: Run an explicit, read-only Kimi K2.7 Code experiment on Baseten.
agent: kimi_reader
model: baseten/moonshotai/Kimi-K2.7-Code
subtask: true
---

Investigate this exact developer-supplied question with the experimental Kimi K2.7 Code reader on Baseten:

$ARGUMENTS

Only the command and its arguments are supplied as task context. Use this compact brief format:

```text
Source boundary: exact files or directories to inspect
Question: one concrete question
Required evidence: facts, references, or checks the answer must include
Exclusions: files, behaviors, or speculation to avoid
```

If the source boundary or question is missing, return `unverified`. Stay read-only, follow applicable repository instructions, cite direct source evidence, and distinguish verified facts from unresolved runtime behavior. This is an explicit model experiment, not a default routing path.
