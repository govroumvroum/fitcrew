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

## Screenshots need a signed-in app

Every route is behind Clerk, and the dev instance only offers Google OAuth — the
screenshot run will sit on the sign-in screen forever waiting for a human. Sign in
first, with a Clerk Agent Task:

```sh
bun run dev                          # note nothing: the port is detected
bun run agent-login -- --browser     # signs the agent-browser session "fitcrew" in, end to end
```

Then screenshot with `agent-browser --session-name fitcrew` as usual.
`--session-name fitcrew` persists the session between runs, so run the login only
when the saved one has lapsed. If a page shows the sign-in screen or redirects to
`/sign-in` despite the session name, that's a stale session: run
`bun run agent-login -- --browser` again rather than debugging the screen.

Never `agent-browser open <task-url>` directly — Chrome drops Clerk's handshake
cookies on `http://localhost` and the page ends signed-out. `--browser` consumes
the ticket in-process, imports the cookies, verifies the signed-in state, and
revokes the task itself.

Rules, not suggestions:

- A minted URL (the no-`--browser` mode) is a **live credential**. Never put it in
  a transcript, a log, a commit, or the PR body. Never write it to a file.
- If you minted a URL without `--browser`, revoke after the run:
  `bun run agent-login -- --revoke <agentTaskId>` (the id is on stderr).
- Never read or echo `CLERK_SECRET_KEY`. The script refuses anything but an
  `sk_test_` dev key, so there is nothing to work around.
- Port not 3000? `--port <n>` or `PORT=<n>`. Wrong user? `--identifier <email>` or
  `AGENT_LOGIN_IDENTIFIER`.

Full details in `AGENTS.md` ("Signing in to the local app").

`main` is protected by a ruleset: PR required, squash-only, no force-push.
