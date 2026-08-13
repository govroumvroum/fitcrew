---
name: qa
description: Drive a fitcrew change in a real browser until it actually works, then come back with evidence. Use when asked to QA, dogfood, click through the app, test a feature "for real", check that an agent picks up a new tool, verify a card renders or a write lands, take screenshots, or when a PR needs its `## Écrans`. Read this before writing "verified" about anything on screen.
---

# QA — fitcrew

**Exercise the feature, don't inspect it.** A green build says the code compiles.
A screenshot says a screen rendered once. Neither says the agent actually calls
the new tool, that its card renders instead of a fallback line, that the write
survived a reload, or that the popup stays inside a 390px screen.

So the order is: make the feature happen through the UI (§3), then capture what
it did (§5) and measure the claims a picture can't carry (§6).

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

## 3. Drive the feature. Looking at it is not testing it

This is the job. A screenshot proves a screen rendered; QA proves the thing
**does what it was built to do**, reached the way a user reaches it. Never call
the function directly and call that verified — go through the UI, or you have
tested the function, not the feature.

Ask what the change is supposed to make *happen*, then make it happen:

| change | driving it |
|---|---|
| a new agent tool | open the chat and **talk to the agent** until it calls the tool |
| a nav change | navigate with it — hardware back, deep link, same-route tap |
| a guard / refusal | try to violate it and read what comes back |
| a write path | do the write, then reload and confirm it stuck |
| a state machine | run every branch, including the empty and error ones |

### A new agent tool, end to end

The one that gets faked most often, because the code looks obviously right. Four
things have to be true and only the first is visible in the diff:

1. **The model picks it up.** Write a message that should trigger it and watch for
   the tool line. If the model answers in prose instead, that's your finding — a
   prompt problem, and a real one. Registering a tool does not make it called.
2. **The card renders.** `renderTool` is a `switch` on a **string**, and
   `agent-chat.tsx` keeps `input`/`output` as `unknown` on purpose — so a
   misspelled tool name **compiles, lints, builds, and silently renders nothing**
   but the generic fallback line. Only looking catches it. Check the four states
   too: `input-streaming`, `input-available`, `output-available`, `output-error`.
3. **The write landed.** The chat saying it saved something is not evidence.
   Check the screen that reads the data (`/nutrition`, `/programme`) — and
   **reload** before believing it.
4. **The absent case behaves.** Feed it something that yields nothing. The prompts
   are explicit that an empty result must not produce "validate the card shown" —
   there is no card. That instruction exists because it got shipped wrong once.

**Start at `/demo`, finish in the chat.** The gallery
(`src/components/chat/tool-gallery.tsx`) is driven by the **real** `COACH` /
`CHEF` configs — the tool list comes from `config.toolLabels`, every card from
`config.renderTool` — and it renders all four states without paying for a model
call. So a new tool appears there on its own, marked *« pas de fixture »* until
someone writes one, and a card that renders as a fallback line shows up
immediately. Writing that fixture is part of adding a tool, not a nicety.

What `/demo` cannot tell you is points 1 and 3: whether the **model** chooses the
tool, and whether the **mutation** ran. Those only happen in a real conversation.
Don't report the gallery as if it were the app.

Interactive cards (`vision-review.tsx`, `extracted-review.tsx`) hold their state
in a Convex subscription, not React state, precisely so a reload doesn't resurrect
a spent form. So **reload with the card on screen** — a form that comes back blank
or resubmits is the bug that pattern exists to prevent.

Keep the chat short: every turn is a real OpenRouter call, billed and written to
`aiUsage`. Two or three messages that trigger the path beat a conversation.

## 4. Never `sleep` and shoot

A fixed `sleep 3` catches Convex mid-flight and you publish a screenshot of an
empty state that does not exist for real users. Wait for a **condition**:

```sh
until [ "$(agent-browser --session-name fitcrew eval 'document.querySelectorAll("nav").length' 2>/dev/null)" != "0" ]; do sleep 2; done
```

Two signals worth waiting on: the nav exists (Clerk hydrated — it renders only
for a signed-in user) and the screen's own data is on the page.

## 5. Shots

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

## 6. Measure, don't squint

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

## 7. `eval` gotchas that will waste your afternoon

- **Wrap every script in an IIFE.** The page context persists between calls, so
  a bare `const x = …` throws `Identifier 'x' has already been declared` on the
  second run.
- **Always `<<'EOF'`, quoted.** An unquoted heredoc lets the shell eat your
  backticks and `$…`, which silently strips values out of a Markdown table.
  Same trap when writing a PR body with code spans.
- Prefer `eval --stdin` over inline `eval "…"` for anything with quotes.

## 8. "Element is covered" is usually the tab bar

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

## 9. Say which layer you shot, and what you could not

On a stacked branch, a screenshot shows **that layer's** state: a shot taken
below the nav-drawer layer shows the old 7-tab bar. That is honest, so label it.
Publishing an upstack shot as if it were this PR's is not.

And name what emulation cannot reach rather than letting a shot imply coverage.
The standing example: **the installed iOS PWA safe area.** Chrome does not
reproduce `env(safe-area-inset-bottom)` in standalone mode, and #40 was exactly
that bug. It needs a real phone; write that down instead of shipping a
desktop-emulated shot of the same screen.

## 10. Leave nothing running

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
