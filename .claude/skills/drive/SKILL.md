---
name: drive
description: Spawn Orca workspaces on fitcrew and drive them unattended on a loop — `autonomous` seen from outside, across one or several workspaces.
disable-model-invocation: true
---

# Drive — fitcrew

You are the **driver**. The work happens in Orca workspaces you spawn; you never
open their files. Your context is for judgment, the loop, and the author.

`autonomous` is one agent doing the work. `drive` is you outside N workspaces
doing it, and a worker's brief can tell it to run `autonomous`.

One worker is a legitimate fleet. You keep the conversation, it keeps the
plumbing. Use `orca-cli` for the mechanics.

## 1. Split the work

One worker per unit that can reach a green PR alone. The cost of a second worker
is not tokens, it is overlap: if two units must edit one file, that is one
worker, not two.

`convex/schema.ts` is the file two workers collide on most — every feature adds a
table and every instrumentation task adds a field. Name the section each owns.

Done when each worker has a one-sentence goal and a file set disjoint from every
other worker's.

## 2. Isolate the blast radius

**A worktree bounds the diff, not the blast radius.** Git isolates files, not
what the checkout *points at* — and the pointer rides in with the keys, because
Orca copies the gitignored files into each worktree so the agent gets its
credentials (`0be24fa`).

On this repo that means every worktree inherits the same `CONVEX_DEPLOYMENT`. A
Convex push replaces the whole schema and function set, so two workers do not
conflict, they overwrite: no error at either one, and the loser's app fails later
with `Could not find public function`, which names nothing about the cause.

Give each worker its own dev deployment before it runs anything:

```sh
# from the worktree. See docs.convex.dev/cli/agent-mode
bunx convex deployment create dev/<slug> --type dev --select --expiration "in 5 days"
```

- **It is empty.** A gift for testing an onboarding, a cost for verifying a read
  path — `read_programs` and `read_today` need real history. Leave the shared
  deployment to the worker that needs data, isolate the others.
- **It inherits no environment variables.** `CLERK_JWT_ISSUER_DOMAIN` (auth
  throws without it), `OPENROUTER_API_KEY` and `SEARXNG_URL` must be copied.
  Copying means reading secret values, which will be refused — hand the author the
  exact command with a `!` prefix and keep the worker parked until they land.
  `CLERK_WEBHOOK_SECRET` is not needed: no webhook points there, and
  `convex/users.ts` creates the user from the client on sign-in anyway.
- **Tell the worker what it now owns**, and that the shared deployment belongs to
  someone else — otherwise its first instinct on any trouble is to re-point at the
  deployment it can see in the other worktree.

Two more resources every worktree shares: the `agent-browser --session-name
fitcrew` cookie jar, and the dev port `next dev` probes for (3000–3005). Give
concurrent workers distinct session names.

When isolation is impossible, serialize out loud: name the holder, tell it to
signal release in plain words, tell the waiter to say it is waiting rather than
route around you.

Done when every shared mutable resource is per-worker, or under a named
serialization with an explicit release signal.

## 3. Launch

```sh
orca worktree create --repo name:fitcrew --no-parent --base-branch main \
  --name <kebab-slug> --issue <n> --agent claude --prompt "<brief>" --setup run --json
```

Orca prefixes the branch with the handle itself, so a slug you prefixed lands
doubled. Fix it with `git branch -m` plus `orca worktree set --display-name`
before the worker commits.

Brief for the **traps, not the goal** — the goal is in the issue and the worker
can read. Spend the brief on what it cannot rediscover: the rule that looks like
an oversight and was a choice, the guard that must not be removed and why, the
bug a comment already records. This repo is full of them and `AGENTS.md` names
the worst — the two-deploy rule for removing a Convex function, the vendored
`ai-elements/` directory, the migrations list.

Then give each worker the files it must not touch, which deployment it owns,
`bun run build` green as the bar (typecheck and lint both pass while builds
fail), and what is out of scope so a capable agent does not widen the diff.

Done when every worker is running and you have its terminal handle.

## 4. Set the loop

Nothing above survives you going quiet. `/loop` with no interval, self-paced, is
what makes this unattended.

Each tick: `orca worktree ps --json`, and for each of your workers read `state`,
the preview, and the linked PR. `terminal read` only when that is not enough to
tell thinking from finished. Then act on exactly one of:

- **stuck or idle** — it finished, or it is waiting on you. Unpark it.
- **asking** — answer it, unless the answer is the author's to give. Then park it.
- **PR opened** — check fouine is being driven to green, not ignored.
- **resource released** — hand the deployment or the session to whoever waited.
- **dead or interrupted** — say so; do not restart it blind.

Pace it to the work: a worker runs tens of minutes, so tick every 20–30, not
every minute. Speak only when something changed — a quiet tick is `noop: true`.

Done when the loop is set with a reason that names what you are watching.

## 5. Drive

Correct the moment a premise turns out to be wrong. A worker running forty
minutes on a stale brief is the expensive failure and the fix is one
`terminal send`: what changed, what is now allowed, what still is not.

Verify the claims that matter yourself. Workers report honestly and
incompletely — a green build is a fact, "the card renders" is a claim, and
`renderTool` is untyped on purpose so a misspelled tool name compiles and simply
never shows. Ask for the shot, or drive it yourself with `qa`.

Answering a worker's question with a guess about product intent is worse than
parking it. Two failed attempts at the same wall is the signal to park.

## 6. Land

You are done when nothing is left holding something: no serialization
unreleased, no worker parked on a wait that is over, every expiring deployment
noted with its expiry.

What was learned goes in the repo, not in the conversation — a rule in
`AGENTS.md` beats remembering, and a `convex deployment create` in the repo's
setup hook beats the rule.

Then the handoff, which is all they read:

```
Shipped   — one line per PR, with the link
Parked    — one line per blocker: what, why it needs them, where the work sits
Assumed   — decisions made on their behalf that they might want back
```
