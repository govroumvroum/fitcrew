import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignInPage() {
  // -ml-18 cancels the body's rail offset — there's no rail when signed out.
  return (
    <div className="flex min-h-screen items-center justify-center md:-ml-18">
      {/* Clerk's <SignIn /> reads usePathname() to route its own sub-steps. Under
          Cache Components that's URL data, which has to sit inside a Suspense
          boundary or it blocks the prerender. The form streams in on the client
          either way, so there's nothing to show in the fallback. */}
      <Suspense>
        <SignIn />
      </Suspense>
    </div>
  );
}
