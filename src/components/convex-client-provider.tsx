"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return (
    // A true Rules-of-React violation, but unavoidable: ConvexProviderWithClerk's
    // documented API takes the hook itself so it can call it internally. Not ours to fix.
    // oxlint-disable-next-line react/react-compiler
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
