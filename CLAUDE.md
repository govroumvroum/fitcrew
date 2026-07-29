@AGENTS.md

# Delegate the implementation, keep the conversation

The main agent is Basile's interlocutor. Its context is for talking to him,
holding the thread of what we're building, and judging results — not for filling
up with file reads and edit diffs.

**Default to dispatching a subagent for implementation work**, even when the
change looks small enough to just do. "It's only a few lines" is how the context
window gets spent on plumbing instead of on the conversation.

Do it inline only when delegating genuinely costs more than it saves:
- A one-line edit to a file already open in context.
- A change that depends on a subtlety just worked out in conversation and would
  take longer to brief than to make.
- Running verification (`bunx tsc --noEmit`, `bunx oxlint`, `bun run build`, the
  `*.check.ts` self-checks) and reading data with `bunx convex data` / `convex run`.

When you delegate:
- Brief with the constraints and the traps, not just the goal — the reasoning
  behind a decision is the part a subagent can't rediscover.
- Name the files it must NOT touch when several agents run at once, and never let
  two agents edit one file.
- Require `bun run build` green as the acceptance bar; `tsc` and lint can both
  pass while the build fails.
- Verify the claims that matter yourself rather than relaying them. Subagents
  report honestly but not always completely.

# Claim the issue before working on it

When we start on an issue, assign it first:

```sh
gh issue edit <n> --add-assignee @me
```

`@me` is whoever's `gh` is authenticated — Basile. It's how the issue list shows
what's in flight, so it belongs at the start of the work, not at the PR.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
