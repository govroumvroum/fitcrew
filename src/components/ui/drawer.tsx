"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bottom sheet with drag-to-dismiss. API taken from the shadcn `base-nova`
 * registry entry (`@base-ui/react/drawer`); the class strings are ours, lifted
 * from `sheet.tsx` so the two bottom surfaces in the app look like siblings.
 *
 * The issue that asked for this warned about two overlay managers fighting over
 * `body` — Base UI's scroll lock against Radix's. That trap is gone: the UI
 * layer moved to `@base-ui/react` and `radix-ui` was removed, so this drawer
 * and the thread sidebar's Sheet share one scroll lock and one focus stack.
 *
 * Trimmed on purpose vs. the registry: the swipe direction is fixed to `down`,
 * so only the down-direction rules ship, and there are no snap points, no
 * nested-drawer stacking and no horizontal axis. That's ~10 lines of custom
 * properties per part we don't pay for. Copy them back from the registry if a
 * second drawer ever needs them.
 */
function Drawer({
  ...props
}: Omit<DrawerPrimitive.Root.Props, "swipeDirection" | "snapPoints">) {
  return <DrawerPrimitive.Root swipeDirection="down" {...props} />;
}

/**
 * Renders a `<button>`, and Base UI puts `aria-haspopup="dialog"` and
 * `aria-expanded` on it, plus `aria-controls` once the popup is mounted (not
 * while closed — the id would dangle). A tab that opens this instead of
 * navigating has no `href`, so those are the whole accessible story.
 */
function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

/**
 * The backdrop has to cover the z-40 tab bar, and stay under the thread
 * sidebar's mobile Sheet (z-index 50), which can be open at the same time on
 * /coach and /chef — hence z-45 on all three portalled elements.
 *
 * `supports-[-webkit-touch-callout:none]:absolute` is the iOS fix the registry
 * ships and we keep: `position: fixed` on the backdrop leaves a strip of page
 * showing when Safari's URL bar collapses, `absolute` + `min-h-dvh` doesn't.
 */
function DrawerOverlay({ className, ...props }: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-45 min-h-dvh bg-black/10 opacity-[calc(1-var(--drawer-swipe-progress,0))] transition-opacity duration-450 ease-[cubic-bezier(0.32,0.72,0,1)] select-none supports-backdrop-filter:backdrop-blur-xs supports-[-webkit-touch-callout:none]:absolute data-starting-style:opacity-0 data-ending-style:pointer-events-none data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)] data-swiping:duration-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Popup inside Viewport is mandatory — without the viewport Base UI logs an
 * error and silently drops swipe handling and touch scroll locking.
 *
 * Enter/exit is a `transition` on `transform`, not the `animate-in` keyframes
 * `sheet.tsx` uses: the same `transform` carries `--drawer-swipe-movement-y`
 * while the finger drags, and a keyframe would overwrite the drag offset
 * mid-gesture. `--closed-transform` is the off-screen end state Base UI
 * transitions to and from via `data-starting-style` / `data-ending-style`.
 *
 * `pb-[max(...)]` is the same safe-area reservation the tab bar makes
 * (`nav.tsx`): the sheet covers the bar, so it inherits the bar's job of
 * keeping content off the iOS home indicator.
 */
function DrawerContent({
  className,
  children,
  ...props
}: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.Portal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className="pointer-events-auto fixed inset-0 z-45 select-none"
      >
        <DrawerPrimitive.Popup
          data-slot="drawer-popup"
          className={cn(
            "pointer-events-auto fixed inset-x-0 bottom-0 z-45 flex max-h-[calc(100dvh-6rem)] min-h-0 flex-col rounded-t-xl border-t bg-popover bg-clip-padding pb-[max(0.5rem,env(safe-area-inset-bottom))] text-sm text-popover-foreground shadow-lg outline-none select-none",
            "transform-[translate3d(0,var(--drawer-swipe-movement-y,0px),0)] transition-transform duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform data-swiping:duration-0",
            "[--closed-transform:translate3d(0,calc(100%+2px),0)] data-starting-style:transform-(--closed-transform) data-ending-style:transform-(--closed-transform) data-ending-style:duration-[calc(var(--drawer-swipe-strength)*400ms)]",
            // Rubber-banding past the bottom edge would otherwise show the page
            // through the gap it opens.
            "after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-12 after:bg-popover",
            className,
          )}
          {...props}
        >
          <div
            data-slot="drawer-swipe-handle"
            aria-hidden
            className="flex h-3 w-full shrink-0 cursor-grab items-end justify-center after:block after:h-1 after:w-24 after:shrink-0 after:rounded-full after:bg-muted active:cursor-grabbing"
          />
          <DrawerPrimitive.Content
            data-slot="drawer-content"
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-[inherit] select-text"
          >
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex shrink-0 flex-col gap-0.5 p-4 pb-2", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-heading text-base font-medium text-foreground", className)}
      {...props}
    />
  );
}

export { Drawer, DrawerContent, DrawerHeader, DrawerOverlay, DrawerTitle, DrawerTrigger };
