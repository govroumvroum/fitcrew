import { ClerkProvider, Show } from "@clerk/nextjs";
import { frFR } from "@clerk/localizations";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata, Viewport } from "next";
import { Archivo, Geist } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { StoreUser } from "@/components/store-user";
import { NavRail, TabBar } from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Display face for headings and big numbers — echoes the logo wordmark.
const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "FitCrew",
  description: "Coach sportif IA pour la crew.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FitCrew", statusBarStyle: "black-translucent" },
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
      className={`dark ${geistSans.variable} ${archivo.variable} h-full antialiased`}
    >
      {/* pl-18 clears the rail at md+. Padding rather than a flex sibling: the
          rail is fixed, so pages keep their own scrolling and full height, and
          /coach's own fixed sidebar only needs its left edge moved to match. */}
      <body className="min-h-full flex flex-col md:pl-18">
        <ClerkProvider localization={frFR} appearance={{ theme: shadcn }}>
          <ConvexClientProvider>
            <StoreUser />
            {children}
            <Show when="signed-in">
              <TabBar />
              <NavRail />
            </Show>
            {/* Lifted clear of the tab bar: toasts render bottom-anchored at a
                higher z-index and would otherwise sit on top of it. */}
            <Toaster offset={{ bottom: "calc(var(--tab-bar) + 0.5rem)" }} />
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
