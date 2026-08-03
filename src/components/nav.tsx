"use client";

import { Show } from "@clerk/nextjs";
import {
  ChartLineIcon,
  ClipboardListIcon,
  DumbbellIcon,
  HouseIcon,
  MessageCircleIcon,
  TrophyIcon,
  UtensilsCrossedIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Ordered as the app is used: today's séance, the plan behind it, the coach who
// writes it, then what came of it.
const TABS = [
  { href: "/", label: "Accueil", Icon: HouseIcon },
  { href: "/seance", label: "Séance", Icon: DumbbellIcon },
  { href: "/programme", label: "Programme", Icon: ClipboardListIcon },
  { href: "/coach", label: "Coach", Icon: MessageCircleIcon },
  { href: "/nutrition", label: "Nutrition", Icon: UtensilsCrossedIcon },
  { href: "/progres", label: "Progrès", Icon: ChartLineIcon },
  { href: "/crew", label: "Crew", Icon: TrophyIcon },
];

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

// Same readable red as the trophies — --primary as text fails contrast here.
const ACTIVE = "font-semibold text-accent-text";

/**
 * Phone navigation. Reserve --tab-bar at the bottom of a page so the bar never
 * covers content; at md+ the bar is gone and --tab-bar is 0.
 */
export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <div className="mx-auto flex w-full max-w-md">
        {TABS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] whitespace-nowrap",
                "transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
                active ? ACTIVE : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Desktop navigation: a rail, not a sidebar. /coach renders its own thread
 * sidebar against the same edge, and two wide rails side by side is a mess — so
 * this one stays icon-width. Its w-18 is echoed by the body's md:pl-18 offset in
 * layout.tsx and by the thread sidebar's md:left-18.
 */
export function NavRail() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-y-0 left-0 z-40 hidden w-18 flex-col gap-1 border-r bg-background/95 py-3 backdrop-blur md:flex">
      {TABS.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 py-2 text-center text-[11px]",
              "transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
              active ? ACTIVE : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Both navs, shown only to a signed-in user.
 *
 * The `Show` has to live on this side of the client boundary. `Show` imported
 * into a server component is Clerk's server flavour: it reads auth during the
 * render, which opts the whole tree into dynamic rendering — with this wrapper
 * inlined in the root layout, every route in the app built as ƒ, including
 * `/~offline`, whose entire job is to be a static offline fallback. Here it
 * resolves to the client flavour and reads the same state from context after
 * hydration, so the pages stay ○ and get served off the CDN.
 *
 * The trade: signed-in users get their first paint without the navs, which fade
 * in on hydration. No layout shift — the body reserves the tab bar's height and
 * the rail's width either way.
 */
export function SignedInNav() {
  return (
    <Show when="signed-in">
      <TabBar />
      <NavRail />
    </Show>
  );
}
