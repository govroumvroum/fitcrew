"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";

/** Creates the Convex user profile on first sign-in, syncs Clerk fields after. */
export function StoreUser() {
  const { isAuthenticated } = useConvexAuth();
  const store = useMutation(api.users.store);

  useEffect(() => {
    if (isAuthenticated) void store();
  }, [isAuthenticated, store]);

  return null;
}
