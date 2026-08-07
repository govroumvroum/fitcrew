import { ClerkProvider } from "@clerk/nextjs";
import { frFR } from "@clerk/localizations";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Instrument_Sans } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { StoreUser } from "@/components/store-user";
import { SignedInNav } from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Carries every number that has to line up: Instrument Sans ships `tnum`,
// the display face does not (measured from the TTF, see the redesign spec).
const instrumentSans = Instrument_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Display face for headings and big numbers. Condensed signage cap, which is
// what the logo wordmark actually is — Archivo, a normal-width grotesque, never
// echoed it. Drawn to be read at distance: a phone on a bench.
// Google folded "Big Shoulders Display" into the `Big Shoulders` family, which
// is where the display cut now lives — hence the shorter export name.
const bigShoulders = Big_Shoulders({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  // No condensed system stack exists worth naming, so Arial Narrow carries the
  // fallback. Next has no metrics override for the renamed family either, hence
  // the build warning — a heading swap, not a layout shift on body text.
  fallback: ["Arial Narrow", "Impact", "sans-serif"],
});

export const metadata: Metadata = {
  // Absolute base for og:image & friends — relative URLs break link previews.
  metadataBase: new URL("https://fitcrew.basilevernouillet.com"),
  title: "FitCrew",
  description: "Coach sportif IA pour la crew.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FitCrew", statusBarStyle: "black-translucent" },
  // og:image itself comes from src/app/opengraph-image.png (file convention).
  openGraph: { type: "website", locale: "fr_FR", siteName: "FitCrew" },
  twitter: { card: "summary_large_image" },
};

// Matches --background so the PWA shell doesn't flash white.
export const viewport: Viewport = {
  themeColor: "#0a0f1f",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // ponytail: dark-only — gyms are dim. Add a theme toggle if anyone asks.
    <html
      lang="fr"
      className={`dark ${instrumentSans.variable} ${bigShoulders.variable} h-full antialiased`}
    >
      {/* pl-18 clears the rail at md+. Padding rather than a flex sibling: the
          rail is fixed, so pages keep their own scrolling and full height, and
          /coach's own fixed sidebar only needs its left edge moved to match. */}
      <body className="min-h-full flex flex-col pt-[var(--safe-top)] md:pl-18">
        <ClerkProvider localization={frFR} appearance={{ theme: shadcn }}>
          <ConvexClientProvider>
            <StoreUser />
            {children}
            <SignedInNav />
            {/* Lifted clear of the tab bar: toasts render bottom-anchored at a
                higher z-index and would otherwise sit on top of it. */}
            <Toaster offset={{ bottom: "calc(var(--tab-bar) + 0.5rem)" }} />
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
