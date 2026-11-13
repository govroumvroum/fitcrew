"use client";

import { useQuery } from "convex/react";
import { Today, TodaySkeleton } from "@/components/home/today";
import { FirstSteps, useRecordInstall } from "@/components/onboarding/first-steps";
import { Welcome } from "@/components/onboarding/welcome";
import { api } from "../../../convex/_generated/api";

/**
 * The signed-in home: the welcome for a new account, today's screen otherwise.
 *
 * The skeleton holds until `welcome.state` is in, on purpose — rendering Today
 * first would flash the six-tab app at a newcomer before covering it, and pop
 * the card in under an old hand's thumb.
 */
export function SignedInHome({ date }: { date: string | null }) {
  const state = useQuery(api.welcome.state);
  useRecordInstall(state);

  if (state === undefined || !date) return <TodaySkeleton />;
  if (state?.welcome) return <Welcome />;
  return <Today date={date} firstSteps={state ? <FirstSteps state={state} /> : null} />;
}
