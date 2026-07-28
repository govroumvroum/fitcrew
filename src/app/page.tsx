"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { api } from "../../convex/_generated/api";

export default function Home() {
  const me = useQuery(api.users.me);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-heading text-lg font-semibold tracking-tight">FitCrew</span>
        <Show when="signed-out">
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm">
                Connexion
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button size="sm">Rejoindre</Button>
            </SignUpButton>
          </div>
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <Show when="signed-out">
          <h1 className="max-w-sm text-3xl font-semibold tracking-tight">
            Ton coach sportif, et la crew qui va avec.
          </h1>
          <p className="max-w-md text-muted-foreground">
            Programmes sur mesure, séances loguées en deux taps, et un classement pour se tirer la
            bourre.
          </p>
        </Show>

        <Show when="signed-in">
          <h1 className="text-2xl font-semibold tracking-tight">
            {me === undefined
              ? "Connexion à Convex…"
              : me === null
                ? "Profil en cours de création…"
                : `Salut ${me.name} 💪`}
          </h1>
          <p className="text-muted-foreground">
            {me?.onboarding
              ? "Ton programme arrive."
              : "Prochaine étape : la séance avec le coach."}
          </p>
        </Show>
      </main>
    </div>
  );
}
