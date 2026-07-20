# Context-efficient OpenCode tools

These are first-party candidate replacements for OpenCode's `glob` and `grep`
tools. They are installed outside the active `tools/` directory so normal
sessions continue using OpenCode's native tools.

## Candidate behavior

- `glob` uses ripgrep's ignore handling, limits results to 50, and sorts by
  modification time with a path tie-breaker.
- `grep` emits file, line, column, and source text for at most 50 matches.
- `ast_grep` is an additive structural-search candidate. It requires an
  explicit ast-grep language and pattern. Use it for structural syntax queries;
  use `grep` for lexical discovery.

Each truncation reports how to narrow or continue the request. The candidates
never use a shell, network fallback, or downloaded executable.

## Evaluation boundary

Enable `glob.ts` and `grep.ts` only in an isolated benchmark profile by copying
them into that profile's `tools/` directory, with
`../context-tools-lib/runtime.ts` alongside them. Native `read` remains active
to preserve image and PDF attachments.

Public tests use synthetic fixtures only. When evaluating a non-public
repository, keep every task, transcript, event stream, tool result, path,
symbol, revision identifier, and metric outside this repository and any other
public repository. Do not publish private-derived counts or aggregate results
without explicit review.

Candidate promotion requires a paired native-versus-candidate evaluation with
the same model, frozen worktree, task, permissions, and randomized arm order.
The evidence must separately show lower model input tokens and non-inferior
completion, validation, and blind quality. The benchmark runner requires a
task-specific `--validation-command`; it receives the private final response
at `$OPENCODE_BENCHMARK_ANSWER_PATH` and must fail on an incorrect result.
