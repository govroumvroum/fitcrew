/**
 * Self-check for the Radix → Base UI part mapping (Dialog/Sheet Overlay→Backdrop
 * and Content→Popup, Tabs Trigger→Tab and Content→Panel, Progress Root>Indicator,
 * Separator, Label). Run with `bun src/components/ui/base-ui-parts.check.tsx`.
 *
 * What's worth checking is the handful of attributes our Tailwind classes key on.
 * `shadcn/tailwind.css` defines `data-open`, `data-closed`, `data-active`,
 * `data-horizontal`/`data-vertical` as variants matching EITHER Radix's
 * `data-state="…"` or Base UI's boolean/`data-orientation` form, so a wrong part
 * name doesn't break the build — it just silently stops matching. Hence asserting
 * on the markup.
 *
 * Not covered here: `DialogContent` / `SheetContent`, which render through a
 * portal. `createPortal` produces nothing under `renderToStaticMarkup` (on Radix
 * too), so those two need a browser. The `render`-prop composition they rely on
 * is covered below through `DialogFooter showCloseButton`, which is the same
 * `<Dialog.Close render={<Button />}>` shape outside a portal.
 *
 * Same limitation for the four floating components (select, dropdown-menu,
 * tooltip, hover-card): everything below the portal — positioner, popup, list —
 * is invisible to `renderToStaticMarkup`. What matters most there is the CSS
 * custom properties the popups constrain themselves with, so those are checked by
 * reading the class strings out of the source instead.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { Dialog, DialogFooter } from "./dialog";
import { Label } from "./label";
import { Progress } from "./progress";
import { Select, SelectTrigger, SelectValue } from "./select";
import { Separator } from "./separator";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { Tooltip, TooltipTrigger } from "./tooltip";

// --- Progress: Base UI sizes the indicator, we must not fight it with flex-1.
const progress = renderToStaticMarkup(<Progress value={37} />);
assert.match(progress, /data-slot="progress-indicator"/, progress);
assert.match(progress, /width:37%/, progress);
assert.equal(progress.includes("flex-1"), false, progress);
// Radix never got `value` (our old wrapper swallowed it), so the bar was
// `aria-valuenow`-less and permanently "indeterminate". Keep it forwarded.
assert.match(progress, /aria-valuenow="37"/, progress);
assert.match(progress, /role="progressbar"/, progress);
assert.equal(
  renderToStaticMarkup(<Progress value={0} />).includes("width:0%"),
  true,
);

// --- Separator: Base UI has no `decorative`, we re-add the role it implied.
assert.match(renderToStaticMarkup(<Separator />), /role="none"/);
assert.match(
  renderToStaticMarkup(<Separator decorative={false} />),
  /role="separator"/,
);
// The `data-horizontal:` / `data-vertical:` variants need this exact attribute.
assert.match(renderToStaticMarkup(<Separator />), /data-orientation="horizontal"/);
assert.match(
  renderToStaticMarkup(<Separator orientation="vertical" />),
  /data-orientation="vertical"/,
);

// --- Label: a plain <label>, htmlFor and all.
const label = renderToStaticMarkup(<Label htmlFor="x">Titre</Label>);
assert.match(label, /^<label [^>]*for="x"/, label);
assert.match(label, /data-slot="label"/, label);

// --- Tabs: Tab → `data-active` (not `data-state="active"`), Root → orientation.
const tabs = renderToStaticMarkup(
  <Tabs value="a">
    <TabsList>
      <TabsTrigger value="a">A</TabsTrigger>
      <TabsTrigger value="b">B</TabsTrigger>
    </TabsList>
  </Tabs>,
);
assert.match(tabs, /data-orientation="horizontal"[^>]*data-slot="tabs"/, tabs);
assert.equal(tabs.match(/data-active=""/g)?.length, 1, tabs);
assert.match(tabs, /data-slot="tabs-list"/, tabs);
assert.equal(tabs.match(/data-slot="tabs-trigger"/g)?.length, 2, tabs);
// Base UI marks a disabled tab with `aria-disabled`, not the `disabled`
// attribute, so the trigger carries `aria-disabled:` utilities too.
const disabledTab = renderToStaticMarkup(
  <Tabs value="a">
    <TabsList>
      <TabsTrigger value="a" disabled>
        A
      </TabsTrigger>
    </TabsList>
  </Tabs>,
);
assert.match(disabledTab, /aria-disabled="true"/, disabledTab);
assert.match(disabledTab, /class="[^"]*aria-disabled:opacity-50/, disabledTab);

// --- Dialog.Close with `render`: one element, our Button, its own children.
const footer = renderToStaticMarkup(
  <Dialog>
    <DialogFooter showCloseButton />
  </Dialog>,
);
const closeButtons = footer.match(/<button/g) ?? [];
assert.equal(closeButtons.length, 1, footer);
assert.match(footer, /data-slot="button" data-variant="outline"/, footer);
assert.equal(footer.match(/>Close</g)?.length, 1, footer);

/**
 * --- The floating layer: the 11 `--radix-*` custom properties.
 *
 * These are not cosmetic. `max-h-(--available-height)` is what stops a select or
 * a menu opened near the bottom of a 390 px phone from running off-screen, and
 * `w-(--anchor-width)` is what makes a menu as wide as its trigger. Base UI
 * writes them on the *positioner*, from where they inherit into the popup — so a
 * popup left outside a positioner, or a stale `--radix-` name, silently drops the
 * constraint with no build error. Asserting on the source text is the only way to
 * catch that without a browser.
 */
const source = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

for (const file of [
  "select.tsx",
  "dropdown-menu.tsx",
  "tooltip.tsx",
  "hover-card.tsx",
]) {
  const text = source(file);
  // `(--radix-` is the Tailwind arbitrary-property form; prose about the old
  // names is fine, a class still reading one is not.
  assert.equal(text.includes("(--radix-"), false, `${file} still reads --radix-*`);
  assert.equal(
    text.includes('from "radix-ui"'),
    false,
    `${file} still imports radix-ui`,
  );
}

// max-height ← --radix-{select,dropdown-menu}-content-available-height
assert.match(source("select.tsx"), /max-h-\(--available-height\)/);
assert.match(source("dropdown-menu.tsx"), /max-h-\(--available-height\)/);
// width/height ← --radix-select-trigger-{width,height}, --radix-dropdown-menu-trigger-width
assert.match(source("select.tsx"), /min-w-\(--anchor-width\)/);
assert.match(source("select.tsx"), /h-\(--anchor-height\)/);
assert.match(source("dropdown-menu.tsx"), /w-\(--anchor-width\)/);
// transform-origin ← --radix-*-content-transform-origin, on all four
for (const file of [
  "select.tsx",
  "dropdown-menu.tsx",
  "tooltip.tsx",
  "hover-card.tsx",
]) {
  assert.match(source(file), /origin-\(--transform-origin\)/, file);
}
// Radix's tooltip never said `data-state="open"`, so `data-[state=delayed-open]:`
// carried the open animation. Base UI says `data-open`, and marks the
// no-animation case (keyboard focus) `data-instant`.
assert.equal(
  source("tooltip.tsx").includes("data-[state=delayed-open]:animate-in"),
  false,
);
assert.match(source("tooltip.tsx"), /data-instant:animate-none/);
// The positioner is the portalled element, so it is what has to stack.
for (const file of ["select.tsx", "dropdown-menu.tsx", "tooltip.tsx", "hover-card.tsx"]) {
  assert.match(source(file), /Positioner\s+className="z-50"/, file);
}

/**
 * --- Select.Value prints the *value*, not the selected item's text.
 *
 * Radix mirrored `<Select.ItemText>` into the trigger. Base UI can't: the items
 * live in a portal that isn't mounted while the select is closed. So any select
 * whose labels differ from its values must pass `items`. Both halves are asserted
 * because the failure is silent — a trigger reading "petit_dejeuner".
 */
const withItems = renderToStaticMarkup(
  <Select items={{ dejeuner: "Déjeuner" }} value="dejeuner">
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
  </Select>,
);
assert.match(withItems, /data-slot="select-value">Déjeuner</, withItems);

const withoutItems = renderToStaticMarkup(
  <Select value="dejeuner">
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
  </Select>,
);
assert.match(withoutItems, /data-slot="select-value">dejeuner</, withoutItems);

const placeholder = renderToStaticMarkup(
  <Select>
    <SelectTrigger size="sm">
      <SelectValue placeholder="Choisis un exercice" />
    </SelectTrigger>
  </Select>,
);
assert.match(placeholder, /data-placeholder=""/, placeholder);
assert.match(placeholder, />Choisis un exercice</, placeholder);

// `<Select.Icon>` injects a literal "▼" as children, which `render` appends
// inside the svg. We render the chevron directly instead — exactly one icon, no
// stray glyph.
assert.equal(withItems.includes("▼"), false, withItems);
assert.equal(withItems.match(/<svg/g)?.length, 1, withItems);

/**
 * --- `asChild` on the two triggers that still need it.
 *
 * `sidebar.tsx` and vendored `ai-elements/*` write `<TooltipTrigger asChild>` and
 * `<DropdownMenuTrigger asChild>`. It maps onto Base UI's `render`, and the thing
 * that breaks is the child appearing twice — once as the element, once as its own
 * child.
 */
const tooltipTrigger = renderToStaticMarkup(
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className="size-8">
        Aide
      </button>
    </TooltipTrigger>
  </Tooltip>,
);
assert.equal(tooltipTrigger.match(/<button/g)?.length, 1, tooltipTrigger);
assert.equal(tooltipTrigger.match(/Aide/g)?.length, 1, tooltipTrigger);
assert.match(tooltipTrigger, /data-slot="tooltip-trigger"/, tooltipTrigger);
assert.match(tooltipTrigger, /class="[^"]*size-8/, tooltipTrigger);

console.log("ok — Base UI parts emit the attributes our classes key on");
