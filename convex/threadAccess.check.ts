/**
 * Self-check for convex/threadAccess.ts — the decision `listMessages` makes
 * before reading a conversation, and the empty answer it gives for a gone one.
 * Run: `bun convex/threadAccess.check.ts`
 */
import assert from "node:assert/strict";
import { emptyMessages, messagesAccess } from "./threadAccess";

// Missing → nothing to show, not a throw: the client still subscribes to a
// thread for a moment after deleting it, and a throw is the app's error page.
assert.equal(messagesAccess(null, "u1"), "missing");
// Mine → read it.
assert.equal(messagesAccess({ userId: "u1" }, "u1"), "owner");
// Someone else's → still throws, the same message `authorize` throws.
assert.throws(() => messagesAccess({ userId: "u2" }, "u1"), /Conversation introuvable/);
// A thread with no owner is nobody's, so not the caller's either.
assert.throws(() => messagesAccess({}, "u1"), /Conversation introuvable/);

// The page query (no streamArgs): a done, empty page, no streams — so
// `usePaginatedQuery` settles on Exhausted instead of waiting for more.
assert.deepEqual(emptyMessages(undefined), {
  page: [],
  isDone: true,
  continueCursor: "",
  streams: undefined,
});
// The two stream queries `useDeltaStreams` makes read `streams.messages` and
// `streams.deltas` without a guard: each must get the kind it asked for.
assert.deepEqual(emptyMessages({ kind: "list", startOrder: 0 }).streams, {
  kind: "list",
  messages: [],
});
assert.deepEqual(emptyMessages({ kind: "deltas", cursors: [{ streamId: "s", cursor: 0 }] }).streams, {
  kind: "deltas",
  deltas: [],
});

console.log("threadAccess ok");
