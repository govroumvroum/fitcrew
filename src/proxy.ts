import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything except the landing page and Clerk's own routes needs an account.
const isPublic = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/__clerk(.*)",
  // Must be reachable signed-out, or the service worker precaches the
  // sign-in redirect as the offline fallback.
  "/~offline",
]);

// Next 16 calls this "proxy"; Clerk still names the helper middleware.
export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
