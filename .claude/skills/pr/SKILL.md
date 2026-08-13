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

## Changelog entry

`/changelog` is fed by markdown files in the branch, so the entry ships with the
PR that ships the feature — not after.

- **Due** when the crew would notice: a new screen, a new action, a behaviour or
  wording change they can see.
- **Not due** for refactors, dependency bumps, skills, CI, docs, or pure backend
  work with no visible effect. Say so in one line in the PR body ("pas d'entrée
  changelog : refacto") rather than committing an empty file.

One file per entry: `src/content/changelog/AAAA-MM-JJ-slug.md`, dated the day the
PR is opened. First line is `# Titre`, then 2–5 lines of body. Written to a user,
in French, tutoiement — "tu peux maintenant partager ton programme par lien", not
"ajout de `programs:getByShareCode`". No function names, no PR numbers. A file
that doesn't match the naming pattern is silently ignored, so check the name.

## Screenshots need a signed-in app

**Read `../qa/SKILL.md` for the capture itself** — waiting for the app to be
loaded instead of sleeping, hiding the Next.js dev overlay, and reading the claim
out of the DOM rather than trusting the picture. What follows is only the sign-in.

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
