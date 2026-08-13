---
name: qa
description: Drive a fitcrew change through the running app and bring back evidence. Use when asked to QA, dogfood or test a change for real; to confirm an agent picks up a new tool or a card renders; to prove a write sticks; or when a PR needs its `## Écrans`.
---

# QA — fitcrew

**Drive** the change: make it happen through the UI, the way a user reaches it.
A green build says the code compiles and a screenshot says a screen rendered
once — neither says the agent calls the new tool, that its card renders, or that
the write survived a reload. Driving produces **evidence**; inspecting produces
an impression.

Browser mechanics — sign-in, `eval` traps, cleanup — live in
[`reference.md`](reference.md). Read it before the first `agent-browser` command.
PR mechanics for the shots (`pr-media`, `## Écrans`, `width="320"`) are in
[`../pr/SKILL.md`](../pr/SKILL.md).

## 1. Drive it

Ask what the change makes *happen*, then make it happen through the UI. Reaching
into Convex to set state, or calling the function directly, tests the function.

| change | how you drive it |
|---|---|
| a new agent tool | talk to the agent until it calls the tool |
| a nav change | navigate — hardware back, deep link, tap the route you're on |
| a guard or refusal | violate it and read what comes back |
| a write path | write, reload, look again |
| a state machine | every branch, empty and error included |

**A new agent tool** is the case that looks obviously right in the diff, so drive
all four:

1. **The model calls it.** Write a message that should trigger it. Prose instead
   of a tool line is a finding — the prompt, and a real one. Registering a tool
   does not make it called.
2. **The card renders as a card.** `renderTool` switches on a **string** and
   keeps `input`/`output` as `unknown`, so a misspelled tool name compiles, lints,
   builds, and renders the generic fallback line. Cover the four states:
   `input-streaming`, `input-available`, `output-available`, `output-error`.
3. **The write landed.** The agent saying it saved is not evidence. Read the
   screen that reads the data, after a reload.
4. **An empty result stays quiet.** Feed it something that finds nothing. The
   prompts forbid "validate the card shown" when there is no card.

Start at `/demo`: the gallery (`src/components/chat/tool-gallery.tsx`) runs off
the **real** `COACH` / `CHEF` configs and covers all four states without a model
call, so a new tool appears there marked *« pas de fixture »* until someone writes
one — which is part of adding a tool. It settles point 2 cheaply and says nothing
about 1 or 3.

Interactive cards (`vision-review.tsx`, `extracted-review.tsx`) keep state in a
Convex subscription so a reload cannot resurrect a spent form — reload with the
card open to confirm it.

Two or three messages that hit the path are enough: every turn is a billed
OpenRouter call written to `aiUsage`.

**Done when** every path the diff touches has been driven through the UI, and for
an agent tool all four points above hold.

## 2. Capture

```sh
agent-browser --session-name fitcrew open                    # launch first
agent-browser --session-name fitcrew set viewport 390 844 2  # before navigating
agent-browser --session-name fitcrew open http://localhost:3000/<route>
```

Hide the dev overlay every time — the Next.js bubble sits over the tab bar and the
drawer rows:

```sh
cat <<'EOF' | agent-browser --session-name fitcrew eval --stdin
(()=>{const s=document.createElement('style');
s.textContent='nextjs-portal{display:none !important}';
document.head.appendChild(s);return 'ok'})()
EOF
```

Wait for a **condition**, never a delay: a fixed `sleep` catches Convex mid-flight
and captures an empty state no user ever sees.

```sh
until [ "$(agent-browser --session-name fitcrew eval 'document.querySelectorAll("nav").length' 2>/dev/null)" != "0" ]; do sleep 2; done
```

The nav renders only for a signed-in user, so its presence means Clerk hydrated.
Wait on the screen's own data too.

`NavRail` is a different component: shoot it at `1280 900 2`.

**Done when** each screen the diff changes has a shot at 390×844 @2x with the
overlay hidden, the rail has its own if the diff reaches it, and each shot's
caption says which stack layer it was taken on.

## 3. Measure

Geometric and structural claims survive in numbers, not pictures. Read them from
the DOM and put them in the PR body:

```sh
cat <<'EOF' | agent-browser --session-name fitcrew eval --stdin
(()=>{const p=document.querySelector('[data-slot="select-content"]');
const r=p.getBoundingClientRect(), cs=getComputedStyle(p);
return JSON.stringify({maxH:cs.maxHeight, fits:r.bottom<=innerHeight&&r.top>=0})})()
EOF
```

What this catches that no build does: `max-height: 345.5px` proving
`--available-height` constrains a `Select` on a phone; `nestedButton: false`
proving an `asChild` trigger produced one element; `aria-valuenow` proving a
`Progress` forwards its value. Also worth reading: the active tab
(`font-weight: 600` plus `accent-text`), `data-side` on a popup, `data-slot` on
anything the CSS selects.

Where emulation cannot reach, write that down instead of implying coverage. The
standing case: the **installed iOS PWA safe area** — Chrome does not reproduce
`env(safe-area-inset-bottom)` in standalone mode, and #40 was that bug. It needs a
real phone.

**Done when** every claim in the PR body is either a number read from the DOM or
named as unverified.

## Before the browser

`bun run check` runs every `*.check.ts` / `*.check.tsx` in `convex/` and `src/`.
A failing check makes every screenshot suspect, and it is faster than a
click-through.
