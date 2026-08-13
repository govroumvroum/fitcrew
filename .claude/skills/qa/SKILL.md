---
name: qa
description: Exercise fitcrew in a real browser and come back with evidence — screenshots for a PR, or a DOM assertion that proves a UI claim. Use when asked to QA, dogfood, click through the app, take screenshots, check a change "for real", verify something renders, or when a PR needs its `## Écrans` section. Also read this before claiming a UI behaviour is verified.
---

# QA — fitcrew

The rule this skill exists for: **"it builds" is not "it works", and a screenshot
is not a measurement.** A green build says the code compiles. A screenshot says
it looked right in one state. Neither says the popup stays inside a 390px screen
or that `asChild` collapsed to one element. Get both — a shot for the reviewer's
eye, a DOM assertion for the claim.

For the PR mechanics around the shots (hosting on `pr-media`, the `## Écrans`
heading, `width="320"`), see `../pr/SKILL.md`. This file is about getting to a
signed-in app and coming back with something true.

## 1. Sign in, or you screenshot the sign-in page

Every route is behind Clerk and the dev instance is Google OAuth only.

```sh
bun run dev                          # port is detected, 3000–3005
bun run agent-login -- --browser     # signs the agent-browser session "fitcrew" in
```

`AGENT_LOGIN_IDENTIFIER` must be **your own** email on the Clerk **dev**
instance, in your `.env.local`. It is not the work address: `…@ekino.com` gets
`Unprocessable Entity` because the dev accounts come from Google.

If it isn't set, **ask the developer for it.** Do not hunt for it in the Convex
`users` table — those rows are real people, and reading them to find a login is
both wrong and blocked.

Read the rules in AGENTS.md ("Signing in to the local app") before improvising:
the no-`--browser` mode prints a **live credential**, so it never goes in a
transcript, a log, a commit or a PR body.

## 2. The lapsed session, which looks like a bug

The single most misleading failure. Symptoms: the page renders its **empty
state**, `document.querySelectorAll('nav').length` is `0`, the console has no
errors, and the Clerk cookies are *present*. It reads like a broken build.

It isn't. The saved session lapsed. Re-run `bun run agent-login -- --browser`
and move on — AGENTS.md says this explicitly, and debugging it instead costs
twenty minutes.

## 3. Never `sleep` and shoot

A fixed `sleep 3` catches Convex mid-flight and you publish a screenshot of an
empty state that does not exist for real users. Wait for a **condition**:

```sh
until [ "$(agent-browser --session-name fitcrew eval 'document.querySelectorAll("nav").length' 2>/dev/null)" != "0" ]; do sleep 2; done
```

Two signals worth waiting on: the nav exists (Clerk hydrated — it renders only
for a signed-in user) and the screen's own data is on the page.

## 4. Shots

```sh
agent-browser --session-name fitcrew open                    # launch first
agent-browser --session-name fitcrew set viewport 390 844 2  # BEFORE any navigation
agent-browser --session-name fitcrew open http://localhost:3000/<route>
```

Then hide the dev overlay, every time — the Next.js bubble sits bottom-left,
exactly over the tab bar and the drawer rows:

```sh
cat <<'EOF' | agent-browser --session-name fitcrew eval --stdin
(()=>{const s=document.createElement('style');
s.textContent='nextjs-portal{display:none !important}';
document.head.appendChild(s);return 'ok'})()
EOF
```

Reserve `set viewport 1280 900 2` for the desktop rail — it is a different
component (`NavRail`) and a mobile shot says nothing about it.

## 5. Measure, don't squint

The claims that matter are geometric or structural, and a picture can't carry
them. Read them out of the DOM and put the numbers in the PR body:

```sh
cat <<'EOF' | agent-browser --session-name fitcrew eval --stdin
(()=>{const p=document.querySelector('[data-slot="select-content"]');
const r=p.getBoundingClientRect(), cs=getComputedStyle(p);
return JSON.stringify({maxH:cs.maxHeight, fits:r.bottom<=innerHeight&&r.top>=0})})()
EOF
```

Things this caught that no build ever would: `max-height: 345.5px` proving
`--available-height` actually constrains a `Select` on a phone; `nestedButton:
false` proving an `asChild` trigger did not render a `<button>` inside a
`<button>`; `aria-valuenow="0"` proving a `Progress` forwards its value at all.

Also worth asserting because the app's own conventions depend on them: the
active tab (`font-weight: 600` plus the `accent-text` class), `data-side` on a
sheet or popup, and `data-slot` on anything the CSS selects.

## 6. `eval` gotchas that will waste your afternoon

- **Wrap every script in an IIFE.** The page context persists between calls, so
  a bare `const x = …` throws `Identifier 'x' has already been declared` on the
  second run.
- **Always `<<'EOF'`, quoted.** An unquoted heredoc lets the shell eat your
  backticks and `$…`, which silently strips values out of a Markdown table.
  Same trap when writing a PR body with code spans.
- Prefer `eval --stdin` over inline `eval "…"` for anything with quotes.

## 7. "Element is covered" is usually the tab bar

`agent-browser click` refusing with *covered by `<button#base-ui-…>`* almost
always means the target is **below the fold**, under the fixed tab bar, at
`scrollY: 0`. Check before reporting a regression:

```sh
cat <<'EOF' | agent-browser --session-name fitcrew eval --stdin
(()=>JSON.stringify({scrollY, max:document.documentElement.scrollHeight-innerHeight}))()
EOF
```

`main` reserves `pb-[var(--tab-bar)]` (64px against a 61px bar), so the layout is
fine — scroll the element into view and click again.

## 8. Say which layer you shot, and what you could not

On a stacked branch, a screenshot shows **that layer's** state: a shot taken
below the nav-drawer layer shows the old 7-tab bar. That is honest, so label it.
Publishing an upstack shot as if it were this PR's is not.

And name what emulation cannot reach rather than letting a shot imply coverage.
The standing example: **the installed iOS PWA safe area.** Chrome does not
reproduce `env(safe-area-inset-bottom)` in standalone mode, and #40 was exactly
that bug. It needs a real phone; write that down instead of shipping a
desktop-emulated shot of the same screen.

## 9. Leave nothing running

```sh
agent-browser --session-name fitcrew close
pkill -f "next dev"
```

`--browser` revokes its own Agent Task, so an explicit
`bun run agent-login -- --revoke <id>` answering `Bad Request` means it was
already revoked — that is success, not a failure. If you opened a `pr-media`
worktree, `git worktree remove` it.

## Self-check

`bun run check` runs every `*.check.ts` / `*.check.tsx` in `convex/` and `src/`.
Run it before the browser: a check that already fails makes every screenshot
suspect, and it is faster than a click-through.
