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
 */
import assert from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";

import { Dialog, DialogFooter } from "./dialog";
import { Label } from "./label";
import { Progress } from "./progress";
import { Separator } from "./separator";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

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

console.log("ok — Base UI parts emit the attributes our classes key on");
