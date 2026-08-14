/** Self-check for the echo the chips send back into the thread.
 *  Run: `bun src/components/chat/choices.check.ts` */
import assert from "node:assert/strict";
import type { Question } from "../../../convex/choices";
import { recap } from "./choices-card";

const q = (label: string, multiple = false): Question => ({
  label,
  multiple,
  options: [],
});

// THE POINT: the agent reads the answers off the thread, so the echo has to be a
// statement — the label is a question, and « Ton objectif ? : … » reads as noise.
assert.equal(
  recap([q("Ton objectif ?"), q("Ton régime ?")], [["Prise de masse"], []]),
  "Ton objectif : prise de masse. Ton régime : je préfère t'expliquer.",
);

// An escape hatch is `[]`, NOT the same as untouched — the submit is locked until
// every question has one or the other, so `null` can't reach here in practice.
assert.equal(recap([q("Des allergies ?", true)], [[]]), "Des allergies : je préfère t'expliquer.");

// Several chips on one question come back as one list.
assert.equal(
  recap([q("Des allergies ?", true)], [["Gluten", "Lactose"]]),
  "Des allergies : gluten, lactose.",
);

// A label the model wrote without a question mark keeps its wording as is.
assert.equal(recap([q("Ton matériel")], [["Haltères"]]), "Ton matériel : haltères.");

console.log("src/components/chat choices ok");
