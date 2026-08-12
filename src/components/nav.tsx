"use client";

import { Show } from "@clerk/nextjs";
import {
  ChartLineIcon,
  ChefHatIcon,
  ClipboardListIcon,
  DumbbellIcon,
  HouseIcon,
  MessageCircleIcon,
  TargetIcon,
  TrophyIcon,
  UtensilsCrossedIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

type Destination = {
  href: string;
  /** Shown in the drawer, where there's room for a sentence. */
  label: string;
  /**
   * Shown in the desktop rail, a 72px column at 11px — a destination that reads
   * as "Mes repas" in a full-width sheet row has to be one word there.
   * Defaults to `label`.
   */
  railLabel?: string;
  Icon: typeof HouseIcon;
};

type Tab = Destination | { label: string; Icon: typeof HouseIcon; items: Destination[] };

const isGroup = (tab: Tab): tab is Extract<Tab, { items: Destination[] }> => "items" in tab;

/**
 * Ordered as the app is used: today's séance, the coach who writes the plan,
 * the chef who feeds it, then what came of it.
 *
 * Le Coach and Le Chef are two symmetrical agents, and each owns two routes: a
 * screen you read and a conversation you have. Rather than four of the six
 * slots in a phone-width bar (and /chef getting none, which is how it ended up
 * unreachable), each agent is one entry that opens a bottom drawer with its two
 * destinations. Two taps instead of one for /programme and /nutrition — the
 * accepted price; the deep links in the nutrition dashboard and the séance
 * summary still go straight there.
 *
 * One source for both navs. The bar renders the 6 entries above; the rail
 * flattens the groups (see RAIL_TABS).
 */
const TABS: Tab[] = [
  { href: "/", label: "Accueil", Icon: HouseIcon },
  { href: "/seance", label: "Séance", Icon: DumbbellIcon },
  {
    // Lucide has no whistle. TargetIcon for the objectif the coach writes the
    // plan against — MessageCircleIcon is the group's own "Discuter" row,
    // DumbbellIcon is Séance, TrophyIcon is Crew.
    label: "Le Coach",
    Icon: TargetIcon,
    items: [
      {
        href: "/programme",
        label: "Mon programme",
        railLabel: "Programme",
        Icon: ClipboardListIcon,
      },
      { href: "/coach", label: "Discuter", railLabel: "Coach", Icon: MessageCircleIcon },
    ],
  },
  {
    label: "Le Chef",
    Icon: ChefHatIcon,
    items: [
      {
        href: "/nutrition",
        label: "Mes repas",
        railLabel: "Repas",
        Icon: UtensilsCrossedIcon,
      },
      { href: "/chef", label: "Discuter", railLabel: "Chef", Icon: MessageCircleIcon },
    ],
  },
  { href: "/progres", label: "Progrès", Icon: ChartLineIcon },
  { href: "/crew", label: "Crew", Icon: TrophyIcon },
];

/**
 * The desktop rail keeps one flat link per destination — 8 items.
 *
 * Of the three options the issue left open (rail opens the same bottom drawer /
 * rail opens a side popover / rail unfolds its groups in place), this is the
 * third. A sheet rising from the bottom of the screen because you clicked a
 * rail on the left is incoherent, and a popover is a second overlay surface to
 * keep in sync with the drawer for no gain. The rail was never the constrained
 * one: the phone bar was. It has the vertical room for 8 items, it stays
 * icon-width (/coach and /chef put their own thread sidebar against the same
 * edge), and every entry stays a real `<Link>` with `aria-current="page"`.
 *
 * The cost: the bar and the rail no longer show the same number of items. TABS
 * is still the only place either is declared.
 */
const RAIL_TABS: Destination[] = TABS.flatMap((tab) => (isGroup(tab) ? tab.items : [tab]));

/**
 * An entry covers a list of routes now, not one prefix: "Le Chef" has to light
 * up on both /nutrition and /chef. Same rule per route as before — "/" only
 * matches itself, everything else matches its prefix.
 */
const isActive = (pathname: string, hrefs: string[]) =>
  hrefs.some((href) => (href === "/" ? pathname === "/" : pathname.startsWith(href)));

// Same readable red as the trophies — --primary as text fails contrast here.
const ACTIVE = "font-semibold text-accent-text";

// Shared by the bar's links and its two drawer triggers, so a <button> tab is
// the same size and shape as a <Link> one.
const TAB =
  "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] whitespace-nowrap transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)]";

/**
 * Phone navigation. Reserve --tab-bar at the bottom of a page so the bar never
 * covers content; at md+ the bar is gone and --tab-bar is 0.
 */
export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <div className="mx-auto flex w-full max-w-md">
        {TABS.map((tab) =>
          isGroup(tab) ? (
            <TabGroup key={tab.label} tab={tab} pathname={pathname} />
          ) : (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive(pathname, [tab.href]) ? "page" : undefined}
              className={cn(TAB, isActive(pathname, [tab.href]) ? ACTIVE : "text-muted-foreground")}
            >
              <tab.Icon className="size-5" aria-hidden />
              {tab.label}
            </Link>
          ),
        )}
      </div>
    </nav>
  );
}

/**
 * One agent's entry: a `<button>` opening a drawer with its two routes. Base UI
 * gives it aria-haspopup="dialog" and aria-expanded, plus aria-controls once the
 * popup exists — there's no href, so those are the whole accessible story, and
 * the label is its accessible name (the icon is aria-hidden).
 *
 * Controlled `open` on purpose — see the state below for why a boolean wasn't
 * enough. thread-sidebar.tsx has the same problem and solves it imperatively with
 * setOpenMobile(false) after picking a thread.
 */
function TabGroup({
  tab,
  pathname,
}: {
  tab: Extract<Tab, { items: Destination[] }>;
  pathname: string;
}) {
  const active = isActive(
    pathname,
    tab.items.map((item) => item.href),
  );

  // Which route the drawer was opened on, rather than a boolean. Any route change
  // therefore closes it by derivation — no effect, so no setState-in-effect and no
  // cascading render (the React Compiler rejects that, rightly).
  //
  // It has to close on more than its own links being tapped: Android's hardware
  // back, iOS swipe-back, and a deep link from behind it (nutrition's « Changer »
  // goes to /chef) all change the route without passing through them. And `open`
  // could not just live in local state — the nav never unmounts, since
  // cacheComponents keeps routes under <Activity>, hidden rather than destroyed.
  // The onClick below still earns its place: tapping a link to the route you are
  // already on changes no pathname, so nothing would close it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;

  return (
    <Drawer open={open} onOpenChange={(next) => setOpenedOn(next ? pathname : null)}>
      <DrawerTrigger className={cn(TAB, active ? ACTIVE : "text-muted-foreground")}>
        <tab.Icon className="size-5" aria-hidden />
        {tab.label}
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{tab.label}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-1 px-2 pb-2">
          {tab.items.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpenedOn(null)}
              aria-current={isActive(pathname, [href]) ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                isActive(pathname, [href]) ? ACTIVE : "text-foreground",
              )}
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
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
      {RAIL_TABS.map(({ href, label, railLabel, Icon }) => {
        const active = isActive(pathname, [href]);
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
            {railLabel ?? label}
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

export { isActive, RAIL_TABS, TABS };
