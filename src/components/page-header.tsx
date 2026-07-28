import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Every route below the home page needs a way out. Shared rather than repeated
 * per page: /seance and /progres both shipped with no navigation at all, and
 * patching them one at a time is how the second one got missed.
 *
 * /coach has its own header — it carries the sidebar trigger and the avatar.
 */
export function PageHeader({ title }: { title?: string }) {
  return (
    <header className="flex items-center gap-1 border-b px-3 py-2">
      <Button asChild variant="ghost" size="sm">
        <Link href="/">Retour</Link>
      </Button>
      {title && (
        <span className="font-heading text-base font-semibold tracking-tight">{title}</span>
      )}
    </header>
  );
}
