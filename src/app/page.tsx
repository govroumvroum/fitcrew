"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { Today, TodaySkeleton } from "@/components/home/today";
import { Button } from "@/components/ui/button";
import { useLocalDate } from "@/lib/dates";

export default function Home() {
  const date = useLocalDate();

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col md:max-w-4xl">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-heading text-lg font-semibold tracking-[-0.01em]">FitCrew</span>
        <Show when="signed-out">
          {/* h-11, like every other tappable button in the app: size="sm" is
              28px, and these two are the front door on a phone. */}
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <Button variant="ghost" className="h-11 px-4">
                Connexion
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button className="h-11 px-4">Rejoindre</Button>
            </SignUpButton>
          </div>
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </header>

      <main className="flex flex-1 flex-col">
        <Show when="signed-out">
          {/* -ml-18 cancels the body's rail offset: signed out there is no rail,
              and the landing page has to be centred on the screen, not 72px
              right of it. Cheaper than gating the layout's padding on auth. */}
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center md:-ml-18">
            <h1 className="max-w-sm text-3xl font-semibold">
              Ton coach sportif, et la crew qui va avec.
            </h1>
            <p className="max-w-md text-muted-foreground">
              Programmes sur mesure, séances loguées en deux taps, et un classement pour se tirer la
              bourre.
            </p>
          </div>
        </Show>

        <Show when="signed-in">
          {/* The document heading, sr-only: the visible top-of-page label is the
              FitCrew wordmark, which names the app on every route rather than
              this page, and Today's biggest heading is the day name (an <h2>).
              So the level-1 has to exist without changing a pixel. */}
          <h1 className="sr-only">Aujourd&apos;hui</h1>
          {date ? <Today date={date} /> : <TodaySkeleton />}
        </Show>
      </main>
    </div>
  );
}
