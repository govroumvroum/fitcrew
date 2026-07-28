"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Today } from "@/components/home/today";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalDate } from "@/lib/dates";

export default function Home() {
  const date = useLocalDate();

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
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

      <main className="flex flex-1 flex-col">
        <Show when="signed-out">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <h1 className="max-w-sm text-3xl font-semibold tracking-tight">
              Ton coach sportif, et la crew qui va avec.
            </h1>
            <p className="max-w-md text-muted-foreground">
              Programmes sur mesure, séances loguées en deux taps, et un classement pour se tirer la
              bourre.
            </p>
          </div>
        </Show>

        <Show when="signed-in">
          {date ? <Today date={date} /> : <Skeleton className="m-4 h-44" />}
        </Show>
      </main>
    </div>
  );
}
