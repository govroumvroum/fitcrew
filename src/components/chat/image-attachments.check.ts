/** Self-check for image-attachments.ts's 4-image limit. Run: `bun src/components/chat/image-attachments.check.ts` */
import assert from "node:assert/strict";
import type { Id } from "../../../convex/_generated/dataModel";
import { ImageAttachments, MAX_IMAGES } from "./image-attachments";

const png = (name: string) => new File([new Uint8Array(8)], name, { type: "image/png" });
const refused = (p: Promise<unknown>) => assert.rejects(p, /images maximum/);

// The composer keeps every tile when a message fails to go out — one failed
// upload out of four leaves four tiles. The limit must still count four, or the
// next pick lets a fifth through and the retry posts more than MAX_IMAGES.
{
  let n = 0;
  const adapter = new ImageAttachments(async () => {
    n += 1;
    if (n === 4) throw new Error("upload failed");
    return `storage-${n}` as Id<"_storage">;
  });
  const tiles = [];
  for (let i = 0; i < MAX_IMAGES; i++) tiles.push(await adapter.add({ file: png(`${i}.png`) }));
  await refused(adapter.add({ file: png("extra.png") }));

  const results = await Promise.allSettled(tiles.map((t) => adapter.send(t)));
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  await refused(adapter.add({ file: png("after-failure.png") }));
}

// A message that does go out frees every slot, through `storageId` — what
// `onNew` reads once per attachment.
{
  let n = 0;
  const adapter = new ImageAttachments(async () => `storage-${++n}` as Id<"_storage">);
  const tiles = [];
  for (let i = 0; i < MAX_IMAGES; i++) tiles.push(await adapter.add({ file: png(`${i}.png`) }));
  for (const t of tiles) await adapter.send(t);
  for (const t of tiles) assert.ok(adapter.storageId(t.id));
  await adapter.add({ file: png("next-message.png") });
}

// Removing a tile frees its slot.
{
  const adapter = new ImageAttachments(async () => "s" as Id<"_storage">);
  const tiles = [];
  for (let i = 0; i < MAX_IMAGES; i++) tiles.push(await adapter.add({ file: png(`${i}.png`) }));
  await adapter.remove(tiles[0]);
  await adapter.add({ file: png("replacement.png") });
}

console.log("image-attachments: ok");
