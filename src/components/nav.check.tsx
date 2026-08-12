/**
 * Self-check for the nav's route→tab mapping and for the drawer trigger's
 * accessibility contract. Run with `bun src/components/nav.check.tsx`.
 *
 * Two entries now cover two routes each, so `isActive` matches a list instead of
 * a single prefix — and the thing that regressed before (a route of the app with
 * no tab lit at all, which is how /chef shipped) is checked by walking
 * `src/app` rather than by listing routes here a second time.
 *
 * Not covered: the drawer's contents. Popup, backdrop and the two `<Link>`s
 * inside render through a portal, and `createPortal` produces nothing under
 * `renderToStaticMarkup` — same limitation `base-ui-parts.check.tsx` notes for
 * DialogContent. The trigger is outside the portal, so it is asserted for real.
 */
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { isActive, RAIL_TABS, TABS } from "./nav";
import { Drawer, DrawerTrigger } from "./ui/drawer";

/**
 * --- The drawer closes on ANY route change, not just its own links.
 *
 * `open` is derived as `openedOn === pathname` rather than held as a boolean,
 * which is what makes Android back, iOS swipe-back and a deep link tapped from
 * behind the drawer close it too — none of those run the links' onClick, and the
 * nav never unmounts to reset a boolean for us. Mirrored here as pure logic
 * because the component's state isn't reachable without a renderer.
 */
const drawerOpen = (openedOn: string | null, pathname: string) => openedOn === pathname;
assert.equal(drawerOpen("/coach", "/coach"), true, "opened here, still here → open");
assert.equal(drawerOpen("/coach", "/chef"), false, "route changed → closed, whatever caused it");
assert.equal(drawerOpen(null, "/coach"), false, "never opened → closed");
// The literal regression fouine found: a deep link away from the page it opened on.
assert.equal(drawerOpen("/nutrition", "/chef"), false, "« Changer » → /chef must not leave it up");

// --- Six entries in the bar, two of them groups; eight flat links in the rail.
assert.equal(TABS.length, 6, `TABS has ${TABS.length} entries`);
const groups = TABS.filter((tab) => "items" in tab);
assert.deepEqual(
  groups.map((g) => g.label),
  ["Le Coach", "Le Chef"],
);
assert.deepEqual(
  groups.map((g) => g.items.map((i) => i.href)),
  [
    ["/programme", "/coach"],
    ["/nutrition", "/chef"],
  ],
);
assert.equal(RAIL_TABS.length, 8);
// Duplicate hrefs would render duplicate React keys in the rail.
assert.equal(new Set(RAIL_TABS.map((t) => t.href)).size, 8);
// The rail is a 72px column: its labels have to be one word.
for (const { href, label, railLabel } of RAIL_TABS) {
  assert.equal((railLabel ?? label).includes(" "), false, `${href} rail label`);
}

// --- isActive: "/" only matches itself, everything else matches its prefix.
assert.equal(isActive("/", ["/"]), true);
assert.equal(isActive("/seance", ["/"]), false);
assert.equal(isActive("/seance/123", ["/seance"]), true);
// The list form: either route in a group lights the group.
const coach = ["/programme", "/coach"];
assert.equal(isActive("/coach", coach), true);
assert.equal(isActive("/programme", coach), true);
assert.equal(isActive("/programme/v2", coach), true);
assert.equal(isActive("/nutrition", coach), false);
assert.equal(isActive("/nutrition", ["/nutrition", "/chef"]), true);
assert.equal(isActive("/chef", ["/nutrition", "/chef"]), true);

/**
 * --- Every route of the app lights exactly one tab.
 *
 * The bug this replaces: /chef was in no entry, so nothing was highlighted
 * there. Reading `src/app` instead of a hardcoded list means a new route can't
 * be added without either a tab or a line in the exclusion set below.
 */
const hrefsOf = (tab: (typeof TABS)[number]) =>
  "items" in tab ? tab.items.map((i) => i.href) : [tab.href];

// Not app routes: the offline fallback, the component playground, the public
// share link, and Clerk's two auth screens — none of them show the nav.
const OUTSIDE_NAV = new Set(["~offline", "demo", "p", "sign-in", "sign-up"]);
const routes = ["/"].concat(
  readdirSync(new URL("../app/", import.meta.url), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !OUTSIDE_NAV.has(e.name))
    .map((e) => `/${e.name}`),
);
// ponytail: no `routes.length === 8`. The loop below already fails on any route
// that isn't covered, which is the guarantee — a count is a second, vaguer
// failure for the same cause, and one more number to bump by hand.
for (const route of routes) {
  const lit = TABS.filter((tab) => isActive(route, hrefsOf(tab)));
  assert.equal(lit.length, 1, `${route} lights ${lit.length} tabs, want 1`);
}

/**
 * --- The trigger is a `<button>`, and its accessible name is the label.
 *
 * A tab that opens a drawer has no `href`, so `aria-current="page"` is gone and
 * `aria-haspopup` / `aria-expanded` / `aria-controls` are the whole story. Base
 * UI puts all three on `Drawer.Trigger`; asserting it here is what catches the
 * day it stops.
 */
const trigger = renderToStaticMarkup(
  <Drawer>
    <DrawerTrigger className="text-muted-foreground">
      <span aria-hidden>icon</span>
      Le Chef
    </DrawerTrigger>
  </Drawer>,
);
assert.equal(trigger.match(/<button/g)?.length, 1, trigger);
assert.match(trigger, /aria-haspopup="dialog"/, trigger);
assert.match(trigger, /aria-expanded="false"/, trigger);
assert.match(trigger, /type="button"/, trigger);
// No `aria-controls` while closed, and that's right: the popup isn't in the DOM,
// so the id would dangle. Base UI adds it when the drawer opens.
assert.equal(trigger.includes("aria-controls"), false, trigger);
assert.match(trigger, /data-slot="drawer-trigger"/, trigger);
assert.match(trigger, /class="[^"]*text-muted-foreground/, trigger);
assert.match(trigger, />Le Chef</, trigger);
// Closed drawer renders no popup at all — the portal isn't mounted.
assert.equal(trigger.includes("drawer-popup"), false, trigger);

/**
 * --- Stacking and safe area, read out of the source.
 *
 * All three portalled elements have to sit above the z-40 bar and below the
 * thread sidebar's mobile Sheet (z-50), and the popup has to reserve the same
 * safe-area padding the bar does — it covers the bar, so it inherits the job of
 * clearing the iOS home indicator. Neither is visible to
 * `renderToStaticMarkup`, and both fail silently.
 */
const drawerSource = readFileSync(new URL("./ui/drawer.tsx", import.meta.url), "utf8");
const navSource = readFileSync(new URL("./nav.tsx", import.meta.url), "utf8");
// Backdrop, viewport and popup — the three elements the portal drops into <body>.
assert.ok(
  (drawerSource.match(/\bz-45\b/g)?.length ?? 0) >= 3,
  "overlay+viewport+popup must all be z-45",
);
assert.equal(drawerSource.includes("z-50"), false, "drawer must stay under the Sheet");
assert.match(navSource, /\bz-40\b/, "the bar stays z-40");
const SAFE_BOTTOM = "pb-[max(0.5rem,env(safe-area-inset-bottom))]";
assert.ok(drawerSource.includes(SAFE_BOTTOM), "popup clears the home indicator");
assert.ok(navSource.includes(SAFE_BOTTOM), "the bar still clears it too");
// The drag offset and the enter/exit end state share `transform`, so the exit
// must be a transition — an `animate-out` keyframe would overwrite the drag.
assert.match(drawerSource, /--drawer-swipe-movement-y/);
assert.match(drawerSource, /transition-transform/);
assert.equal(drawerSource.includes("animate-out"), false, drawerSource);

console.log("ok — 6 tabs, 8 rail links, every route lights exactly one");
