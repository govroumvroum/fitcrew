/**
 * Self-check for the pure selection in convex/coach.ts — `lookupHistory` and
 * `activeLineages`. Run: `bun convex/coach.check.ts`
 */
import assert from "node:assert/strict";
import { activeLineages, lookupHistory } from "./coach";

type Status = "active" | "archived" | "completed";
let t = 0;
const row = (id: string, name: string, version: number, lineageId?: string, status?: Status) => ({
  _id: id,
  _creationTime: ++t,
  name,
  version,
  ...(lineageId ? { lineageId } : {}),
  ...(status ? { status } : {}),
});

// Full body: active lineage with 3 versions (v3 is latest).
const fullBody = [
  row("fb1", "Full Body 3 jours", 1, "fb1", "active"),
  row("fb2", "Full Body 3 jours", 2, "fb1", "active"),
  row("fb3", "Full Body 3 jours", 3, "fb1", "active"),
];
// Boxe: archived lineage.
const boxe = [
  row("bx1", "Boxe explosivité", 1, "bx1", "archived"),
  row("bx2", "Boxe explosivité", 2, "bx1", "archived"),
];
// Legacy row: no lineageId, no status — the `?? _id` / `?? "active"` contract.
const legacy = [row("old1", "Programme historique", 1)];
// Completed lineage.
const done = [row("c1", "Prépa marathon", 1, "c1", "completed")];
const rows = [...fullBody, ...boxe, ...legacy, ...done];

// (a) Old version of an active lineage, by name + version.
let r = lookupHistory(rows, { name: "full body 3 jours", version: 2 });
assert.equal(r.result, "found");
if (r.result === "found") {
  assert.equal(r.row._id, "fb2");
  assert.equal(r.status, "active");
  assert.deepEqual(r.versions, [1, 2, 3]);
}

// No version asked: the latest of the lineage.
r = lookupHistory(rows, { name: "Full Body 3 jours" });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.row._id, "fb3");

// (b) Archived lineage found by substring, status explicit — never "not found".
r = lookupHistory(rows, { name: "boxe" });
assert.equal(r.result, "found");
if (r.result === "found") {
  assert.equal(r.row._id, "bx2");
  assert.equal(r.status, "archived");
}

// Completed status comes back as-is.
r = lookupHistory(rows, { name: "Prépa marathon" });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.status, "completed");

// Legacy row without lineageId/status: lineage is its own id, status defaults active.
r = lookupHistory(rows, { name: "Programme historique" });
assert.equal(r.result, "found");
if (r.result === "found") {
  assert.equal(r.lineageId, "old1");
  assert.equal(r.status, "active");
}

// Lookup by lineageId, exact version.
r = lookupHistory(rows, { lineageId: "bx1", version: 1 });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.row._id, "bx1");

// Missing version: explicit, with what DOES exist.
r = lookupHistory(rows, { name: "Boxe explosivité", version: 7 });
assert.equal(r.result, "version_not_found");
if (r.result === "version_not_found") assert.deepEqual(r.versions, [1, 2]);

// An exact hit does NOT bury its longer-named siblings: the coach's context
// only lists active programs, so « Boxe » is how it asks for an archived
// « Boxe explosivité » it can't see and can't name.
const sibling = [...rows, row("bxa", "Boxe", 1, "bxa")];
r = lookupHistory(sibling, { name: "Boxe" });
assert.equal(r.result, "found");
if (r.result === "found") {
  assert.equal(r.row._id, "bxa");
  assert.deepEqual(
    r.otherMatches.map((m) => m.name),
    ["Boxe explosivité"],
  );
}
// …including when the version asked for doesn't exist: it may well live in the
// sibling the exact match shadowed.
r = lookupHistory(sibling, { name: "Boxe", version: 2 });
assert.equal(r.result, "version_not_found");
if (r.result === "version_not_found") {
  assert.deepEqual(
    r.otherMatches.map((m) => m.name),
    ["Boxe explosivité"],
  );
}
// …and a lone exact hit carries no siblings.
r = lookupHistory(rows, { name: "Full Body 3 jours" });
if (r.result === "found") assert.deepEqual(r.otherMatches, []);

// Ambiguous name: two lineages named the same — candidates listed, none picked.
const twins = [...rows, row("fb9", "Full Body 3 jours", 1, "fb9", "archived")];
r = lookupHistory(twins, { name: "Full Body 3 jours" });
assert.equal(r.result, "ambiguous");
if (r.result === "ambiguous") {
  assert.equal(r.candidates.length, 2);
  assert.deepEqual(new Set(r.candidates.map((c) => c.lineageId)), new Set(["fb1", "fb9"]));
}
// Ambiguity doesn't drop the shadowed siblings either: « Full Body » here is
// two exact twins AND a longer-named third program.
r = lookupHistory([...twins, row("fbx", "Full Body 3 jours express", 1, "fbx")], {
  name: "Full Body 3 jours",
});
assert.equal(r.result, "ambiguous");
if (r.result === "ambiguous") {
  assert.deepEqual(
    r.otherMatches.map((m) => m.name),
    ["Full Body 3 jours express"],
  );
}
// …and disambiguated by lineageId.
r = lookupHistory(twins, { lineageId: "fb9" });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.status, "archived");

// Exact match wins over substring: "Boxe" exact must not collide with "Boxe explosivité".
const near = [...rows, row("b9", "Boxe", 1, "b9", "active")];
r = lookupHistory(near, { name: "Boxe" });
assert.equal(r.result, "found");
if (r.result === "found") assert.equal(r.lineageId, "b9");

// Unknown name: not_found, with the user's lineages listed so the coach can ask.
r = lookupHistory(rows, { name: "Yoga" });
assert.equal(r.result, "not_found");
if (r.result === "not_found") assert.equal(r.programs.length, 4);

// Foreign/garbage lineageId (user isolation is index-scoped upstream; here it
// simply matches nothing): explicit not_found, never someone else's rows.
r = lookupHistory(rows, { lineageId: "someone_elses_id" });
assert.equal(r.result, "not_found");

// No selector at all with several programs: ambiguous, not a silent pick.
r = lookupHistory(rows, {});
assert.equal(r.result, "ambiguous");

// ---------------------------------------------------------------------------
// activeLineages — what `read_programs` renders, now that the prompt doesn't.
// ---------------------------------------------------------------------------

// One row per lineage, latest version only, archived and completed dropped. The
// legacy row (no status) counts as active — that's the `?? "active"` contract.
const active = activeLineages(rows);
assert.deepEqual(
  active.map((p) => `${p.name} v${p.version}`),
  ["Programme historique v1", "Full Body 3 jours v3"],
);

// An empty lineage list is an empty result, never a fallback to "everything":
// `read_programs` says "aucun programme" and the coach must not invent one.
assert.deepEqual(activeLineages([]), []);

// Every row archived: still empty, and in particular NOT the archived rows.
assert.deepEqual(activeLineages(boxe), []);

console.log("convex/coach.ts lookupHistory + activeLineages ok");
