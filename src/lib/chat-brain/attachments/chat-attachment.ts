/**
 * Chat attachment schema.
 *
 * The client sends `attachments: ChatAttachment[]` on the chat POST
 * body. The server validates each entry, then forwards them to
 * Anthropic as multimodal `image` content blocks alongside the user's
 * text message.
 *
 * Turn 3 supports IMAGE attachments only. Audio / video / file-PDF
 * attachments are out of scope for this turn — the schema is
 * extensible (the `kind` discriminator makes adding new types
 * non-breaking).
 *
 * # Sources
 *
 * Two source types:
 *
 *   - `url` — a publicly-accessible HTTPS URL. Anthropic fetches it
 *     server-side. Cheapest; no encoding needed. Used for the user's
 *     uploaded reference image (which lives on Supabase Storage with
 *     a public URL).
 *
 *   - `base64` — inline base64-encoded bytes + media type. Used when
 *     the image isn't yet uploaded to Storage (e.g. drag-drop into
 *     chat that we don't bother persisting). Bigger payload but no
 *     external fetch needed.
 *
 * # Caps
 *
 *   - Max 4 attachments per message. Tighter than eva's 8 because
 *     vision usage costs add up fast and the chat dock UX doesn't
 *     work well with more than a few image thumbnails per turn.
 *
 *   - URL strings capped at 4096 chars (covers Supabase signed URLs
 *     with all their query params).
 *
 *   - Base64 strings capped at 7 MB worth (~5 MB raw image). Above
 *     that, the user should upload to Storage and pass a URL.
 *
 * # Anthropic content shape
 *
 * `chatAttachmentToAnthropicContent` returns the `image` content
 * block format Anthropic's API expects:
 *
 *     { type: "image", source: { type: "url" | "base64", ... } }
 *
 * The server prepends user message text as a `text` block, then
 * spreads the image blocks after — matching Anthropic's documented
 * order for multimodal turns.
 */

import { z } from "zod";

const MAX_URL_LEN = 4096;
const MAX_BASE64_LEN = 7 * 1024 * 1024; // ≈5 MB raw image

export const ChatAttachmentImageUrlSchema = z.object({
  kind: z.literal("image"),
  source: z.object({
    type: z.literal("url"),
    url: z.url().max(MAX_URL_LEN),
  }),
  /** Optional caption the user provided. Forwarded to the prompt
   *  block but NOT to Anthropic (Anthropic infers from the image). */
  caption: z.string().max(400).optional(),
});

export const ChatAttachmentImageBase64Schema = z.object({
  kind: z.literal("image"),
  source: z.object({
    type: z.literal("base64"),
    /** Standard image media types Anthropic accepts. */
    media_type: z.enum([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ]),
    data: z.string().max(MAX_BASE64_LEN),
  }),
  caption: z.string().max(400).optional(),
});

export const ChatAttachmentSchema = z.union([
  ChatAttachmentImageUrlSchema,
  ChatAttachmentImageBase64Schema,
]);

export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>;

export const ChatAttachmentsArraySchema = z.array(ChatAttachmentSchema).max(4);

/**
 * Validate a raw attachments array. Returns either the typed array
 * or an error response. Mirrors the studio-snapshot normalizer
 * pattern.
 */
export function validateChatAttachments(
  raw: unknown,
):
  | { ok: true; attachments: ChatAttachment[] }
  | { ok: false; reason: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, attachments: [] };
  }
  const parsed = ChatAttachmentsArraySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.flatten().formErrors.join("; ") || "invalid attachments",
    };
  }
  return { ok: true, attachments: parsed.data };
}

/**
 * Convert a validated chat attachment into the Anthropic content
 * block format. The route's stream call spreads these into the
 * `messages[i].content` array alongside the text content.
 */
export function chatAttachmentToAnthropicContent(
  att: ChatAttachment,
):
  | {
      type: "image";
      source: { type: "url"; url: string };
    }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    } {
  if (att.source.type === "url") {
    return { type: "image", source: { type: "url", url: att.source.url } };
  }
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: att.source.media_type,
      data: att.source.data,
    },
  };
}

/**
 * Build the [ATTACHMENTS] prompt block describing what the user
 * attached. The block is purely descriptive — Anthropic's vision
 * does the actual image processing — but it tells the model when
 * to reference the image and how to weight it.
 *
 * Empty array → empty string (caller skips the layer).
 *
 * Output:
 *
 *     [ATTACHMENTS — visual grounding for this turn]
 *     The user attached 2 images this turn. Use them as primary
 *     visual reference. Do not invent details outside what's visible.
 *     - Image 1 (url): "kitchen inspiration"
 *     - Image 2 (base64): no caption
 */
export function chatAttachmentsToPromptBlock(
  attachments: ChatAttachment[],
): string {
  if (attachments.length === 0) return "";
  const lines: string[] = [];
  lines.push("[ATTACHMENTS — visual grounding for this turn]");
  lines.push(
    `The user attached ${attachments.length} image${attachments.length === 1 ? "" : "s"} this turn. Use them as primary visual reference. Do not invent details outside what is visible.`,
  );
  attachments.forEach((a, i) => {
    const sourceKind = a.source.type;
    const cap = a.caption ? `: "${a.caption.slice(0, 200)}"` : ": no caption";
    lines.push(`- Image ${i + 1} (${sourceKind})${cap}`);
  });
  return lines.join("\n");
}
