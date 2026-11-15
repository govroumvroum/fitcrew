---
name: driven
description: How to work in a fitcrew worktree that isn't the only one — the shared Convex deployment, the shared browser, the dev port, and the protocol when another agent is driving you. Use when a driver's brief names this skill, when about to run `convex dev` / `convex push` / `bun run dev` / `agent-browser` anywhere other than the main checkout, when told another agent works in parallel, or when a Convex function that exists locally is missing at runtime.
---

# Driven — fitcrew

You are not the only agent in this repo. Two consequences: the backend you push
to may not be yours, and someone may be steering you.

## The backend is shared

`.worktreeinclude` copies `.env.local` into every worktree so the app can run
there. That copies `CONVEX_DEPLOYMENT` too, so **every worktree points at the same
dev deployment by default**.

A Convex push replaces the whole schema and function set. So two agents pushing
from two worktrees don't conflict, they overwrite: neither sees an error, and the
loser's app fails later with `Could not find public function` — which names
nothing about the cause. If you hit that error on a function you can see in your
own tree, this is why; you were overwritten.

Before `convex dev` in a worktree that isn't the main checkout, take your own
deployment:

```sh
bunx convex deployment create dev/<slug> --type dev --select --expiration "in 5 days"
```

- **It starts empty**, which is usually what you want: a profile-less user is the
  only way to test an onboarding. It's a cost only when you need real history —
  `read_programs` and `read_today` have nothing to read on a fresh backend.
- **It inherits no environment variables.** `CLERK_JWT_ISSUER_DOMAIN` is required
  (`convex/users.ts` throws without it), plus `OPENROUTER_API_KEY` and
  `SEARXNG_URL` for the agents. Copy them with `bunx convex env get` / `set`.
  `CLERK_WEBHOOK_SECRET` is not needed: no webhook points at your deployment, and
  signing in creates the user from the client anyway.
- Reading a secret's value will be refused. Hand the author the exact command to
  run with a `!` prefix and wait, rather than working around the refusal.

Two more resources every worktree shares, and one cannot be isolated:

- **The browser.** `agent-browser --session-name` does **not** give you your own
  browser — one session, one tab, whatever you pass. Two agents drive the same
  window, and typing in it lands in the other agent's chat thread. Ask the driver
  for it, say in plain words when you're done, and treat any capture holding a
  message you didn't type as contaminated.
- **The dev port.** `next dev` probes 3000–3005 and takes the first free one, so
  the second server is not where its own QA expects. Pin `PORT` and pass the same
  value to `bun run agent-login -- --browser --port <n>`. And when you clean up,
  **never `pkill -f "next dev"`** — it matches every worktree's dev server, so the
  other agent's app dies mid-QA with nothing naming the cause. Kill your own pid,
  or match your own port.

## Being driven

Your driver is an agent, and behind it a human who is not reading your terminal.

- **Never merge**, and never push to `main`. A green PR is the ceiling.
- **Park, don't guess.** A question about product intent belongs to the author.
  Answering it with a plausible guess is worse than saying you're blocked: state
  the question, say where the work sits, and take the next unblocked thing.
- **Say when you release something.** A shared resource you're done with is
  invisible to everyone until you name it — "browser released", "deployment
  released", in plain words, not implied by falling silent.
- **Report completely, not just honestly.** A green build is a fact; "the card
  renders" is a claim. `renderTool` is untyped on purpose, so a misspelled tool
  name compiles and silently renders nothing — the build proves nothing about it.
  Name what you verified and what you didn't.
- **A review that didn't come back is not a verdict.** `fouine-review` failing at
  30 minutes on `Review failed` is its own timeout, and the API's `rerequest`
  answers 404 — only a push wakes it. Key on the head SHA
  (`gh pr view <n> --json reviews`, filtered on `.commit.oid`), never on the
  review count.
- **Files another worker owns are not yours**, even for an obvious fix. Say what
  you'd change and let the driver route it.

`AGENTS.md` outranks this file, and your driver's brief outranks both — it knows
things about the current fleet that no file can.
