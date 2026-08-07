import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignUpPage() {
  // -ml-18 cancels the body's rail offset — there's no rail when signed out.
  return (
    <div className="flex min-h-[calc(100dvh-var(--safe-top))] items-center justify-center md:-ml-18">
      {/* Same as /sign-in: Clerk reads usePathname(), so it needs a Suspense
          boundary under Cache Components. */}
      <Suspense>
        <SignUp />
      </Suspense>
    </div>
  );
}
