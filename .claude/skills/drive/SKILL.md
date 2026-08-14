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

`driven` is the worker's half of this: the deployment it must take, the
environment variables a fresh one lacks, and the browser and port it cannot
isolate. Name it in every brief instead of restating it, and read it yourself —
what follows is only the part that is yours to decide.

**Who gets the populated deployment.** A fresh one is empty, which is a gift for
testing an onboarding and a cost for verifying a read path (`read_programs` and
`read_today` have nothing to read). Leave the shared deployment to the worker that
needs real history, isolate the others, and tell each one what it now owns —
otherwise its first instinct on any trouble is to re-point at the deployment it can
see in the other worktree.

**Who holds the browser**, since it cannot be split. One worker at a time, an
explicit "browser released" before the next starts. Order it so the worker that
needs it last isn't the one blocking everyone.

**Copying the secrets is yours too**, because reading their values will be refused:
hand the author the command with a `!` prefix and keep the worker parked until they
land, rather than letting it improvise.

When something else turns out to be shared, serialize out loud: name the holder,
tell it to signal release in plain words, tell the waiter to say it is waiting
rather than route around you.

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

Open every brief with `run the driven skill first` — that carries the shared-backend
procedure and the worker protocol, so the brief itself only has to hold what is
specific to this worker: the files it must not touch, which deployment and port are
its own, `bun run build` green as the bar (typecheck and lint both pass while builds
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

**A redesign mid-flight leaves sediment.** Each superseded instruction stays in the
worker's context and competes with the current one, so a worker on its third design
carries two it must not follow — and will occasionally follow one. After a real
change of direction, have it write a handoff into the PR body (what is verified, the
traps that took review rounds to find, what its deployment and browser are doing),
then get its context compacted, naming what to keep and what to drop. A worker
**cannot run `/compact` on itself** — ask the author to type it in that terminal. The
handoff goes first: the PR survives the compaction, the session does not.

**Your own hobby-horses cost the worker hours.** Reviewing a shrinking diff, chasing
a line count, polishing a measurement — if the author has not asked for it, it is
your bias spending someone else's turns. When you notice you have sent two messages
about something the author never raised, drop it out loud so the worker stops too.

## 6. Land

You are done when nothing is left holding something: no serialization
unreleased, no worker parked on a wait that is over, every expiring deployment
noted with its expiry.

What was learned goes in the repo, not in the conversation: a rule in `AGENTS.md`
beats remembering, because the repo is the only thing that reaches a teammate.

Automating it is tempting and only half works here. Orca's per-repo setup script
(`bun install` today) would provision the deployment on every new worktree, but it
lives in Orca's own settings under `commandSourcePolicy: local-only` — machine
local, not committed, so it protects you and nobody else. Write the rule first;
add the automation on top for yourself.

Then the handoff, which is all they read:

```
Shipped   — one line per PR, with the link
Parked    — one line per blocker: what, why it needs them, where the work sits
Assumed   — decisions made on their behalf that they might want back
```
