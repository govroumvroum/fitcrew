---
name: pr
description: Open a pull request on fitcrew with screenshots, then drive the fouine-review loop to green. Use when opening a PR, pushing a branch for review, asking "what does fouine say", answering review comments, or fixing findings from an AI review. Covers screenshot capture at 390x844, hosting them so GitHub renders them, waiting for fouine-review, replying to its comments, and pushing fixes that trigger a re-review.
---

# PR handling

`main` is protected by a ruleset: PR required, squash-only, no force-push. Everything lands through a PR.

## 1. Before opening

- Branch name is `<your-github-handle>/<lowercase-hyphenated>`; the issue is already assigned (`gh issue edit <n> --add-assignee @me`).
- `bun run build` green. `bunx tsc --noEmit` and `bunx oxlint` passing is not enough — the build is the bar.
- Run the `*.check.ts` self-checks touched by the change.

## 2. Screenshots (required for any UI change)

Skip only for backend-only diffs (convex functions, config, deps) — say so in the PR body when you skip.

Capture at fitcrew's target viewport, **390x844**:

1. `bun dev` in the background, wait for `localhost:3000`.
2. chrome-devtools MCP: `new_page` → `resize_page` to 390x844 → navigate → `take_screenshot` (`filePath` into `$CLAUDE_JOB_DIR/tmp` or `/tmp`).
3. One shot per screen the diff changes. Before/after only when the change is a redesign of something that already existed — otherwise after is enough.

Host them on the `pr-media` orphan branch (never merged, so PNGs stay out of `main`'s history):

```sh
# first time only
git switch --orphan pr-media && git commit --allow-empty -m "pr media" && git push -u origin pr-media

# per PR — from a temp worktree so the working branch is untouched
git worktree add /tmp/pr-media pr-media
mkdir -p /tmp/pr-media/<branch-slug> && cp shot.png /tmp/pr-media/<branch-slug>/
git -C /tmp/pr-media add -A && git -C /tmp/pr-media commit -m "shots: <branch-slug>" && git -C /tmp/pr-media push
git worktree remove /tmp/pr-media
```

Reference in the body:

```md
<img src="https://raw.githubusercontent.com/govroumvroum/fitcrew/pr-media/<branch-slug>/shot.png" width="320" />
```

`width="320"` — raw 390px-wide images at full size make the PR body unreadable.

## 3. Body

What changed and why, in the shape fouine can check against the diff (it calls out an inaccurate description). Screenshots under a `## Écrans` heading. `gh pr create --fill` then edit, or `--body-file`.

## 4. The fouine-review loop

`fouine-review` is a GitHub App that reviews automatically on push. There are no CI checks on this repo — fouine is the gate. It re-reviews the same SHA if nothing was pushed, and it says so, so **key on the head SHA, not on review count**.

Wait for it — run this in the background (a foreground `sleep` is blocked), 30 attempts of 30s, then give up and tell the author rather than hanging:

```sh
SHA=$(git rev-parse HEAD)
for _ in $(seq 1 30); do
  n=$(gh pr view <n> --json reviews --jq \
    "[.reviews[]|select(.author.login==\"fouine-review\" and .commit.oid==\"$SHA\")]|length")
  [ "$n" != 0 ] && break
  sleep 30
done
[ "$n" = 0 ] && echo "no fouine review on $SHA after 15 min"
gh pr view <n> --json reviews --jq '.reviews[-1].body'
gh api repos/govroumvroum/fitcrew/pulls/<n>/comments --jq '.[]|{id,path,line,body}'
```

**Verify each finding against the code before acting on it.** Fouine runs on a
mid-tier model picked for price/performance — it hallucinates. It cites lines
that don't exist, claims a function is unused when a caller is two files over,
and misreads control flow. Open the file it names, confirm the claim is true at
that line, and only then decide. A finding is a hypothesis, not a defect report.

Then triage every finding. The review footer counts them (`Blocking: 0 · Nits: 3 · Questions: 0`).

- **Blocking** → fix. Non-negotiable.
- **Nit** → fix if the fix is smaller than the argument. Duplication findings almost always are.
- **Question** → answer it in a reply; don't change code to preempt a question.
- **Wrong or hallucinated** → reply with the evidence (the actual line, the caller it missed) and change nothing. Never edit correct code to make the review quiet — that's how a hallucination becomes a real bug.

While you're in there: if a finding names a class of problem, grep for the rest of that class in the diff and fix those too. Fouine notices when you do, and it's a smaller total diff than three rounds of the same nit.

Reply to each inline comment, one reply per comment:

```sh
gh api repos/govroumvroum/fitcrew/pulls/<n>/comments/<comment-id>/replies -f body='...'
```

Then one summary comment stating what was fixed and in which commit — a table of `finding | fix` reads best. Push the fix as a **new commit** (no amend, no force-push: the ruleset blocks force-push on `main` only, but fouine diffs against the SHA it reviewed).

Pushing triggers a new review → back to the top of this section. Cap at **3 rounds**; if round 3 still has blocking findings, stop and bring it to the author instead of looping.

Done when fouine is `APPROVED`, or when the only open findings are nits you deliberately declined and replied to.

## 5. Merge

Squash only (the ruleset allows nothing else). `gh pr merge <n> --squash --delete-branch` once approved — ask the author first unless they already said to merge.
