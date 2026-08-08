@AGENTS.md

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
