/** Self-check for the machine-turn filter. Run: `bun convex/sentinels.check.ts` */
import assert from "node:assert/strict";
import { CHEF_ATTACHMENTS, COACH_ATTACHMENTS, KICKOFF, isSentinel } from "./sentinels";

// The two turns the agents write themselves are hidden from the transcript.
assert.ok(isSentinel(KICKOFF, COACH_ATTACHMENTS));
assert.ok(isSentinel(KICKOFF, CHEF_ATTACHMENTS));
// The attachment marker is a PREFIX: `send` appends the storage ids to it.
assert.ok(isSentinel(`${COACH_ATTACHMENTS} : kg2abc, kg2def)`, COACH_ATTACHMENTS));
assert.ok(isSentinel(`${CHEF_ATTACHMENTS} : kg2abc)`, CHEF_ATTACHMENTS));
// Whitespace around a stored row must not defeat the filter.
assert.ok(isSentinel(`\n  ${KICKOFF}  \n`, CHEF_ATTACHMENTS));

// THE CASE THAT MATTERS: a real message must never be swallowed. Someone writing
// about a photo, or opening with words that resemble the kickoff, has to stay
// visible — a silently eaten user message is unexplainable from the UI.
assert.ok(!isSentinel("J'ai joint une photo de mon frigo", CHEF_ATTACHMENTS));
assert.ok(!isSentinel("le user vient d'ouvrir la conversation", CHEF_ATTACHMENTS));
assert.ok(!isSentinel(`voici ${CHEF_ATTACHMENTS}`, CHEF_ATTACHMENTS)); // prefix, not substring
assert.ok(!isSentinel("", CHEF_ATTACHMENTS));

// Each agent filters with ITS OWN prefix. Crossing them would leave the other's
// markers rendering as user bubbles — silent, and only visible in a transcript.
assert.ok(!isSentinel(`${CHEF_ATTACHMENTS} : kg2abc)`, COACH_ATTACHMENTS));
assert.ok(!isSentinel(`${COACH_ATTACHMENTS} : kg2abc)`, CHEF_ATTACHMENTS));

// The wording is stored data, so these values are effectively frozen: changing one
// makes every row already written stop matching and reappear as a user message.
// Pinned literally, so an "improvement" to the copy fails here instead of in prod.
assert.equal(KICKOFF, "(le user vient d'ouvrir la conversation)");
assert.equal(COACH_ATTACHMENTS, "(captures jointes à ce message");
assert.equal(CHEF_ATTACHMENTS, "(photos jointes à ce message");

console.log("sentinels ok");
