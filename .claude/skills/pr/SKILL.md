---
name: pr
description: Open a pull request on fitcrew with screenshots, then drive the fouine-review loop to green. Use when opening a PR, pushing a branch for review, asking "what does fouine say", answering review comments, or fixing findings from fouine's review.
---

# PR handling — fitcrew

Per-repo settings for the global `github-pr` skill. Read `~/.agents/skills/github-pr/SKILL.md` and run its procedure with these values:

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
