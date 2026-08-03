import type { Metadata } from "next";
import { ToolGallery } from "@/components/chat/tool-gallery";

/**
 * Harnais de design : toutes les cartes d'outil des deux agents, dans leurs
 * quatre états, sans avoir à faire parler un modèle. Volontairement absent de
 * `nav.tsx` — on y arrive par l'URL.
 */
export const metadata: Metadata = { title: "Galerie des cartes — FitCrew" };

export default function DemoPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-4 pb-[calc(var(--tab-bar)+1rem)] md:max-w-3xl lg:max-w-6xl">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-semibold tracking-[-0.01em]">
          Galerie des cartes d&apos;outil
        </h1>
        <p className="text-sm text-muted-foreground">
          Toutes les cartes du Coach et du Chef, dans leurs quatre états, générées depuis les vraies
          configs. Rien ici n&apos;est réel : ce sont des fixtures, aucune donnée n&apos;est lue ni
          écrite. Page de revue, accessible par URL uniquement.
        </p>
      </div>
      <ToolGallery />
    </main>
  );
}
