/**
 * Self-check for the `asChild` layer, now backed by Base UI's `useRender`
 * instead of Radix's `Slot`. Run with `bun src/components/ui/as-child.check.tsx`.
 *
 * The thing worth checking is that `asChild` still collapses to ONE element: the
 * child's tag and props, plus our classes. Get the `children` handling wrong and
 * you either lose the child's content or nest the element inside itself.
 */
import assert from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";

import { Badge } from "./badge";
import { Button } from "./button";
import { DropdownMenu, DropdownMenuTrigger } from "./dropdown-menu";
import { SidebarMenuAction, SidebarMenuButton, SidebarProvider } from "./sidebar";

const asChild = renderToStaticMarkup(
  <Button asChild size="lg" className="mt-4">
    <a href="/programme">Voir</a>
  </Button>,
);

// One element, not a button wrapping an anchor.
assert.equal(asChild.match(/<a\b/g)?.length, 1, asChild);
assert.equal(asChild.includes("<button"), false, asChild);
// The child's own props survive...
assert.match(asChild, /href="\/programme"/);
// ...its content is rendered exactly once...
assert.equal(asChild.match(/Voir/g)?.length, 1, asChild);
// ...and our classes are on it, both the variant's and the call site's.
assert.match(asChild, /class="[^"]*inline-flex/);
assert.match(asChild, /class="[^"]*mt-4/);
assert.match(asChild, /data-slot="button"/);

// Without asChild, still a plain button carrying its children.
const plain = renderToStaticMarkup(<Button>Valider</Button>);
assert.match(plain, /^<button[^>]*>Valider<\/button>$/, plain);
assert.match(plain, /data-slot="button"/);

// Same contract on Badge, which defaults to a span.
const badge = renderToStaticMarkup(
  <Badge asChild variant="outline">
    <a href="/crew">3</a>
  </Badge>,
);
assert.equal(badge.includes("<span"), false, badge);
assert.match(badge, /href="\/crew"/);
assert.equal(badge.match(/>3</g)?.length, 1, badge);
assert.match(badge, /data-slot="badge"/);

/**
 * Two `render` layers stacked: `DropdownMenuTrigger asChild` (which is now Base
 * UI's `render` under the hood) receiving an element that is itself produced by
 * `useRender`. This is `thread-sidebar.tsx:145`, and it has to still collapse to
 * one button with the menu's trigger props merged in.
 */
const interop = renderToStaticMarkup(
  <SidebarProvider>
    <SidebarMenuButton>Ma séance</SidebarMenuButton>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction className="top-1.5 size-8" aria-label="Actions" />
      </DropdownMenuTrigger>
    </DropdownMenu>
  </SidebarProvider>,
);

assert.match(interop, /data-slot="sidebar-menu-button"[^>]*>Ma séance</, interop);
// Exactly two buttons: the menu one and `SidebarMenuButton`. This is the only
// assertion here that catches a regressed `children: undefined` guard — Base UI
// would then merge the trigger's props onto the OUTER element and render the
// child again inside, so every attribute assertion below still passes with a
// nested <button> sitting in the markup.
assert.equal(interop.match(/<button/g)?.length, 2, interop);
// The menu's own trigger props landed on our button. `data-slot` becomes
// `dropdown-menu-trigger`, because `{...props}` is spread last — that was already
// true with `Slot`, and `data-sidebar` is the attribute the CSS actually keys on.
assert.match(interop, /data-slot="dropdown-menu-trigger" data-sidebar="menu-action"/, interop);
assert.match(interop, /aria-haspopup="menu"/, interop);
assert.match(interop, /class="[^"]*top-1\.5/, interop);
// No `aria-expanded="false"` here, where Radix emitted one: Base UI adds it from
// the root's trigger props, which only attach on the client. Nothing keys on it
// in CSS, and it is back after hydration — same with and without `asChild`.

/**
 * The one DOM difference this migration introduces: Base UI writes an explicit
 * `type="button"` when it renders a `<button>`, which Radix's `Slot` did not. Not
 * visual, and strictly safer — a Button inside a form no longer submits by
 * accident. Every real submit button in the app already says `type="submit"`, and
 * an explicit `type` still wins because `{...props}` is spread last.
 */
assert.match(plain, /^<button type="button"/, plain);
assert.match(
  renderToStaticMarkup(<Button type="submit">Envoyer</Button>),
  /^<button type="submit"/,
);

console.log("ok — asChild composes to a single element, and Base UI's render can wrap it");
