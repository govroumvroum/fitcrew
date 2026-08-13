# Browser mechanics — fitcrew QA

Disclosed reference for [`SKILL.md`](SKILL.md): how to get a signed-in browser and
the traps that waste an afternoon.

## Getting signed in

```sh
bun run dev                          # port detected, 3000–3005
bun run agent-login -- --browser     # signs the agent-browser session "fitcrew" in
```

AGENTS.md ("Signing in to the local app") is the source of truth for the rules —
the live-credential handling, the revoke, the `sk_test_` guard. Read it there.

Two things it doesn't cover:

**The identifier is yours to be given.** `AGENT_LOGIN_IDENTIFIER` is a per-developer
email on the Clerk **dev** instance, so a work address fails with
`Unprocessable Entity` — the dev accounts come from Google. When it is missing, ask
the developer for it. The Convex `users` table holds real people; treat it as
off-limits for this.

**The second stale-session tell.** AGENTS.md describes the sign-in screen. The
other shape reads like a broken build: the page renders its **empty state**,
`document.querySelectorAll('nav').length` is `0`, the console is clean, and the
Clerk cookies are *present*. Same cause, same cure — re-run
`bun run agent-login -- --browser`.

## `eval`

- **Wrap each script in an IIFE.** The page context persists between calls, so a
  bare `const x = …` throws `Identifier 'x' has already been declared` on the
  second run.
- **Quote the heredoc: `<<'EOF'`.** Unquoted, the shell expands backticks and
  `$…` inside your JS — and does the same to a PR body, which is how a Markdown
  table silently loses its values.
- Prefer `eval --stdin` over inline `eval "…"` for anything containing quotes.

## "Element is covered by …"

`agent-browser click` refusing with *covered by `<button#base-ui-…>`* usually means
the target sits **below the fold**, under the fixed tab bar, at `scrollY: 0`.
Confirm before calling it a regression:

```sh
cat <<'EOF' | agent-browser --session-name fitcrew eval --stdin
(()=>JSON.stringify({scrollY, max:document.documentElement.scrollHeight-innerHeight}))()
EOF
```

`main` reserves `pb-[var(--tab-bar)]` — 64px against a 61px bar — so the layout is
sound. Scroll the element into view and click again.

## Stacked branches

A shot shows **that layer's** state: taken below the nav-drawer layer, the bar
still has seven tabs. Label which layer each shot came from.

Switching between stacks that differ in dependencies leaves `node_modules` from
the other one — `bun run build` then fails on a missing package. `bun install`
after every checkout.

The same trap catches documentation. A script or CSS property added in one layer
does not exist on `main`, so anything written from memory of another branch can
describe a world the reader's checkout doesn't have. Run the command on the branch
you are documenting before writing it down.

## Finishing

```sh
agent-browser --session-name fitcrew close
pkill -f "next dev"
```

`--browser` revokes its own Agent Task, so an explicit
`bun run agent-login -- --revoke <id>` answering `Bad Request` means it was already
revoked — success, not failure. Remove any `pr-media` worktree with
`git worktree remove`.
