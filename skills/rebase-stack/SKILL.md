---
name: rebase-stack
description: Rebase an entire stack of PRs against the latest base branch, cascading changes through every branch using git rebase --onto
argument-hint: "[PR# or branch] [--base <branch>] [--dry-run]"
allowed-tools: Bash, Read, AskUserQuestion
---

# Rebase a Stack of PRs

You are executing the `/rebase-stack` skill. Your job is to discover a stack of PRs,
rebase the **entire** stack against the latest base branch, and cascade changes through
every branch using `git rebase --onto`.

**CRITICAL RULES — read before doing anything:**

1. **NEVER use `git rebase --skip`.** It drops commits and loses work. If a conflict
   occurs, resolve it and use `git rebase --continue`.
2. **ALWAYS use `git rebase --onto`** for reparenting branches. This is the only correct
   operation for moving a branch from one base to another.
3. **ALWAYS rebase the ENTIRE stack from the bottom**, even if only one branch in the
   middle changed. This ensures the whole stack is current with the latest base.
4. **Compute each branch's upstream (`<old-base>`) BEFORE starting any rebase.** Once
   you start, branch refs shift and the old values are gone from the refs (though the
   commit objects still exist in the graph).

---

## Phase 0 — Parse Arguments

The skill runner populates `$ARGUMENTS` with everything after `/rebase-stack`.

Extract:

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `PR#` or `branch-name` | No | Current branch | Identifies which stack to rebase |
| `--base <branch>` | No | Auto-detect `main`/`master` | Base branch to rebase onto |
| `--dry-run` | No | Off | Show plan without executing |

Examples:
- `/rebase-stack` — discover stack from current branch
- `/rebase-stack 42` — discover stack containing PR #42
- `/rebase-stack Iron-Ham/auth-2-routes` — stack containing this branch
- `/rebase-stack --base develop` — use `develop` as base
- `/rebase-stack --dry-run` — plan only, no changes

---

## Phase 1 — Pre-flight Checks

Run in order. Abort with a clear message on failure.

```bash
# 1. Verify git repo
git rev-parse --git-dir

# 2. Clean worktree
git diff --quiet && git diff --cached --quiet
# → "Working tree has uncommitted changes. Commit or stash them first."

# 3. No rebase already in progress
test ! -d "$(git rev-parse --git-dir)/rebase-merge" && \
test ! -d "$(git rev-parse --git-dir)/rebase-apply"
# → "A rebase is already in progress. Complete or abort it first."

# 4. Current branch
ORIGINAL_BRANCH=$(git symbolic-ref --short HEAD)

# 5. Detect base branch (if not provided)
BASE_BRANCH=${provided_base:-$(git branch -r | rg -oE 'origin/(main|master)' | head -1 | sed 's|origin/||')}
# → "Could not detect base branch. Use --base <branch>."

# 6. gh CLI available + authenticated
command -v gh >/dev/null || abort "gh CLI is required for stack discovery."
gh auth status 2>/dev/null || abort "gh CLI is not authenticated. Run: gh auth login"
```

Print summary:

```
Branch: $ORIGINAL_BRANCH
Base:   $BASE_BRANCH
```

---

## Phase 2 — Discover the Stack

### 2a. Fetch all open PRs

```bash
gh pr list --state open --json number,headRefName,baseRefName,title,url --limit 200
```

### 2b. Build the stack graph

From the PR list build a mapping of `baseRefName → [{ number, headRefName, title, url }]`.

**Determine the target branch:**
1. If a PR number was given → use that PR's `headRefName`.
2. If a branch name was given → use it directly.
3. Otherwise → use `$ORIGINAL_BRANCH`.

**Walk the stack:**
1. **Walk UP** from the target: follow each PR's `baseRefName` until you reach `$BASE_BRANCH`. This gives the path from root to target.
2. **Walk DOWN** from the target: follow `headRefName → find PR whose baseRefName matches` to find all descendants.
3. Combine into a single ordered list `[branch_1, branch_2, …, branch_N]` where `branch_1`'s base is `$BASE_BRANCH`.

**Edge cases:**
- Target not in any open PR → "Branch `$TARGET` is not associated with any open PR. Is it pushed?"
- Fork/diamond (a branch has multiple children PRs) → show the ambiguity and ask which path to take.
- PR in the middle is already merged → note it, exclude it from rebasing, and treat its merge target as the new base for the branches above it.
- Target branch IS the base branch → "You're on the base branch. Switch to a stack branch or specify one."

### 2c. Display the stack

```
## Discovered Stack (N branches)

| # | Branch                      | PR   | Title              | Base                        |
|---|-----------------------------|------|--------------------|-----------------------------|
| 1 | Iron-Ham/auth-1-models      | #42  | Add auth models    | main                        |
| 2 | Iron-Ham/auth-2-routes      | #43  | Add auth routes    | Iron-Ham/auth-1-models      |
| 3 | Iron-Ham/auth-3-middleware   | #44  | Add auth middleware| Iron-Ham/auth-2-routes      |
```

---

## Phase 3 — Record State & Plan

### 3a. Fetch latest remote

```bash
git fetch origin
```

### 3b. Ensure branches exist locally

For each branch in the stack that doesn't exist locally:

```bash
git checkout --track "origin/$BRANCH" && git checkout "$ORIGINAL_BRANCH"
```

### 3c. Record old state

For **every** branch in the stack, record its current SHA before any rebase:

```bash
OLD_SHA_1=$(git rev-parse "$BRANCH_1")
OLD_SHA_2=$(git rev-parse "$BRANCH_2")
# … for all N branches
```

### 3d. Compute upstream (old-base) for each branch

The upstream is the `<old-base>` argument to `git rebase --onto`. Getting this wrong
is the #1 source of broken stack rebases.

**First branch** (parent is `$BASE_BRANCH`):
```bash
UPSTREAM_1=$(git merge-base "origin/$BASE_BRANCH" "$BRANCH_1")
```

**Subsequent branches** — two strategies depending on commit count:

**Strategy A — Single-commit branches (preferred):**
Each branch has exactly one commit on top of its parent. The upstream is simply:
```bash
UPSTREAM_K=$(git rev-parse "$BRANCH_K~1")
```
This works even when the parent was amended, because the child's commit still
literally points at the old parent commit in the DAG.

**Strategy B — Multi-commit branches (fallback):**
If a branch has more than one commit, `~1` only peels one commit. Instead:
```bash
# If the local parent tip is an ancestor of the child, count is reliable:
if git merge-base --is-ancestor "$BRANCH_{K-1}" "$BRANCH_K"; then
    UPSTREAM_K=$(git rev-parse "$BRANCH_{K-1}")
else
    # Parent was amended — local parent tip diverged from what's in the child's history.
    # Fall back to the remote's pre-amendment state:
    UPSTREAM_K=$(git merge-base "origin/$BRANCH_{K-1}" "$BRANCH_K")
fi
```
If neither strategy produces a sane result, ask the user.

**To detect which strategy to use**, check the commit count:
```bash
COUNT=$(git rev-list --count "$UPSTREAM_K".."$BRANCH_K")
# If COUNT == 1 → single-commit, strategy A already correct
# If COUNT >  1 → multi-commit, verify with strategy B
# If COUNT == 0 → something is wrong, ask user
```

### 3e. Show the rebase plan

```
## Rebase Plan

Rebasing onto: origin/$BASE_BRANCH ($BASE_SHA)

| # | Branch    | Current SHA | Upstream (old-base) | Commits | Action                         |
|---|-----------|-------------|---------------------|---------|--------------------------------|
| 1 | branch-1  | abc1234     | def5678             | 1       | rebase --onto origin/main      |
| 2 | branch-2  | bcd2345     | abc1234             | 1       | rebase --onto branch-1         |
| 3 | branch-3  | cde3456     | bcd2345             | 1       | rebase --onto branch-2         |
```

Flag any branches where the local SHA differs from `origin/<branch>` (indicates local amendments not yet pushed).

### 3f. Ask for approval

**STOP HERE. You MUST wait for user input.**

> Does this rebase plan look correct?
> - **Approve** — execute the rebase cascade
> - **Adjust** — tell me what to change
> - **Cancel** — abort, no changes made

If `--dry-run` was passed, stop here after showing the plan.

---

## Phase 4 — Execute Rebase Cascade

Process each branch **in order from bottom to top**. Never parallelize — each
rebase depends on the previous one completing.

### First branch:

```bash
git rebase --onto "origin/$BASE_BRANCH" "$UPSTREAM_1" "$BRANCH_1"
```

### Subsequent branches:

```bash
git rebase --onto "$BRANCH_{K-1}" "$UPSTREAM_K" "$BRANCH_K"
```

**After each successful rebase**, print a brief confirmation:

```bash
echo "Branch $K/$N done: $BRANCH_K"
git log --oneline -1 "$BRANCH_K"
```

### Handling conflicts

When `git rebase` exits non-zero and a rebase is in progress:

1. **Show the conflict:**
   ```bash
   git status --short
   git diff --name-only --diff-filter=U   # conflicting files
   ```

2. **For each conflicting file**, show the conflict regions:
   ```bash
   git diff "$FILE"
   ```

3. **Ask the user:**
   > Conflict while rebasing `$BRANCH_K`.
   > Conflicting files: `file1.ts`, `file2.ts`
   >
   > - **Help me resolve** — I'll attempt to resolve the conflicts
   > - **I'll resolve manually** — you fix them, then tell me to continue
   > - **Abort** — abort this rebase and stop

4. **After resolution:**
   ```bash
   git add <resolved-files>
   git rebase --continue
   ```
   If another conflict appears in the same branch, repeat.

5. **If user aborts:**
   ```bash
   git rebase --abort
   ```
   Print which branches were rebased successfully vs. still on old bases.
   Print commands to force-push the ones that succeeded.

### NEVER use --skip

If at any point you are considering `git rebase --skip`: **STOP.** This drops the
current commit's changes entirely. The correct actions during a conflict are:

- Resolve + `git rebase --continue`
- Or `git rebase --abort` (undoes the entire rebase for this branch)

There is no scenario in a stack rebase where `--skip` is appropriate.

---

## Phase 5 — Force Push

### 5a. Show what will be pushed

```
## Branches to push

| # | Branch    | Old SHA  | New SHA  | Changed? |
|---|-----------|----------|----------|----------|
| 1 | branch-1  | abc1234  | xyz9876  | Yes      |
| 2 | branch-2  | bcd2345  | yza8765  | Yes      |
```

### 5b. Confirm with user

> Ready to force-push N branches with `--force-with-lease`. Proceed?

### 5c. Push each branch

```bash
git push --force-with-lease origin "$BRANCH_1"
git push --force-with-lease origin "$BRANCH_2"
# …
```

If a push fails due to `--force-with-lease` rejection (someone else pushed to that
branch), warn the user and **do NOT** retry with bare `--force`. Ask what to do.

Report status after each push so the user sees progress for large stacks.

---

## Phase 6 — Summary

```
## Rebase Stack Complete

Rebased N branches onto latest origin/$BASE_BRANCH ($BASE_SHA):

| # | Branch    | PR   | Old SHA  | New SHA  | Push   |
|---|-----------|------|----------|----------|--------|
| 1 | branch-1  | #42  | abc1234  | xyz9876  | Pushed |
| 2 | branch-2  | #43  | bcd2345  | yza8765  | Pushed |
| … | …         | …    | …        | …        | …      |
```

Return to the branch the user was on when the skill started:

```bash
git checkout "$ORIGINAL_BRANCH"
```

---

## Why --onto and never --skip

Understanding the difference is critical. Here's a reference:

**`git rebase --onto <newbase> <upstream> <branch>`**
> Take the commits that are on `<branch>` but NOT reachable from `<upstream>`,
> and replay them onto `<newbase>`.

This is a **reparenting** operation. It moves a branch's commits from one base to
another. It is the correct tool for stack rebasing.

**`git rebase --skip`**
> During an in-progress rebase that stopped for a conflict, discard the current
> commit entirely and move on to the next one.

This **destroys work**. The skipped commit's changes are permanently lost from the
branch. It exists for the rare case where a commit is truly redundant (e.g., already
applied upstream via cherry-pick). In a stack rebase, every commit matters — never skip.

---

## Reminders

- **Entire stack, every time.** Even if only branch 5 changed, rebase 1 through N.
  The user wants the whole stack current with the latest base.
- **Record state first.** Capture all SHAs and compute all upstreams before the first
  `git rebase` command.
- **Single-commit branches:** `branch~1` is always the correct upstream. It resolves
  to the literal parent commit, which is the old parent tip even if that parent was
  amended.
- **Multi-commit branches:** Use `merge-base` or remote state as fallback. Verify
  with the user if uncertain.
- **Conflicts are normal.** Show them clearly, help resolve, use `--continue`. Never
  `--skip`, never silently drop changes.
- **`--force-with-lease`**, never bare `--force`. Respect concurrent pushes.
- **Return to the original branch** when done.
