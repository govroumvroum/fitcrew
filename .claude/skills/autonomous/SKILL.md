---
name: autonomous
description: Work unattended on fitcrew while the author is away — ship the current thread or a named task up to a green PR, park what needs them.
disable-model-invocation: true
---

# Unattended — fitcrew

The author is away. Nobody will answer a question for hours, so every question you
would have asked becomes either an assumption you write down or a **park**.

The ceiling is a **green PR**. Never merge, never push to `main`.

## 1. Pick the work

With an argument (`/autonomous 42`, `/autonomous refactor the drawer`): that is
the work. An issue number wins over guessing — `gh issue view <n>` and read it
whole.

Without one: continue the thread we were on. If nothing is in flight and no
backlog was named, say so in one line and stop. Inventing work unattended is how
an author comes back to a diff nobody asked for.

Done when you can name the work in one sentence and, for an issue,
`gh issue edit <n> --add-assignee @me` has run.

## 2. Ship it

Branch `<your-handle>/<kebab-summary>` (`gh api user --jq .login`), commits prefixed `feat:` / `fix:` / `chore:`.

`AGENTS.md` outranks this file — the Next.js docs rule, the Convex guidelines,
the two-deploy rule for removing a function, the migrations list. Reread it
rather than trusting memory; the traps there are exactly the ones nobody is
awake to catch.

Delegate the implementation, keep your context for judgment, and verify the
claims that matter yourself.

Done when `bun run build` is green.

## 3. Prove it

Run the `qa` skill. **Drive** the change through the running app and come back
with the shots `## Écrans` needs.

A green build with no evidence is a step you have not finished.

## 4. Open the PR

Run the `pr` skill and drive fouine to green: read each finding, fix or answer
it, push, wait for the re-review.

State every assumption in the PR body under `## Hypothèses`. An assumption they
find in the diff is a bug; one they read in the body is a decision they can
overrule.

Done when fouine is green and the PR is open. Then back to step 1 if more work
was named.

## Park

A blocker is a thing only the author can settle: an ambiguous spec, a product
decision, a credential you don't have, a failure you have genuinely exhausted.

Park it — do not stop. Leave the work where they can pick it up (pushed branch,
draft PR, or nothing if nothing was worth keeping), then take the next unblocked
thing.

Two failed attempts at the same wall is the signal. A third is stubbornness, and
you have hours to spend better.

## The handoff

Your final message is what they read over coffee. Nothing else survives.

```
Shipped   — one line per PR, with the link
Parked    — one line per blocker: what, why it needs them, where the work sits
Assumed   — decisions you made that they might want back
```

If you shipped nothing, say that first and why, in one line.
