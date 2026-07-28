"use client";

import { useMutation, usePaginatedQuery } from "convex/react";
import { MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useCoachThread } from "@/components/chat/use-coach-thread";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { formatFull } from "@/lib/dates";

type Thread = { _id: string; _creationTime: number; title: string | null };

const DAY = 86_400_000;

/** `formatFull` wants a storage key, and the key has to be built from the local
 *  getters — a UTC one would file a 23h30 conversation under tomorrow. */
function dayLabel(creationTime: number, dayStart: number) {
  if (creationTime >= dayStart) return "Aujourd'hui";
  if (creationTime >= dayStart - DAY) return "Hier";
  const d = new Date(creationTime);
  const pad = (n: number) => String(n).padStart(2, "0");
  return formatFull(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
}

function groupByDay(threads: Thread[], dayStart: number) {
  const groups: { label: string; threads: Thread[] }[] = [];
  for (const thread of threads) {
    const label = dayLabel(thread._creationTime, dayStart);
    const last = groups.at(-1);
    if (last?.label === label) last.threads.push(thread);
    else groups.push({ label, threads: [thread] });
  }
  return groups;
}

export function ThreadSidebar() {
  const { threadId: currentThreadId, dayStart, select: setSelected } = useCoachThread();
  const { setOpenMobile } = useSidebar();
  const newThread = useMutation(api.coach.newThread);
  const deleteThread = useMutation(api.coach.deleteThread);
  const [renaming, setRenaming] = useState<Thread | null>(null);

  const { results, status, loadMore } = usePaginatedQuery(
    api.coach.threads,
    {},
    { initialNumItems: 25 },
  );

  // dayStart is null on the server and the first paint; without it "Aujourd'hui"
  // would be a guess, so the list waits one tick rather than mislabel a day.
  const groups = dayStart === null ? [] : groupByDay(results, dayStart);

  function select(threadId: string) {
    void setSelected(threadId);
    setOpenMobile(false);
  }

  async function create() {
    setOpenMobile(false);
    try {
      select(await newThread());
    } catch {
      toast.error("Impossible d'ouvrir une nouvelle conversation.");
    }
  }

  async function remove(thread: Thread) {
    try {
      await deleteThread({ threadId: thread._id });
      // Dropping the param falls back to the daily rollover, which will pick the
      // newest remaining thread or open a fresh one.
      if (thread._id === currentThreadId) void setSelected(null);
    } catch {
      toast.error("La suppression a échoué.");
    }
  }

  return (
    <>
      {/* The panel is `fixed left-0`, which ignores the body's rail padding, so
          the rail would sit on top of the thread titles. Nudged by the rail's
          width with a transform, not `left`: the shadcn `left-*` classes are
          data-attribute-scoped (higher specificity) and there are two of them —
          open and off-canvas — so a transform shifts both without a fight.
          Below md there is no rail and no offset. */}
      <Sidebar className="md:translate-x-18">
        <SidebarHeader>
          <Button className="h-11 justify-start" variant="outline" onClick={() => void create()}>
            <PlusIcon />
            Nouvelle conversation
          </Button>
        </SidebarHeader>

        <SidebarContent>
          {groups.length === 0 && status !== "LoadingFirstPage" ? (
            <p className="px-4 py-6 text-sm text-sidebar-foreground/70">
              Pas encore de conversation. Écris au coach, elle apparaîtra ici.
            </p>
          ) : (
            groups.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel className="capitalize">{group.label}</SidebarGroupLabel>
                <SidebarMenu>
                  {group.threads.map((thread) => (
                    <SidebarMenuItem key={thread._id}>
                      <SidebarMenuButton
                        className="h-11"
                        isActive={thread._id === currentThreadId}
                        onClick={() => select(thread._id)}
                      >
                        <span>{thread.title ?? "Nouvelle conversation"}</span>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction className="top-1.5 size-8" aria-label="Actions">
                            <MoreHorizontalIcon />
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" side="right">
                          <DropdownMenuItem onSelect={() => setRenaming(thread)}>
                            <PencilIcon />
                            Renommer
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => void remove(thread)}
                          >
                            <Trash2Icon />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))
          )}
          {status === "CanLoadMore" && (
            <Button variant="ghost" size="sm" className="mx-2 mb-2" onClick={() => loadMore(25)}>
              Plus anciennes
            </Button>
          )}
        </SidebarContent>
      </Sidebar>

      {/* Outside <Sidebar>: on mobile that's a Sheet, and a dialog nested in it
          fights the sheet for focus and the overlay. */}
      <RenameDialog thread={renaming} onClose={() => setRenaming(null)} />
    </>
  );
}

function RenameDialog({ thread, onClose }: { thread: Thread | null; onClose: () => void }) {
  const rename = useMutation(api.coach.renameThread);

  return (
    <Dialog open={thread !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renommer</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const title = new FormData(event.currentTarget).get("title") as string;
            if (thread && title.trim()) {
              void rename({ threadId: thread._id, title: title.trim() }).catch(() =>
                toast.error("Le renommage a échoué."),
              );
            }
            onClose();
          }}
        >
          {/* key: remounts the input so it picks up the new thread's title */}
          <Input
            key={thread?._id}
            name="title"
            defaultValue={thread?.title ?? ""}
            className="text-base sm:text-sm"
            maxLength={80}
          />
          <DialogFooter>
            <Button type="submit" className="h-11">
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
