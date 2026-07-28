"use client";

import { useQuery } from "convex/react";
import { useQueryState } from "nuqs";
import { api } from "../../../convex/_generated/api";
import { useLocalDayStart } from "@/lib/dates";

/**
 * Which conversation is open, shared by the chat and its sidebar.
 *
 * `?thread=` wins so a link always opens the conversation it names; without it
 * the daily rollover picks today's thread (or none, and the chat opens one).
 * Both callers pass the same args to the same query, so Convex serves one
 * subscription — no need to thread this through props.
 */
export function useCoachThread() {
  const [selected, setSelected] = useQueryState("thread");
  const dayStart = useLocalDayStart();
  const coachThread = useQuery(api.coach.thread, dayStart && !selected ? { dayStart } : "skip");

  return {
    threadId: selected ?? coachThread?.threadId ?? undefined,
    /** null until the profile row exists; `{threadId: null}` means "never talked". */
    rollover: coachThread,
    dayStart,
    select: setSelected,
  };
}
