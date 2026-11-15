"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "@/lib/utils"

function Progress({
  className,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      {/* Base UI sizes the indicator itself (inline `width: <pct>%`), so the
          `flex-1` + `translateX` trick Radix needed is gone — and had to go:
          `flex-1` would grow the bar back to full width over that inline width.
          ponytail: no `Progress.Track` in between. It would be a third div for
          the same one-bar geometry, and `[&_[data-slot=progress-indicator]]`
          call sites keep working without it. */}
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        // ponytail: no size-full. Base UI writes `width: <value>%; height: inherit`
        // inline, and an inline style beats a class — so it was dead weight that
        // read as if it set the geometry.
        className="bg-primary transition-all"
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
