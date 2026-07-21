# Context-efficient OpenCode tools

These are first-party context-efficient OpenCode tools. The managed installer
copies them into the active `tools/` directory.

## Tool behavior

- `glob` uses ripgrep's ignore handling, limits results to 50, and sorts by
  modification time with a path tie-breaker.
- `grep` emits file, line, column, and source text for at most 50 matches.
- `ast_grep` is an additive structural-search candidate. It requires an
  explicit ast-grep language and pattern. Use it for structural syntax queries;
  use `grep` for lexical discovery.
- `text_read` is an additive text and directory reader. It streams bounded
  output, follows native `read` and `external_directory` permissions, and
  defers images, PDFs, and non-text content to native `read`.

Each truncation reports how to narrow or continue the request. These tools
never use a shell, network fallback, or downloaded executable.

## Evaluation boundary

The benchmark runner copies only selected candidate tools into an isolated
profile. Native `read` remains active in both arms. Benchmark TextRead with
`--candidate-tools text_read --require-candidate-tool-use text_read` so the
candidate arm is invalid when TextRead was never selected.

Public tests use synthetic fixtures only. When evaluating a non-public
repository, keep every task, transcript, event stream, tool result, path,
symbol, revision identifier, and metric outside this repository and any other
public repository. Do not publish private-derived counts or aggregate results
without explicit review.

Candidate promotion requires a paired native-versus-candidate evaluation with
the same model, frozen worktree, task, and permissions. The runner alternates
arm order by repetition. The evidence must separately show lower model input
tokens and non-inferior completion, validation, and blind quality. The benchmark
runner requires a task-specific `--validation-command`; it receives the private
final response at `$OPENCODE_BENCHMARK_ANSWER_PATH` and must fail on an
incorrect result.
