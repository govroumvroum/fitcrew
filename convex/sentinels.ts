/**
 * The machine-written "user" turns an agent puts in its own thread.
 *
 * There are two: the kickoff that makes the agent speak first, and the marker
 * naming the images attached to a message. Both ARE persisted — the agent
 * component treats the last `messages` entry as the prompt, and
 * `storageOptions.saveMessages: "none"` would drop the reply along with it. So
 * `listMessages` hides them at read time instead, which also cleans up the threads
 * that already have the rows. Hiding is display-only: later turns still replay
 * them to the model, which is why the attachment marker exists at all.
 *
 * ---
 *
 * THESE STRINGS ARE DATA, NOT COPY. Editing one is a migration, not a rename.
 *
 * The filter recognises a machine turn by comparing stored text against the
 * constant below. Every row already written holds the OLD string, so changing the
 * wording makes every historical machine turn stop matching and reappear in old
 * threads as if the user had typed it. That is the trap this module exists to
 * document — it is not "one fix point when the wording changes", because the
 * wording cannot safely change at all without rewriting the stored rows first.
 *
 * The mechanism is shared; the wording is not. `KICKOFF` happens to be identical
 * for both agents, but each keeps its own attachment prefix — the Coach reads
 * "captures" (fitness-app screenshots), the Chef reads "photos" (a plate, a
 * fridge) — and that difference reaches the model, which has to pick a different
 * tool in each case.
 */

export const KICKOFF = "(le user vient d'ouvrir la conversation)";

/**
 * Both prefixes, not whole strings: `send` appends the storage ids to them.
 * Exported separately rather than as one union so a call site can't accidentally
 * filter the Chef's threads with the Coach's prefix — the failure would be silent
 * and would only show up as stray bubbles in the transcript.
 */
export const COACH_ATTACHMENTS = "(captures jointes à ce message";
export const CHEF_ATTACHMENTS = "(photos jointes à ce message";

/**
 * Is this stored user text one of the machine turns, and therefore hidden?
 *
 * `startsWith` on the attachment prefix, not equality: the ids follow it. Exported
 * for the self-check, which pins the one case that matters — a real user message
 * that merely mentions a photo must NOT be swallowed.
 */
export function isSentinel(text: string, attachmentsPrefix: string) {
  const trimmed = text.trim();
  return trimmed === KICKOFF || trimmed.startsWith(attachmentsPrefix);
}
