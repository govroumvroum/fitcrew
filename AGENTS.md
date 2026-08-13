<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

# GitHub issues

When creating or rewriting a GitHub issue, read `.agents/skills/issue/SKILL.md` first. It defines the research process and the quality bar for decision-ready issues, and should be used with the templates in `.github/ISSUE_TEMPLATE/`.

# Migrations

Data migrations live in `convex/migrations.ts`, built with `@convex-dev/migrations`.
The production deploy runs `migrations:runAll` right after `convex deploy` (see
`buildCommand` in `vercel.json`), so nothing has to be run by hand. A new
migration is a `migrations.define(...)` plus one line in the `runAll` array —
don't chain another command onto the deploy. Already-completed migrations are
skipped, so the list just grows.

# Never delete a Convex function in the PR that stops calling it

`convex deploy` runs before the frontend build, and a phone that had the app
open keeps running the previous bundle for as long as its tab lives — a PWA tab
lives forever. So the moment a function disappears, every already-loaded client
calling it starts throwing `Could not find public function`. That's how removing
`programs:current` alongside its callers took the dashboard and `/programme`
down in production.

Two deploys, always: one that moves the callers off the old function, a later
one that deletes it. Same expand/contract the schema already does — `lineageId`
and `status` are `v.optional` for exactly this reason, read as `?? _id` and
`?? "active"` so rows written by the previous version still work.

Renaming or changing an argument counts as deleting. So does tightening a
validator: old clients send the old shape.

# Signing in to the local app (agents)

Every route is behind Clerk and the dev instance signs in with Google OAuth, so a
browser run stops dead on the sign-in screen. Don't improvise around it — mint a
Clerk Agent Task URL, which signs you in when opened:

```sh
bun run agent-login -- --browser   # signs the agent-browser session "fitcrew" in, end to end
```

Then drive `agent-browser --session-name fitcrew` as usual. The session name makes
`agent-browser` persist cookies, so run this only when the saved session has lapsed.
`--browser <name>` targets a different session name.

Do **not** try `agent-browser open <task-url>` instead: Chrome silently drops
Clerk's handshake cookies on `http://localhost` (they're `SameSite=None` without
`Secure`), and the page loops back to signed-out. `--browser` consumes the ticket
inside the script with a SameSite-blind HTTP client and imports the resulting
cookies into the browser as `SameSite=Lax`, which Chrome keeps. The script
verifies the page reports a signed-in user before exiting 0, and revokes the task.

- Without `--browser` the script prints the task URL on stdout — that URL is a
  **live credential**. Never paste it into a transcript, a log, a commit, or a PR
  comment, and never write it to a file. Everything on stderr is safe to read;
  stdout is not. (With `--browser`, nothing secret is printed at all.)
- Revoke an unconsumed URL when you're done: `bun run agent-login -- --revoke
  <agentTaskId>` (stderr prints the id and the exact command). `--browser`
  revokes its own task automatically.
- Never `cat .env.local` or echo any part of `CLERK_SECRET_KEY`. The script reads
  it from the environment, and refuses to run unless it's an `sk_test_` dev key —
  minting against production is not a thing we do.
- The port is detected by probing for a running `next dev` (3000–3005), because
  the dev server does land on 3001 when something else holds 3000. Override with
  `--port 3007` or `PORT=3007` if it listens elsewhere.
- Set `AGENT_LOGIN_IDENTIFIER` to **your own** account's email on the Clerk dev
  instance, in your `.env.local` (which is per-developer and never committed), or
  pass `--identifier <email>`. There is no shared default on purpose: the session
  is minted as whoever you name, so name yourself and you get your own data.
  Sessions last 2 h, long enough for a screenshot run.
- **Stale saved session:** if a page shows the sign-in screen (or redirects to
  `/sign-in`) even though `--session-name fitcrew` is set, the saved session has
  lapsed. Run `bun run agent-login -- --browser` again — don't debug the "not
  signed in" screen.
- Agent Tasks are beta at Clerk, so keep this out of CI for now.

Self-check: `bun scripts/agent-login.check.ts`.

# Pull requests

`main` is protected: PR required, squash-only, no force-push. Read
`.agents/skills/pr/SKILL.md` before opening a PR — it covers the screenshots a
UI PR must carry and the `fouine-review` loop you're expected to drive to green.

# Exercising the app for real

`.agents/skills/qa/SKILL.md` — how to get a signed-in browser, drive the feature
until it actually works, and read a claim out of the DOM instead of squinting at a
screenshot. Read it before writing "verified" about anything on screen, and when a
PR needs its `## Écrans`.

Exercise the feature, don't inspect it. A new agent tool isn't verified because it
compiles — open the chat, get the agent to call it, watch the card render, then
reload and check the write stuck. `renderTool` switches on a string, so a
misspelled tool name builds green and silently renders nothing.
