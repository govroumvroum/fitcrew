import { CoachChat } from "@/components/chat/coach-chat";

export default function CoachPage() {
  // h-dvh, not flex-1: the message list scrolls inside a fixed viewport so the
  // composer stays under the thumb.
  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <CoachChat />
    </main>
  );
}
