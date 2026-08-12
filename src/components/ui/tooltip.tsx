"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/**
 * `Provider` and `Root` render no DOM element on either library, so the
 * `data-slot="tooltip-provider"` / `data-slot="tooltip"` they used to carry never
 * reached the document — Radix dropped unknown props on those parts too. Base UI
 * types them, so they're gone rather than silently ignored.
 *
 * Radix's `delayDuration` is Base UI's `delay`; same unit, same meaning.
 */
function TooltipProvider({
  delay = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

/**
 * `asChild` kept on purpose: `sidebar.tsx`, `ai-elements/message.tsx` and
 * `ai-elements/prompt-input.tsx` all write `<TooltipTrigger asChild>`, and the
 * last two are vendored. It maps straight onto Base UI's `render`, which is the
 * same "become this element" contract — note the `children: undefined`, without
 * it the child would be rendered twice (once as the element, once as its own
 * child).
 */
function TooltipTrigger({
  asChild,
  children,
  render,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger> & {
  asChild?: boolean
}) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      render={asChild ? (children as React.ReactElement) : render}
      {...props}
    >
      {asChild ? undefined : children}
    </TooltipPrimitive.Trigger>
  )
}

/**
 * Positioning moved off the popup onto its own `Positioner` element, which sits
 * between the portal and the popup and is where Base UI writes
 * `--transform-origin` (and `--available-width/height`, `--anchor-width/height`).
 * They inherit, so the popup's `origin-(--transform-origin)` still resolves.
 *
 * `z-50` has to be on the positioner: it, not the popup, is the element the
 * portal drops into `<body>`, so it's what stacks against the rest of the app.
 *
 * The dropped `data-[state=delayed-open]:*` triple was Radix-only. Radix never
 * set `data-state="open"` on a tooltip — it said `delayed-open` or
 * `instant-open` — so those three classes were what actually animated a hover
 * tooltip in, and `data-open:` matched nothing. Base UI writes `data-open`, so
 * the identical `data-open:animate-in fade-in-0 zoom-in-95` already on the
 * string now does that job. `data-instant:animate-none` restores the other half
 * of Radix's split: no animation when the tooltip appears without waiting
 * (keyboard focus, or a dismiss), which was `instant-open`.
 */
function TooltipContent({
  className,
  side = "top",
  sideOffset = 0,
  align = "center",
  alignOffset,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof TooltipPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        className="z-50"
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-instant:animate-none",
            className
          )}
          {...props}
        >
          {children}
          {/* The per-side classes are new, and they are not decoration. Radix
              wrapped its arrow in a span it positioned on every axis, so our one
              `translate-y` was a nudge on top of a correct position. Base UI puts
              the classes on the positioned element itself and only solves the
              cross axis — measured, a `side="right"` tooltip (the sidebar's) left
              the arrow sitting *inside* the bubble on top of the label. These
              push it back out to the edge it points from. */}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
