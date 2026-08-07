# Example: fitcrew's `pr` skill

The reference project copy — the file at `.claude/skills/pr/SKILL.md` in the fitcrew repo (fitcrew vendors the `github-pr` skill into `.claude/skills/github-pr/` so teammates don't need a machine-local install):

````markdown
---
name: pr
description: Open a pull request on fitcrew with screenshots, then drive the fouine-review loop to green. Use when opening a PR, pushing a branch for review, asking "what does fouine say", answering review comments, or fixing findings from fouine's review.
---

# PR handling — fitcrew

Per-repo settings for the `github-pr` skill vendored in this repo (`.claude/skills/github-pr/SKILL.md`, symlinked from `.agents/skills/github-pr`) so teammates don't depend on a machine-local install. Read `../github-pr/SKILL.md` and run its procedure with these values:

| Setting | Value |
|---|---|
| owner/repo | govroumvroum/fitcrew |
| frontend | yes |
| target viewport | 390x844 |
| review bot | fouine-review |
| merge style | squash |
| screenshots heading | `## Écrans` |
| build gate | `bun run build` green; `bunx tsc --noEmit` and `bunx oxlint` passing is not enough — the build is the bar. Run the `*.check.ts` self-checks touched by the change. |

`main` is protected by a ruleset: PR required, squash-only, no force-push.
````
