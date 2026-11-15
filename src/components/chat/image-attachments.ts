import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";
import type { Id } from "../../../convex/_generated/dataModel";

/** 4 images per message; 10 MB each — a phone screenshot is 1-3 MB, a photo can be bigger. */
export const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * The composer's images, uploaded to Convex storage when the message is sent.
 *
 * The storage id travels out of band — to `send` as `storageIds`, never inside
 * the prompt — so `onNew` asks for it with `storageId(attachment.id)`. The
 * message content itself carries no image: the bubble never showed one.
 *
 * Every refusal is a thrown French sentence: assistant-ui turns it into a
 * `composer.attachmentAddError` event, and the chat toasts the message as is.
 */
export class ImageAttachments implements AttachmentAdapter {
  accept = "image/*";

  /** Added, and neither sent nor removed yet — what the limit counts. `add`
   *  runs once per file before any of them lands in the composer's state, so
   *  counting the composer's attachments would let a 5-file pick through. */
  private held = new Set<string>();
  private uploaded = new Map<string, Id<"_storage">>();

  constructor(private upload: (file: File) => Promise<Id<"_storage">>) {}

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    if (!file.type.startsWith("image/")) throw new Error("Images uniquement.");
    if (this.held.size >= MAX_IMAGES) throw new Error(`${MAX_IMAGES} images maximum.`);
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Image trop lourde (10 Mo max).");

    const id = crypto.randomUUID();
    this.held.add(id);
    return {
      id,
      type: "image",
      name: file.name,
      contentType: file.type,
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  /** At send time. A throw here puts the text back in the composer and keeps
   *  the images, so the user can retry. */
  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const storageId = await this.upload(attachment.file);
    // Still held: if another image of the same message fails, the composer
    // keeps all the tiles, and the limit has to keep counting them.
    this.uploaded.set(attachment.id, storageId);
    return { ...attachment, status: { type: "complete" }, content: [] };
  }

  async remove(attachment: { id: string }) {
    this.held.delete(attachment.id);
  }

  /** Read once by `onNew`, then forgotten — the message went out, so its
   *  images stop counting against the limit. */
  storageId(attachmentId: string) {
    const id = this.uploaded.get(attachmentId);
    this.uploaded.delete(attachmentId);
    this.held.delete(attachmentId);
    return id;
  }
}
