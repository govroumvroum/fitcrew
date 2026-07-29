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
  if (isPublic(req)) return;

  // `unauthenticatedUrl` is passed explicitly: bare `auth.protect()` rewrote to
  // /_not-found in production, so a signed-out visitor got a 404 instead of the
  // sign-in page — confirmed by `x-clerk-auth-reason: protect-rewrite`. Clerk
  // does that deliberately, to avoid revealing which routes exist, but here
  // every route is known and a 404 just looks broken.
  //
  // redirect_url carries where they were headed, so a link to /programme shared
  // with the crew lands on /programme after signing in, not on the home page.
  const signIn = new URL("/sign-in", req.url);
  signIn.searchParams.set("redirect_url", req.url);
  await auth.protect({ unauthenticatedUrl: signIn.toString() });
});

export const config = {
  matcher: [
    // Skip Next internals and static files unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
