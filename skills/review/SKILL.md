---
name: review
description: >
  Review code changes with Baz indexed search — a diff-scoped code review that
  checks the change against the rest of the org's repos, not just the files in
  front of it. Use when asked to review changes, review a diff or branch,
  review a pull request, check changes for bugs or security issues, or find
  what is wrong with the current changes before pushing. Invoke with
  /baz:review; supports committed / uncommitted / --base / --pr scopes and an
  optional --fix loop that applies the fixes it finds.
argument-hint: "[committed|uncommitted] [--base <branch>] [--pr <number|url>] [--include-untracked] [--fix]"
license: MIT
---

# Review with Baz

Review a set of changes and report what is actually wrong with them. `$ARGUMENTS` carries the scope flags (all optional).

What makes this review different from reading the diff yourself: **Baz's indexed search lets you check the change against code that isn't in this checkout.** A signature change that looks safe here can break a caller in another repo. Finding that is the point of this command — see Step 3.

Reviewing is **read-only**. Do not edit files, amend commits, or push. The one exception is the `--fix` loop in Step 6, which runs only after the user approves specific findings.

## Step 1: Resolve the scope

Parse `$ARGUMENTS`, then build the diff.

**Resolve the base branch first**, and confirm the ref actually resolves before you diff against it — `--base <branch>` overrides all of this. Walk the ladder in order, taking the first that resolves under `git rev-parse --verify`:

1. `git symbolic-ref refs/remotes/origin/HEAD` — the remote's declared default. Commonly absent in a fresh or CI clone; that is expected, fall through.
2. `origin/main`, then `origin/master`.
3. `main`, then `master` (local branches, for a repo with no remote).
4. **Nothing resolved** — you are most likely in a shallow or `--single-branch` clone, where the base branch simply isn't in the object store. Do not diff against `HEAD~1` and hope. Run `git fetch --depth=100 origin <branch>` to pull the base in, or ask the user which base to use. Say which one you did.

Never assume `main` exists because the repo looks like it should have one — `rev-parse --verify` it. Diffing against a ref that doesn't resolve produces a git error mid-review; diffing against the *wrong* ref silently reviews the wrong changes, which is worse.

| Argument | What to review | How to get it |
|---|---|---|
| *(none)* | Everything not yet on the base branch — commits on this branch **plus** uncommitted tracked edits | `git diff $(git merge-base <base> HEAD)` |
| `committed` | Only commits on this branch | `git diff <base>...HEAD` |
| `uncommitted` | Only staged + unstaged edits to tracked files | `git diff HEAD` |
| `--include-untracked` | Adds new files git isn't tracking yet | `git ls-files --others --exclude-standard`, then read each |
| `--pr <number\|url>` | An open pull request | `gh pr diff <n>` (or `glab mr diff <n>`) |

### When flags conflict

Scope flags can contradict each other, and guessing wrong means reviewing a different diff than the user asked for. Resolve combinations by this ladder, top rule first:

1. **`--pr` is exclusive.** Combined with `committed`, `uncommitted`, `--include-untracked`, or `--base`, **stop and ask which they meant.** Do not guess — a PR's diff against its own base and the local branch's diff can differ substantially, and silently picking one produces a confident review of the wrong changes.
2. **`committed` + `uncommitted` together == the default scope**, since the default is exactly their union (merge-base → working tree). Proceed, and say that's how you read it.
3. **`--include-untracked` + `committed` is contradictory** — a committed range cannot contain untracked files. Stop and ask.
4. **`--include-untracked`** is additive to the default and to `uncommitted`. Valid, no conflict.
5. **`--base` is inert with `uncommitted`**, which diffs against `HEAD` and never consults a base. Honour the `uncommitted` scope and say the `--base` value had no effect — don't drop it silently.
6. **`--fix` is orthogonal** and combines with every scope.

Never silently ignore a flag the user typed. Anything refused or inert must appear in the scope line below.

Notes:

- `--pr` needs `gh`/`glab` on PATH and authenticated. If it isn't, say so and offer the branch-based scopes instead — don't fall back silently to a different diff than the user asked for.
- Get the file list with `--name-status` first, then pull the diff. If the diff is very large, review it in file batches rather than truncating — a truncated diff produces a review that silently skips files, which is worse than a slower one.
- **Empty diff is a result, not an error.** Report that the scope is empty and name the scope you resolved (base branch, commit range) so the user can correct it.

State the resolved scope in one line before reviewing — the scope mode you settled on, base branch, number of files, number of commits, **plus any flag you refused or treated as inert and why** — so the user can see immediately if you're looking at the wrong thing.

## Step 2: Understand the change before judging it

Read the changed files around the hunks. A diff hides the calling context, the early return above it, the lock that's already held. Most false findings come from reviewing hunks in isolation.

Do not report anything until you can name the concrete conditions that trigger it.

## Step 3: Check the change against the rest of the org — the Baz step

**Load and follow the `baz-codebase-exploration` skill** (Skill tool on Claude Code; already an always-on rule on Cursor). It owns tool routing, the search budget, and the verify-before-you-assert rule; everything below is what to point those tools at during a review. As there, all searching goes through Baz — `repo_search`, `remote_grep`, `remote_file_search` — never a shell walk of another repo.

Pass the session-correlation arguments on every Baz call — `sessionId`, `sessionRepository`, and `agentVendor`, exactly as the SessionStart context gave them to you. **Pass whichever of the three that context actually supplied.** The hook omits `sessionRepository` when the cwd has no resolvable `origin` remote, and `agentVendor` when the harness didn't supply one; the values are not yours to invent, so don't substitute a guess from the folder name. A missing value costs session correlation in baz's timeline — it does **not** invalidate the search results, so it is never a reason to skip the cross-repo checks or to downgrade the review's coverage. Coverage is gated on the checks not running (below), not on telemetry fields.

### Baz is required — confirm it before reviewing

This step is not optional garnish. Before running the checks, confirm the Baz tools are actually callable: `mcp__baz__repo_search` and friends present in your tool list, and your first call not failing with an auth error. **If they are missing or unauthenticated, you must not quietly fall back to a local-only review** — that produces a review that looks complete while skipping the only checks that can see other repos.

When Baz is unavailable, first decide whether the diff has an **outward-facing surface**: a changed or removed exported signature, an altered response/request shape, a renamed event or topic, a schema or DB column change, a new or removed public export, an enum or dispatch set another repo may switch on, a changed config or API contract.

- **Outward-facing surface → stop and say so. Do not issue a merge verdict.** Lead your response with it: Baz is not connected, so cross-repo checks did not run; name the specific symbols whose consumers you could not check. Tell the user how to fix it (first Baz tool call opens the OAuth flow; `/mcp` on Claude Code shows connection state) and offer to re-run. If they want the local-only review anyway, give it — clearly labelled **incomplete**, with no safe-to-merge claim.
- **No outward-facing surface** (formatting, a private helper, a test-only edit) → proceed with the local review and note in one line that Baz was unavailable but no cross-repo checks were applicable. Here the review is genuinely complete.

The same rule applies if Baz is connected but you exhaust the search budget before finishing check 1: say which symbols went unchecked rather than implying full coverage.

Run these checks in priority order, and stop when the search budget (10 calls) is spent:

1. **Broken consumers across repos.** For every symbol the diff changes in an outward-facing way — a changed or removed function signature, an altered response shape or field name, a renamed event/topic, a modified DB column, a bumped API version, a deleted export — `remote_grep` the identifier across the org and read the hits. A call site that still passes the old shape is a **blocking** finding, and it is one this review is uniquely able to find. Say which repo and file it lives in.
2. **Both sides of a contract.** If the change touches one end of a request/response, event payload, or schema, verify the other end handles it — even when the other end is a repo the user hasn't cloned. Do not assume it was updated in a sibling PR; check, and if you genuinely can't tell, say so explicitly rather than staying silent.
3. **Diverging from an existing peer.** If the change adds another case to an existing set — another enum value, another handler, another provider, another route — grep an existing peer's identifier once. Its hits enumerate every place the set is registered: the enum, factory maps, switch arms, dispatch tables, route tables, config, and the peer's tests. **Every registration site the new case is missing from is a finding.** This is the single most common real defect in "add one more X" changes.
4. **Reinventing something that exists.** If the change hand-rolls a retry, a validator, a date parser, or a client the org already has, one `repo_search`/`remote_grep` will surface it. Report it only when the existing helper is a genuine drop-in — a speculative "maybe there's a util for this" is noise.

If the diff is purely local (formatting, a private helper, a test-only edit) with no outward-facing surface, skip this step and say you skipped it. Burning ten searches on a rename that touches nothing is worse than not searching.

## Step 4: Review the change itself

Alongside the cross-repo checks, look for:

- **Correctness** — logic that produces the wrong result, off-by-one, inverted conditions, unhandled `null`/empty/error returns, wrong operator precedence.
- **Concurrency & state** — race conditions, non-atomic read-modify-write, missing idempotency on retryable handlers, shared mutable state.
- **Security** — injection (SQL, shell, path), missing authn/authz on a new endpoint, unverified webhook signatures, secrets or tokens in code/logs, unsafe deserialization, user input reaching a sink unvalidated.
- **Failure handling** — swallowed exceptions, unbounded retries, missing timeouts, partial writes with no rollback.
- **Regressions** — behavior the change removes or alters that existing callers or tests depend on.
- **Tests** — new branching logic with no test covering it; an existing test whose assertion the change invalidates.

**What not to report.** Style, formatting, naming preferences, and speculative "consider extracting this" refactors are noise unless they cause a defect. Do not report pre-existing problems the diff didn't introduce or touch. Do not report something you could not verify by reading the source — verify or drop it.

## Step 5: Report

Group findings by severity, most severe first. Every finding needs a `file:line`, the concrete conditions under which it fails, and a fix. Cross-repo findings name the other repo.

```markdown
## Review — <scope, base branch, N files>

### Blocking
1. **<one-line claim>** — `<repo?> · <path>:<line>`
   Fails when: <concrete inputs or state → wrong result, crash, or breach>
   Fix: <what to change>

### Should fix
...

### Consider
...

## Coverage
Cross-repo checks: <ran, and which repos searched clean | NOT RUN — Baz unavailable | partial — budget exhausted, <symbols> unchecked>

## Summary
<N blocking, N should-fix, N consider.> <One line: is this safe to merge?>
```

Emit every heading in order; write `_None._` under any that are empty. If there is nothing to report, say the change looks correct and name what you checked — including which repos you searched and found clean. A clean review that lists its coverage is useful; a bare "LGTM" isn't.

**Never state or imply a change is safe to merge when the cross-repo checks did not run and the diff has an outward-facing surface.** That is the one claim this review cannot make on local information alone — the whole point of Step 3 is that a signature change looks fine in this repo right up until it breaks a caller in another one. Say "no issues found in this repo, cross-repo consumers unchecked" and leave the merge decision to the user.

## Step 6: Fix (only with `--fix`, or when the user asks)

Turn the findings into a task list — one task per finding, blocking first — and show it before touching anything. Then work through it:

- Fix one finding per edit, in the repo that's checked out. Report findings in other repos; don't try to edit code you don't have.
- After each fix, re-read the changed region to confirm the fix actually lands and doesn't break a neighbouring path.
- Run the project's tests and linter if the repo has them. Report failures with the output — never claim green without running them.
- Skip anything ambiguous, architectural, or wider than the finding, and say why. Ask rather than guess.

Finish with what was fixed, what was skipped and why, and what still needs a human.
