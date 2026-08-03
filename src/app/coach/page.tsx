import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Suspense } from "react";
import { CoachChat } from "@/components/chat/coach-chat";
import { ThreadSidebar } from "@/components/chat/thread-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

export default function CoachPage() {
  // A fixed height, not min-h: the message list scrolls inside a fixed viewport
  // so the composer stays under the thumb. The viewport stops short of the tab
  // bar. The sidebar has to be SidebarInset's sibling
  // — its desktop gap is a `peer-` selector.
  //
  // Suspense: `?thread=` is read with useSearchParams (via nuqs), which a static
  // prerender can't know, so the build fails without a boundary. The fallback is
  // the same chat shell the sidebar-less version showed while loading a thread.
  return (
    <Suspense fallback={<CoachSkeleton />}>
      <NuqsAdapter>
        <SidebarProvider className="h-[calc(100dvh-var(--tab-bar))] min-h-0">
          <ThreadSidebar />
          <SidebarInset className="min-w-0 overflow-hidden">
            <Shell>
              <CoachChat />
            </Shell>
          </SidebarInset>
        </SidebarProvider>
      </NuqsAdapter>
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  // Deliberately not as wide as the other routes: a chat line past ~70
  // characters is a chore to read, whatever the screen can fit.
  // The visible "Coach" title is a span in the chat header, and the route had no
  // h1 at all in either branch. Here rather than in either header: Shell wraps
  // both the real chat and the skeleton, so one heading covers them.
  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col md:max-w-2xl">
      <h1 className="sr-only">Coach</h1>
      {children}
    </div>
  );
}

function CoachSkeleton() {
  return (
    <main className="h-[calc(100dvh-var(--tab-bar))]">
      <Shell>
        {/* Mirrors the real header down to the 28px avatar coin: without it the
            title shifted sideways the moment the chat mounted. */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="flex items-center gap-2 font-heading text-base font-semibold tracking-[-0.01em]">
            <Skeleton className="size-7 rounded-full" />
            Coach
          </span>
          <Skeleton className="size-11" />
        </div>
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-16 w-4/5" />
          <Skeleton className="h-10 w-3/5" />
        </div>
      </Shell>
    </main>
  );
}
