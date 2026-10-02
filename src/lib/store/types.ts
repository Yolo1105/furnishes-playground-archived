/**
 * Shared types for the chat shell. Kept in one file so every slice and
 * component imports from the same place — when a shape changes, the
 * blast radius is the type, not 12 inline structural types.
 */

/** The chat modes the user can pick from. Ask is read-only Q&A
 *  (added in Turn 4); the other three drive design / generation
 *  workflows. */
export type Mode = "Ask" | "Interior Design" | "Furniture" | "Room Layout";

/** One configurable keyword field inside a guided-context mode. */
export interface ModeKeyword {
  /** Object key under `guidedValues`. Stable across renders. */
  key: string;
  /** Human-readable label shown next to the input. */
  label: string;
  /** Placeholder hint shown when the field is empty. */
  placeholder: string;
}

/** Static configuration for a single mode (description + its fields). */
export interface ModeConfig {
  desc: string;
  keywords: ModeKeyword[];
}

/** Map from a guided-keyword key to the user's typed value. */
export type GuidedValues = Record<string, string>;

/** One full chat turn (user prompt + system response + timestamp). */
export interface ConversationTurn {
  id: number;
  userText: string;
  response: string;
  /** Pre-formatted display string, e.g. "10:42 AM". */
  time: string;
  /** Schema 3.4.0+: which attachments (if any) grounded this turn's
   *  reply. `undefined` for legacy turns and turns without
   *  attachments. The presence of the field signals "we recorded
   *  attachment state for this turn"; the field's contents say
   *  what was attached. */
  attachmentGrounding?: {
    /** Number of image attachments processed. 0 means we tried to
     *  ground but found no usable images. */
    count: number;
    /** Which source kinds were used. Helpful for analytics ("url
     *  attachments are more common than base64"). */
    sourceKinds: Array<"url" | "base64">;
  };
  /** Eva persona that generated the assistant reply (audit / provenance).
   *  Visible author stays "Eva"; this is for inspectors and future turns. */
  personaId?: string;
  /** Preference proposal ids extracted from this turn's user text. */
  preferenceProposalIds?: string[];
}

/**
 * A named thread of turns scoped to a project. A project has any
 * number of conversations (default starts with one) and a pointer to
 * the active one.
 *
 * The id is generated client-side as `convo_<base36-timestamp>_<rand>`
 * so we can write to local-first storage without waiting on a server
 * round-trip. When Supabase is configured the same id is reused on
 * the server row — no rewriting of references when sync lands.
 *
 * Rationale for the wrapper rather than threading conversationId
 * through every turn: turns inside a conversation share project +
 * timestamps + ordering — keeping them as a list inside the
 * conversation matches that grouping and makes "show me the last 6
 * turns of the active conversation" a one-liner.
 */
export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  turns: ConversationTurn[];
  createdAt: number;
  updatedAt: number;
}

/** A reference image attached to (but not yet sent with) the next message. */
export interface ReferenceImage {
  id: string;
  /** Data URL produced by FileReader. */
  url: string;
  name: string;
}

/**
 * One entry in the rolling thinking-log animation. `idx` indexes into
 * the static thinking-states array; `id` is a unique animation key so
 * React doesn't reuse DOM nodes when the same state recurs.
 */
export interface ThinkingHistoryEntry {
  idx: number;
  id: number;
}
