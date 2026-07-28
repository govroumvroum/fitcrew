"use client";

import { ChartLineIcon, DumbbellIcon, HouseIcon, MessageCircleIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Accueil", Icon: HouseIcon },
  { href: "/seance", label: "Séance", Icon: DumbbellIcon },
  { href: "/coach", label: "Coach", Icon: MessageCircleIcon },
  { href: "/progres", label: "Progrès", Icon: ChartLineIcon },
];

/** Reserve --tab-bar at the bottom of a page so the bar never covers content. */
export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto flex w-full max-w-md">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
                // Same lightened brand hue as the trophies — plain red fails
                // contrast on our background.
                active
                  ? "font-semibold text-[oklch(0.8_0.086_27.255)]"
                  : "text-muted-foreground",
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
