"use client";

import { useUser } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import posthog from "posthog-js";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";

/** Creates the Convex user profile on first sign-in, syncs Clerk fields after. */
export function StoreUser() {
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const store = useMutation(api.users.store);

  useEffect(() => {
    if (isAuthenticated) void store();
  }, [isAuthenticated, store]);

  // Without this, every session is an anonymous device. No email or name: the
  // Clerk id is enough to tell the crew apart, and PostHog doesn't need more.
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    if (user) posthog.identify(user.id);
    // Signed out: drop the id so the next person on this phone isn't recorded
    // as the previous one.
    else posthog.reset();
  }, [user]);

  return null;
}
