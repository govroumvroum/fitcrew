"use client"

import * as React from "react"
import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"

import { cn } from "@/lib/utils"

/**
 * Base UI calls this a PreviewCard, and it hangs the hover delays off the
 * *trigger*, not the root — Radix had them on the root. `ai-elements` (vendored)
 * passes `openDelay`/`closeDelay` to `<HoverCard>`, so the root keeps accepting
 * them and hands them down. A context rather than cloning children: the trigger
 * is not necessarily a direct child.
 */
const HoverCardDelayContext = React.createContext<{
  delay?: number
  closeDelay?: number
}>({})

function HoverCard({
  openDelay,
  closeDelay,
  ...props
}: React.ComponentProps<typeof PreviewCardPrimitive.Root> & {
  openDelay?: number
  closeDelay?: number
}) {
  const delays = React.useMemo(
    () => ({ delay: openDelay, closeDelay }),
    [openDelay, closeDelay]
  )
  return (
    <HoverCardDelayContext value={delays}>
      <PreviewCardPrimitive.Root {...props} />
    </HoverCardDelayContext>
  )
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof PreviewCardPrimitive.Trigger>) {
  const delays = React.use(HoverCardDelayContext)
  return (
    <PreviewCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      {...delays}
      {...props}
    />
  )
}

/**
 * Portal → Positioner → Popup. The positioner is where `--transform-origin`
 * lives (it inherits down to the popup) and where `z-50` has to be, since it's
 * the element the portal puts in `<body>`.
 */
function HoverCardContent({
  className,
  align = "center",
  alignOffset,
  side,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PreviewCardPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof PreviewCardPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        className="z-50"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            "z-50 w-64 origin-(--transform-origin) rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
