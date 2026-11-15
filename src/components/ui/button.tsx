import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

/**
 * Press feedback, on every control a thumb lands on. ease-out on purpose: a slow
 * start withholds movement at exactly the frame the finger touches down. Only
 * the timing is shared — the scale stays at the call site, because a 56px dock
 * button and a 12px pager tick want different travel.
 */
const PRESS_TIMING =
  "duration-[120ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"

/**
 * The same feedback for the controls that aren't Buttons — the séance pager
 * ticks and its "ce qui reste" rows are raw <button>s, so they can't inherit it
 * from the base variant below.
 */
export const PRESS = `transition-transform ${PRESS_TIMING}`

const buttonVariants = cva(
  // The property list is spelled out instead of `transition-all`: on `default`
  // that animated the gradient (background-image) and the red glow (box-shadow)
  // on the app's most-tapped button, which is paint on every hover. translate
  // and scale are named because Tailwind v4 sets them as their own properties,
  // not through `transform` — leave them out and the press dip stops animating.
  `group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,transform,translate,scale] ${PRESS_TIMING} outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
  {
    variants: {
      variant: {
        // The commit action, and the only saturated red on a screen — so it gets
        // the weight: a top-lit gradient, an inset highlight, and a short red
        // glow. Hover brightens (mixes in more white); `bg-primary/80` used to
        // dim it, which read as "disabling" on the one button you want pressed.
        default:
          "border-[color-mix(in_oklab,var(--primary)_70%,black)] bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--primary)_88%,white),var(--primary))] font-semibold tracking-[0.02em] text-primary-foreground shadow-[0_1px_0_oklch(1_0_0/25%)_inset,0_10px_24px_-14px_color-mix(in_oklab,var(--primary)_90%,transparent)] hover:bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--primary)_78%,white),color-mix(in_oklab,var(--primary)_94%,white))]",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/**
 * We keep `asChild` rather than adopting Base UI's `render` prop, on our own cva
 * components (`Button`, `Badge`, `ButtonGroupText`, the `Sidebar*` ones). Base UI
 * only asks for `render` on *its* primitives; these are ours, and `asChild` is
 * already what 19 call sites spell. Renaming the prop would touch 15 app files to
 * buy nothing but vocabulary — and every touched file is a chance to lose a class
 * string, which this migration is not allowed to do. `useRender` under the hood
 * gives us the same single-element merge Radix's `Slot` did, so the semantics are
 * unchanged.
 *
 * Note the `children: asChild ? undefined : children`: when `asChild` is set the
 * child element *is* the render target, so its own children must win. Passing our
 * `children` through would make the element its own child.
 */
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  return useRender({
    render: asChild ? (children as React.ReactElement) : undefined,
    defaultTagName: "button",
    props: {
      "data-slot": "button",
      "data-variant": variant,
      "data-size": size,
      className: cn(buttonVariants({ variant, size, className })),
      children: asChild ? undefined : children,
      ...props,
    },
  })
}

export { Button, buttonVariants }
