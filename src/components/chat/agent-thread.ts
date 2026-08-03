"use client";

import { useQuery } from "convex/react";
import { useQueryState } from "nuqs";
import { api } from "../../../convex/_generated/api";
import { useLocalDayStart } from "@/lib/dates";

/**
 * The Convex surface a chat agent has to expose for the shared shell to drive it.
 *
 * Spelled as `typeof api.coach` rather than eight hand-written FunctionReferences:
 * the contract says the Chef is the same eight functions with the same
 * signatures, so structural assignability IS that check — `api.chef` stops
 * compiling at the call site the day the two drift apart, which is exactly when
 * we want to hear about it. Writing the references out by hand would let them
 * drift silently, and `useUIMessages`' expected query shape is not something you
 * want to restate.
 */
export type AgentApi = typeof api.coach;

/**
 * Which conversation is open, shared by a chat and its sidebar.
 *
 * `?thread=` wins so a link always opens the conversation it names; without it
 * the daily rollover picks today's thread (or none, and the chat opens one).
 * Both callers pass the same args to the same query, so Convex serves one
 * subscription — no need to thread this through props.
 *
 * The `thread` param key is shared by /coach and /chef, which is harmless: they
 * are different routes, so a URL only ever carries one agent's thread id.
 */
export function useAgentThread(agent: AgentApi) {
  const [selected, setSelected] = useQueryState("thread");
  const dayStart = useLocalDayStart();
  const rollover = useQuery(agent.thread, dayStart && !selected ? { dayStart } : "skip");

  return {
    threadId: selected ?? rollover?.threadId ?? undefined,
    /** null until the profile row exists; `{threadId: null}` means "never talked". */
    rollover,
    dayStart,
    select: setSelected,
  };
}
