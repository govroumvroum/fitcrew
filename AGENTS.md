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

# Pull requests

`main` is protected: PR required, squash-only, no force-push. Read
`.agents/skills/pr/SKILL.md` before opening a PR — it covers the screenshots a
UI PR must carry and the `fouine-review` loop you're expected to drive to green.
