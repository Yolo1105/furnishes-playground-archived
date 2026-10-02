import type { StateCreator } from "zustand";
import type { Store } from "./store-types";
import { getAuthHeaders } from "@studio/client/auth-headers";
import type {
  Conversation,
  ConversationTurn,
  GuidedValues,
  Mode,
  ReferenceImage,
} from "@studio/store/types";
import { emptyConversation } from "@studio/store/conversation-utils";
import { getDemoResponse } from "@studio/chat/demoResponses";
import { MODE_CONFIG } from "@studio/chat/modeConfig";
import { classifyInteriorDesignIntent } from "@studio/chat/interior-design-intent";
import {
  runRoomGeneration,
  runAssetGeneration,
} from "@studio/director/runFromChat";
import {
  pushNewConversation,
  pushRename,
  pushDelete,
  pushTurn,
} from "@studio/persistence/conversation-sync";
import {
  selectConfirmedPreferences,
  selectProjectPreferences,
  type Preference,
} from "@studio/store/preferences-slice";
import type { StudioSnapshotPayload } from "@studio/snapshot/studio-client-snapshot-schema";
import type { SgHdbProfile } from "@studio/profiles/sg-hdb";
import { roomDisplayName } from "@studio/profiles/sg-hdb";
import { buildStudioSnapshotForBrain } from "@studio/snapshot/build-studio-snapshot";
import { consumeChatBrainStream } from "@studio/chat/wire-stream-consumer";
import { buildSceneSummary } from "@studio/snapshot/scene-summary";
import { CLIENT_SURFACE_STUDIO_RAIL } from "@/lib/eva/api/chat-attachment";
import {
  applyExtractionPolicy,
  detectContradictions,
  extractPreferenceCandidates,
} from "@/lib/chat-brain/intelligence/preference-extractor";
import { DEFAULT_ASSISTANT_ID } from "@/lib/eva/assistants/catalog";

/**
 * Run rule-based preference extraction on a completed user turn.
 * Creates provisional proposals only — never auto-confirms.
 */
function applyTurnPreferenceExtraction(
  get: () => Store,
  set: (
    partial:
      | Partial<Store>
      | ((state: Store) => Partial<Store>),
  ) => void,
  userText: string,
  turnId: number,
): string[] {
  const state = get();
  const projectId = state.currentProjectId;
  if (!projectId || !userText.trim()) return [];

  const existing = selectProjectPreferences(
    { preferences: state.preferences ?? [] } as never,
    projectId,
  );

  for (const id of detectContradictions(userText, existing)) {
    state.setPreferenceStatus(id, "rejected");
  }

  const candidates = extractPreferenceCandidates(userText);
  const proposals = applyExtractionPolicy(candidates, {
    projectId,
    sourceTurnId: turnId,
  });

  // Skip duplicates of an already-confirmed same key+value.
  const confirmed = selectConfirmedPreferences(
    { preferences: get().preferences ?? [] } as never,
    projectId,
  );
  const fresh = proposals.filter(
    (p) =>
      !confirmed.some(
        (c) =>
          c.key === p.key &&
          c.value.toLowerCase() === p.value.toLowerCase(),
      ),
  );

  for (const p of fresh) {
    get().addPreference(p);
  }

  if (fresh.length > 0) {
    set((curr) => ({
      conversations: updateExistingTurn(
        curr.conversations,
        curr.activeConversationId,
        turnId,
        { preferenceProposalIds: fresh.map((p) => p.id) },
      ),
    }));
  }

  return fresh.map((p) => p.id);
}

/**
 * Build the structured brain payload on every /api/chat POST.
 * The server always uses these fields (legacy JSON chat is gone).
 *
 * Pulls from the live store state so the snapshot reflects exactly
 * what the user is looking at when they hit Send. We cap the
 * furniture array at 80 items (matches studio-snapshot-schema's cap)
 * via slice; that's >5x the typical scene size so it's effectively
 * uncapped for normal use.
 *
 * Recent turns: last 4 turns of the active conversation, used by
 * the intelligence-context layer for "what was the last user turn
 * about" continuity.
 *
 * Preferences: filtered to non-rejected (selectProjectPreferences
 * does this); the brain shouldn't see entries the user has revoked.
 */
function buildBrainPayload(state: any): {
  studioSnapshot: StudioSnapshotPayload;
  preferences: Preference[];
  recentTurns: ConversationTurn[];
  projectId: string;
  projectTitle: string | null;
  sceneSummary: string | null;
  mode: Mode | undefined;
} {
  const projectId: string = String(state.currentProjectId ?? "");
  const project = state.projects?.find?.((p: any) => p.id === projectId);
  const projectTitle: string | null = project?.name ?? null;
  const activeConvo = state.conversations?.find?.(
    (c: any) => c.id === state.activeConversationId,
  );

  // Studio snapshot construction is shared with suggestions-payload
  // via build-studio-snapshot-for-brain — both consumers feed the
  // same server-side schema, so they must agree on caps + projection.
  const studioSnapshot: StudioSnapshotPayload = buildStudioSnapshotForBrain({
    projectId,
    projectTitle,
    sceneSource: state.sceneSource,
    roomMeta: state.roomMeta,
    walls: state.walls,
    openings: state.openings,
    furniture: state.furniture,
    styleBible: state.styleBible,
    referenceImageUrl: state.referenceImage?.url ?? null,
    mode: state.mode,
  });

  // Preferences for this project — confirmed memory only.
  // Provisional proposals are not sent until the user Accepts.
  const preferences = selectConfirmedPreferences(
    { preferences: state.preferences ?? [] } as any,
    projectId,
  );

  // Most-recent 4 turns of the active conversation (chronological).
  const recentTurns: ConversationTurn[] = activeConvo?.turns?.slice?.(-4) ?? [];

  // One-line scene summary for the intelligence-context layer. Same
  // shape as suggestions; consolidated in core/scene-summary.ts so
  // the two payload builders can't drift.
  const placedCount = studioSnapshot.furniture.filter(
    (f: { placed: boolean; visible: boolean }) => f.placed && f.visible,
  ).length;
  const sceneSummary = buildSceneSummary({
    roomMeta: state.roomMeta ?? null,
    placedCount,
    styleBibleName: state.styleBible?.name ?? null,
  });

  return {
    studioSnapshot,
    preferences,
    recentTurns,
    projectId,
    projectTitle,
    sceneSummary,
    // Mode also surfaced at the top level so the route can read it
    // for the Layer 8.5 mode-policy directive without reaching into
    // the snapshot. The snapshot copy is kept for tools that already
    // consume it (snapshot serializer's "Active mode" line).
    mode: state.mode ?? undefined,
  };
}

/**
 * Module-level abort controller for the active generation run, if any.
 * Lives outside the store because AbortController isn't serializable
 * and we want a stable singleton across re-renders. cancelGeneration()
 * fires this and clears it; sendMessage() replaces it on each run.
 */
let activeGenerationAbort: AbortController | null = null;

/** Cancel the current generation run (no-op if none). Exported so the
 *  ChatDock's stop button can call it directly. */
export function cancelGeneration(): void {
  activeGenerationAbort?.abort();
  activeGenerationAbort = null;
}

/**
 * Chat slice — every piece of state related to composing, sending,
 * receiving, and viewing chat messages, plus the reference images
 * staged inside the input box.
 *
 * `sendMessage` is the slice's main action. It:
 *   1. Captures the current draft (free-form text or the assembled
 *      guided summary) and timestamps it.
 *   2. Flips `isThinking` on so the thinking-log animation appears.
 *   3. Schedules the demo response after 3.2s (matches the JSX feel).
 *      When the real `/api/chat` lands in a future step, this becomes
 *      a fetch + streaming parse — same surface, different innards.
 *   4. Clears the draft and any guided values; reference images stay
 *      for the next turn (matches the JSX behavior — they only clear
 *      when the user removes them explicitly).
 */
export interface ChatSlice {
  // ── Draft state ─────────────────────────────────────────────────
  /** Free-form textarea content (and the optional notes textarea). */
  message: string;
  /** Currently active chat mode. */
  mode: Mode;
  /** Interaction style — orthogonal to `mode`. Mode says WHAT the
   *  user wants (Furniture / Room Layout / Interior Design); style
   *  says HOW they want to interact:
   *
   *    • "talk"    — Inspiration Talk. Pure chat-only, no scene
   *                  generation regardless of message. Use for
   *                  brainstorming, asking questions, getting advice.
   *
   *    • "create"  — Creative Mode. Always generate, and operate on
   *                  the current scene where possible (edits + swaps
   *                  rather than full regeneration). The intent
   *                  classifier still picks room vs furniture, but
   *                  it never falls through to "chat".
   *
   *    • "guided"  — Existing guided-context behavior (keyword fields
   *                  replace the textarea). Generation behavior
   *                  inherits from the intent classifier. The old
   *                  `guidedContext` boolean is now derived from
   *                  this field for back-compat.
   *
   *  Default: "talk" — matches the v0.40.16 default behavior where
   *  Interior Design routed via intent classifier and could either
   *  chat or generate based on the message content.
   */
  interactionStyle: "talk" | "create" | "guided";
  /** When true, the input shows the guided keyword fields instead of
   *  the free-form textarea. Derived from interactionStyle === "guided"
   *  in v0.40.17; kept as its own field so existing consumers don't
   *  need to be rewritten. */
  guidedContext: boolean;
  /** User's typed values for the active mode's keyword fields. */
  guidedValues: GuidedValues;
  /** Reference images attached to the next message. */
  referenceImages: ReferenceImage[];

  // ── Conversation state ──────────────────────────────────────────
  /** All conversations across all projects. Each conversation is
   *  scoped to a projectId. The store holds the full set so a single
   *  Zustand subscription can drive every chat surface; per-project
   *  filtering happens via selectors. */
  conversations: Conversation[];
  /** ID of the currently-displayed conversation. Always belongs to
   *  the current project (project switching auto-rotates this to the
   *  most-recent conversation in the new project, or auto-creates a
   *  fresh one if none exist). null is only valid in the brief window
   *  before the seed conversation is created. */
  activeConversationId: string | null;
  /** True between Send and the demo response landing. */
  isThinking: boolean;
  /** v0.40.27: the in-flight user message text. Set when a turn
   *  starts (alongside isThinking), cleared when it finishes. The
   *  ThinkingLog reads this to render a pinned "› your message"
   *  echo above the streaming progress lines, regardless of which
   *  mode the turn went through (Interior Design, Room Layout,
   *  Furniture, or Ask). Reading from `conversations` directly
   *  doesn't work during processing because turns are only pushed
   *  on completion — so the conversation array is empty (first
   *  turn) or shows a prior turn's text (subsequent turns) while
   *  the current message is still in flight. */
  pendingUserText: string;

  // ── Bubble display state ────────────────────────────────────────
  /** Latest-only preview vs full scrollable history. */
  bubbleExpanded: boolean;
  /** When true, the bubble is hidden entirely; a "N responses" pill
   *  takes its place. */
  bubbleHidden: boolean;

  // ── Actions ─────────────────────────────────────────────────────
  setMessage: (m: string) => void;
  setMode: (m: Mode) => void;
  setGuidedContext: (g: boolean) => void;
  setInteractionStyle: (style: "talk" | "create" | "guided") => void;
  setGuidedValue: (key: string, value: string) => void;
  resetGuidedValues: () => void;

  addReferenceImages: (imgs: ReferenceImage[]) => void;
  removeReferenceImage: (id: string) => void;

  setBubbleExpanded: (b: boolean) => void;
  setBubbleHidden: (b: boolean) => void;

  /** Conversation management. All scoped to the current project —
   *  switching projects auto-rotates `activeConversationId`. */
  createConversation: (title?: string) => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;

  /** Send the current draft. No-op if there is nothing valid to send. */
  sendMessage: () => void;
}

/** Format a `Date` like the JSX did: e.g. "10:42 AM". */
function formatClockTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Compose the user-facing summary string for one turn (handles both
 *  free-form and guided modes, including the optional notes appendix). */
function composeUserText(
  guidedContext: boolean,
  mode: Mode,
  guidedValues: GuidedValues,
  message: string,
): string {
  if (!guidedContext) return message.trim();

  const fields = MODE_CONFIG[mode].keywords;
  const summary = fields
    .map((kw) => `${kw.label}: ${guidedValues[kw.key] ?? ""}`)
    .filter((s) => !s.endsWith(": "))
    .join("  ·  ");

  const note = message.trim();
  return note.length > 0 ? `${summary} — ${note}` : summary;
}

/** True when there is a valid draft to send under the current mode. */
function canSendNow(
  guidedContext: boolean,
  mode: Mode,
  guidedValues: GuidedValues,
  message: string,
): boolean {
  if (guidedContext) {
    const fields = MODE_CONFIG[mode].keywords;
    return fields.every((kw) => (guidedValues[kw.key] ?? "").trim().length > 0);
  }
  return message.trim().length > 0;
}

/** Generate a stable client-side conversation ID. Uses the same shape
 *  ("convo_<base36>_<rand>") server-side so we don't have to rewrite
 *  IDs when sync lands — the client-generated id IS the server row's
 *  primary key. */
/** Find the conversation in `conversations` matching id. */
function findConversation(
  conversations: Conversation[],
  id: string | null,
): Conversation | undefined {
  if (!id) return undefined;
  return conversations.find((c) => c.id === id);
}

/** Append a turn to the conversation matching id, returning a new
 *  array (immutable update). Updates the conversation's updatedAt
 *  timestamp so sort-by-recent works. */
function appendTurn(
  conversations: Conversation[],
  id: string | null,
  turn: ConversationTurn,
): Conversation[] {
  if (!id) return conversations;
  return conversations.map((c) =>
    c.id === id
      ? { ...c, turns: [...c.turns, turn], updatedAt: Date.now() }
      : c,
  );
}

/**
 * Replace an in-progress turn's `response` field by id. Used by the
 * streaming chat consumer to render incoming deltas as they arrive.
 *
 * Returns conversations unchanged when the turn isn't found — that
 * happens if the user switches conversations mid-stream and the old
 * conversation no longer holds this turn. Defensive no-op rather
 * than crash.
 */
function updateExistingTurn(
  conversations: Conversation[],
  conversationId: string | null,
  turnId: number,
  patch: Partial<ConversationTurn>,
): Conversation[] {
  if (!conversationId) return conversations;
  return conversations.map((c) =>
    c.id !== conversationId
      ? c
      : {
          ...c,
          turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)),
          updatedAt: Date.now(),
        },
  );
}

export const createChatSlice: StateCreator<Store, [], [], ChatSlice> = (
  set,
  get,
) => {
  return {
    // Initial draft
    message: "",
    mode: "Interior Design",
    interactionStyle: "talk",
    guidedContext: false,
    guidedValues: {},
    referenceImages: [],

    // Populated after `/api/studio/projects/ensure-starter` + list hydrate.
    conversations: [],
    activeConversationId: null,
    isThinking: false,
    pendingUserText: "",

    // Initial bubble state
    bubbleExpanded: false,
    bubbleHidden: false,

    setMessage: (m) => set({ message: m }),

    setMode: (m) =>
      set({
        mode: m,
        // Switching modes invalidates the prior mode's keyword values
        // and the free-form draft — JSX behavior, kept verbatim.
        guidedValues: {},
        message: "",
      }),

    setGuidedContext: (g) =>
      // When the user toggles guidedContext via legacy code paths, also
      // bring interactionStyle in line — true → "guided", false →
      // restore "talk" (the safe default). Without this sync, the
      // dropdown's "Guided" selection could disagree with the textarea
      // visibility flag. v0.40.17.
      set((s) => ({
        guidedContext: g,
        interactionStyle: g
          ? "guided"
          : s.interactionStyle === "guided"
            ? "talk"
            : s.interactionStyle,
      })),

    setInteractionStyle: (style) =>
      // Keep guidedContext synced with the new style: it's true iff
      // style === "guided". Also clear the guided-keyword values when
      // leaving guided mode, matching the existing setMode pattern.
      set((s) => ({
        interactionStyle: style,
        guidedContext: style === "guided",
        guidedValues:
          s.interactionStyle === "guided" && style !== "guided"
            ? {}
            : s.guidedValues,
      })),

    setGuidedValue: (key, value) =>
      set((s) => ({ guidedValues: { ...s.guidedValues, [key]: value } })),

    resetGuidedValues: () => set({ guidedValues: {} }),

    addReferenceImages: (imgs) =>
      set((s) => ({ referenceImages: [...s.referenceImages, ...imgs] })),

    removeReferenceImage: (id) =>
      set((s) => ({
        referenceImages: s.referenceImages.filter((img) => img.id !== id),
      })),

    setBubbleExpanded: (b) => set({ bubbleExpanded: b }),
    setBubbleHidden: (b) => set({ bubbleHidden: b }),

    // ── Conversation CRUD ─────────────────────────────────────────────
    // All operations are scoped to the current project — the slice
    // reads currentProjectId off the merged store state. Empty title
    // gets a sensible default ("Conversation N" for project's existing
    // count + 1).

    createConversation: (title) => {
      let createdId = "";
      let createdConvo: Conversation | null = null;
      set((curr) => {
        const projectId = (curr as unknown as { currentProjectId?: string })
          .currentProjectId;
        if (!projectId) return curr;
        const projectConvos = curr.conversations.filter(
          (c) => c.projectId === projectId,
        );
        const fallbackTitle = `Conversation ${projectConvos.length + 1}`;
        const next = emptyConversation(projectId, title || fallbackTitle);
        createdId = next.id;
        createdConvo = next;
        return {
          conversations: [...curr.conversations, next],
          activeConversationId: next.id,
          bubbleExpanded: false,
          bubbleHidden: false,
        };
      });
      // Server sync: fire-and-forget. Failures degrade to local-only.
      if (createdConvo) void pushNewConversation(createdConvo);
      return createdId;
    },

    selectConversation: (id) => {
      set((curr) => {
        // Only switch if the conversation exists. Avoids breaking the
        // active-id invariant if a stale UI ref tries to switch to a
        // deleted conversation.
        if (!curr.conversations.some((c) => c.id === id)) return curr;
        return {
          activeConversationId: id,
          bubbleExpanded: false,
          bubbleHidden: false,
        };
      });
    },

    deleteConversation: (id) => {
      let didDelete = false;
      set((curr) => {
        const target = curr.conversations.find((c) => c.id === id);
        if (!target) return curr;
        didDelete = true;
        const projectId = target.projectId;
        const remaining = curr.conversations.filter((c) => c.id !== id);

        if (curr.activeConversationId !== id) {
          return { conversations: remaining };
        }

        const sameProject = remaining
          .filter((c) => c.projectId === projectId)
          .sort((a, b) => b.updatedAt - a.updatedAt);

        if (sameProject.length > 0) {
          return {
            conversations: remaining,
            activeConversationId: sameProject[0].id,
            bubbleExpanded: false,
            bubbleHidden: false,
          };
        }

        const fresh = emptyConversation(projectId, "Conversation 1");
        return {
          conversations: [...remaining, fresh],
          activeConversationId: fresh.id,
          bubbleExpanded: false,
          bubbleHidden: false,
        };
      });
      // Server sync. If we just auto-seeded a fresh conversation
      // (because the deleted one was the only one for its project),
      // we also push that new seed so it exists server-side.
      if (didDelete) {
        void pushDelete(id);
        // Find any newly-seeded "Conversation 1" — a fresh seed will
        // have been added in the same set call above.
        const after = get();
        const newlySeeded = after.conversations.find(
          (c) =>
            c.id === after.activeConversationId &&
            c.id !== id &&
            c.turns.length === 0 &&
            Date.now() - c.createdAt < 1000,
        );
        if (newlySeeded) void pushNewConversation(newlySeeded);
      }
    },

    renameConversation: (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      set((curr) => ({
        conversations: curr.conversations.map((c) =>
          c.id === id ? { ...c, title: trimmed, updatedAt: Date.now() } : c,
        ),
      }));
      void pushRename(id, trimmed);
    },

    sendMessage: () => {
      const s = get();
      if (!canSendNow(s.guidedContext, s.mode, s.guidedValues, s.message)) {
        console.warn("[chat] sendMessage: blocked by canSendNow", {
          guidedContext: s.guidedContext,
          mode: s.mode,
          message: s.message,
          guidedValues: s.guidedValues,
        });
        return;
      }

      const userText = composeUserText(
        s.guidedContext,
        s.mode,
        s.guidedValues,
        s.message,
      );
      const turnId = Date.now();
      const time = formatClockTime(new Date());

      console.info("[chat] sendMessage", {
        mode: s.mode,
        userText,
        turnId,
        activeConversationId: s.activeConversationId,
      });

      // Branch by mode:
      //   - "Ask"              → text-only /api/chat (read-only Q&A)
      //   - "Interior Design"  → intent-classified: chat or generate
      //                          based on user message content. The
      //                          user explicitly wanted Interior Design
      //                          to BOTH chat AND take action — so we
      //                          inspect the message text and route to
      //                          Furniture / Room Layout / chat.
      //   - "Furniture"        → /api/generate-asset (single piece)
      //   - "Room Layout"      → /api/generate-room (SSE-streamed)
      //
      // The two generation paths share the same surface: push the user
      // turn immediately with a placeholder response, update the
      // response field as events flow (or once-and-done for the asset
      // path), then close out with a final summary.
      // Interaction-style overrides intent for the two extreme cases:
      //
      //   • style === "talk" → user is in Inspiration Talk; never
      //     generate, route everything through chat.
      //   • style === "create" → user is in Creative Mode; always
      //     generate, never fall through to chat.
      //
      // The "guided" style does not force either direction — guided
      // is about the input format (keyword fields vs free text), not
      // about whether the AI generates. So guided messages still go
      // through the intent classifier when mode === "Interior Design".
      let mode = s.mode;
      const style = s.interactionStyle;

      if (style === "talk") {
        // Force chat path. We do this by making sure mode stays in the
        // chat branch (Ask or Interior Design — both fall through to
        // /api/chat). If the user is on Furniture or Room Layout mode
        // but selected "talk" style, we honor the style: they want to
        // discuss furniture or layouts without generating.
        if (mode === "Furniture" || mode === "Room Layout") {
          mode = "Interior Design"; // routes to chat below
        }
      } else if (style === "create") {
        // Force generation. If the user is on Interior Design with
        // style=create, classify their intent and route to Room Layout
        // or Furniture. Don't allow the classifier to fall through to
        // chat — pick a sensible default if it tries.
        if (mode === "Interior Design") {
          const intent = classifyInteriorDesignIntent(userText);
          if (intent.kind === "chat") {
            // User asked a question while in Creative Mode. Default to
            // Room Layout — Creative Mode is generation-first, and the
            // user can always switch styles to "talk" if they wanted
            // discussion.
            mode = "Room Layout";
          } else if (intent.kind === "generate-room") {
            mode = "Room Layout";
          } else {
            mode = "Furniture";
          }
        }
        // mode === "Furniture" or "Room Layout" stays as-is.
      } else {
        // style === "guided" — falls through with normal intent dispatch.
        if (mode === "Interior Design") {
          const intent = classifyInteriorDesignIntent(userText);
          if (intent.kind === "generate-room") {
            mode = "Room Layout";
          } else if (intent.kind === "generate-furniture") {
            mode = "Furniture";
          }
          // else: kind === "chat" → leave mode as Interior Design so
          // it falls through to the /api/chat path below.
        }
      }

      if (mode === "Furniture" || mode === "Room Layout") {
        // Pluck the first staged reference image (if any). Users
        // typically attach one — if there are multiple, we send the
        // first to the pipeline and silently drop the rest. Could be
        // upgraded later to send all of them as a multi-input style
        // anchor, but neither fal.ai nor Anthropic's vision input
        // benefits much from N>1 in our case.
        const referenceImageUrl = s.referenceImages[0]?.url;

        // Match the /api/chat path: flip isThinking → ThinkingLog
        // animates above the input. Also flip isGenerating: true so
        // the log renders the real per-stage feed (Initializing → Parsing
        // intent → Generating image → Building mesh) instead of the
        // generic chat-mode cycling messages. Without isGenerating, the
        // user saw cycling "thinking..." text that didn't match what was
        // actually happening on the server, then an abrupt jump to the
        // result tile — the visible cause of the loading/result conflict
        // the user reported in v0.40.3.
        //
        // QuickSuggestions hides itself on isThinking too. We do NOT
        // push the conversation turn yet — wait for the run to land
        // a real response, exactly like the chat path does. The
        // previous "push placeholder + update in place" approach
        // bypassed the thinking animation entirely.
        set({
          isThinking: true,
          isGenerating: true,
          // v0.40.27: surface the in-flight user text so ThinkingLog
          // can render the pinned echo immediately (without waiting
          // for finishTurn to push a turn into conversations).
          pendingUserText: userText,
          generationStage: "Initializing…",
          bubbleExpanded: false,
          bubbleHidden: false,
          message: "",
          guidedValues: {},
          // Clear staged references so the next message doesn't
          // accidentally inherit them. (The existing /api/chat path
          // didn't clear these — separate latent bug, fixed here for
          // generation while not touching chat behavior.)
          referenceImages: [],
        } as never);

        // Helper that pushes a single conversation turn at run
        // completion (or error / abort). Same shape as /api/chat's
        // success path. Writes into the active conversation AND
        // fires-and-forgets a server push when sync is configured.
        // Always flips isGenerating: false too — both flags clear
        // together so the log fades out as the result appears.
        const finishTurn = (response: string) => {
          const turn = { id: turnId, userText, response, time };
          let activeId: string | null = null;
          set((curr) => {
            activeId = curr.activeConversationId;
            return {
              isThinking: false,
              isGenerating: false,
              generationStage: "",
              // v0.40.27: clear the in-flight echo when the turn lands.
              pendingUserText: "",
              conversations: appendTurn(
                curr.conversations,
                curr.activeConversationId,
                turn,
              ),
            };
          });
          if (activeId) void pushTurn(activeId, turn);
        };

        // Cancel any prior generation. Two concurrent runs would race
        // on the store; the chat dock's stop button + this auto-cancel
        // both go through the same path.
        cancelGeneration();
        const abort = new AbortController();
        activeGenerationAbort = abort;

        void (async () => {
          // v0.40.49.1: outer try/catch as a defensive net. The inner
          // runRoomGeneration / runAssetGeneration both convert errors
          // to { kind: "error" }, but if either ever threw (e.g. the
          // store getter fails, a JSON.parse blows up in an edge case
          // we missed), the rejection would be unhandled and surface
          // as a Next.js error page — exactly the "results in error
          // page" symptom the user reported. With this wrapper any
          // surfaced exception flows into finishTurn as a styled
          // error chat bubble instead.
          try {
            if (mode === "Room Layout") {
              // skipPieceMeshes is derived from interactionStyle in v0.40.18:
              //
              //   • "create" (Creative Mode) → render meshes. The user
              //     explicitly picked Creative Mode to get a fully-rendered
              //     room; placeholder boxes feel broken in this mode.
              //     ~60s wait but worth it.
              //
              //   • "guided" / anything else → skip meshes. Layout-first
              //     iteration is fast (5-15s) and the user can re-run with
              //     Creative Mode when they're happy with the layout.
              //
              // Background: the orchestrator's per-piece fal.ai mesh calls
              // are the slow part of generation. skipPieceMeshes=true ships
              // pieces without GLBs and renders them as placeholder boxes
              // via GeneratedPieceMesh's fallback path.
              //
              // Earlier versions auto-flipped mainViewMode to 2D so the
              // floor plan filled the main viewport, but the user prefers
              // the standard 3D-main + 2D-reference layout for ALL modes.
              // Reference card already shows the opposite of main view,
              // so the floor plan appears there automatically. Anyone who
              // wants the 2D floor plan in the main viewport can click the
              // swap button on the Reference card explicitly.
              const skipMeshes = s.interactionStyle !== "create";
              // v0.40.23: Creative Mode also bumps up the mesh quality
              // tier from "preview" (TripoSR, ~1s/piece, inconsistent
              // orientation per the TripoSR paper) to "hero" (Hunyuan3D,
              // ~30s/piece, much more consistent canonical orientation).
              // The user explicitly picked Creative Mode to get a fully-
              // rendered room — they're already accepting the longer
              // wait, so use the better provider. Other interaction
              // styles keep "preview" since they're optimized for fast
              // iteration on the layout itself, not final-quality meshes.
              const quality: "preview" | "hero" =
                s.interactionStyle === "create" ? "hero" : "preview";

              await runRoomGeneration({
                prompt: userText,
                signal: abort.signal,
                referenceImageUrl,
                skipPieceMeshes: skipMeshes,
                quality,
                // v0.40.37: thread the active SG HDB profile (if any)
                // through to the orchestrator. When set, the orchestrator
                // pre-fills room dimensions and architecture from the
                // profile spec instead of letting Claude invent them.
                // Cross-slice read: ProfileSlice owns currentProfile, but
                // ChatSlice's `get()` is typed to ChatSlice only — cast
                // through unknown to read it without a circular import
                // (same pattern ModeDropdown uses for interactionStyle).
                profile:
                  (get() as unknown as { currentProfile?: SgHdbProfile | null })
                    .currentProfile ?? undefined,
                // onStage is intentionally not used to update a bubble
                // here — `runRoomGeneration` writes the stage into
                // `generationStage` on the slice, and ThinkingLog reads
                // that to render the rolling lines.
                onComplete: (result) => {
                  if (result.kind === "complete") {
                    const count = result.pieceCount ?? 0;
                    // v0.40.31: number of pieces whose mesh generation
                    // failed mid-run (typically transient fal.ai errors).
                    // The user sees these as placeholder boxes; we surface
                    // the count in the completion message so they know
                    // some pieces need retry.
                    const failedCount = result.failedPieceCount ?? 0;
                    const renderedCount = count - failedCount;
                    // Build a short "why this design" explanation. The
                    // user complained that "Generated layout with 8 pieces"
                    // was too terse — they wanted to see the reasoning.
                    // We pull from the StyleBible (style name + mood +
                    // palette) and the room dims, plus highlight the
                    // first 2-3 pieces by name. Three short sentences:
                    //
                    //   1. What we made (room type + dims + style)
                    //   2. Why this style choice (mood, materials)
                    //   3. Headline pieces
                    //
                    // Falls back to the original terse response if the
                    // optional fields aren't populated (older callbacks
                    // or schema drift).
                    const style = result.style;
                    const room = result.room;
                    const pieces = result.pieceDescriptions ?? [];

                    // v0.40.31: a partial-failure suffix appended to the
                    // completion message when at least one piece failed.
                    // Tells the user exactly what to do next.
                    const failureNote =
                      failedCount > 0
                        ? ` Note: ${failedCount} of ${count} mesh${failedCount === 1 ? "" : "es"} failed — those appear as placeholder boxes. Click each box and use "Regenerate mesh" in the Properties card to retry.`
                        : "";

                    let response: string;
                    // v0.40.41: read the active profile so the success
                    // message can reference it ("for your Singapore HDB
                    // 4-room master bedroom"). Without this, a user with
                    // multiple generations in their history can't tell at
                    // a glance which ones used the HDB profile vs.
                    // free-form. Same cross-slice cast pattern as above.
                    const activeProfile = (
                      get() as unknown as {
                        currentProfile?: SgHdbProfile | null;
                      }
                    ).currentProfile;
                    const profileSuffix =
                      activeProfile && activeProfile.kind === "sg-hdb"
                        ? ` for your Singapore HDB ${activeProfile.flatType} ${roomDisplayName(activeProfile.room).toLowerCase()}`
                        : "";
                    if (style && room) {
                      const dims = `${room.width_m.toFixed(1)}×${room.depth_m.toFixed(1)}m`;
                      const styleName = style.name || "modern";
                      const mood = style.mood
                        ? ` ${style.mood.replace(/[.,]\s*$/, "")}.`
                        : "";
                      const wood = style.materials?.dominant_wood;
                      const textile = style.materials?.primary_textile;
                      const matNote =
                        wood && textile
                          ? ` Materials lean on ${wood} for case goods and ${textile} for soft furnishings.`
                          : wood
                            ? ` Case goods use ${wood} as the dominant wood.`
                            : "";
                      const headline = pieces.slice(0, 3).join(", ");
                      const headlineLine = headline
                        ? ` Anchor pieces: ${headline}.`
                        : "";

                      // v0.40.31: when there are partial failures, lead
                      // with "X of Y rendered" instead of just "Y pieces"
                      // so the user immediately sees the partial state.
                      const headlineCount =
                        failedCount > 0
                          ? `${renderedCount} of ${count} pieces rendered`
                          : `${count} piece${count === 1 ? "" : "s"}`;

                      response = `Generated a ${dims} layout${profileSuffix} in ${styleName} style with ${headlineCount}.${mood}${matNote}${headlineLine}${failureNote}`;
                    } else {
                      // Fallback when style/room aren't available.
                      response =
                        failedCount > 0
                          ? `Generated layout${profileSuffix} with ${renderedCount} of ${count} pieces rendered.${failureNote}`
                          : `Generated layout${profileSuffix} with ${count} piece${count === 1 ? "" : "s"}.`;
                    }

                    // Push this room into the generations list so the
                    // Generations card has a tile for it. v0.40.15 only
                    // pushed Furniture (single-asset) results, which is
                    // why the user saw an empty Generations card after
                    // generating a room. Each tile uses kind: "room"; tile
                    // click in GenerationsCard re-applies the saved scene.
                    try {
                      const styleName = style?.name || "modern";
                      const dimsShort = room
                        ? `${room.width_m.toFixed(1)}×${room.depth_m.toFixed(1)}m`
                        : "";
                      const roomLabel = `${styleName} ${dimsShort} room`.trim();
                      const after = get() as unknown as {
                        addAssetGeneration?: (asset: {
                          id: string;
                          kind: "room";
                          label: string;
                          style: typeof style;
                          scene: unknown;
                          createdAt: number;
                        }) => void;
                      };
                      after.addAssetGeneration?.({
                        id: `room_${Date.now().toString(36)}`,
                        kind: "room",
                        label: roomLabel,
                        style,
                        scene: result.scene,
                        createdAt: Date.now(),
                      });
                    } catch {
                      // Best-effort persist — never block the chat turn
                      // if the generations slice ever changes shape.
                    }

                    // v0.40.27: fly the camera in for a closer view of
                    // the just-generated room. Previously the camera sat
                    // at the default [8, 7, 8] which is far enough back
                    // that a 4×4.5m room looks small in the viewport.
                    // Now we scale the camera distance to room size: the
                    // dominant room dimension * 1.0 plus a small floor.
                    // For a 4×4.5m room we land around [4.5, 2.5, 4.5]
                    // which fills most of the viewport while keeping the
                    // whole room visible.
                    try {
                      if (room) {
                        const longestRoom = Math.max(
                          room.width_m,
                          room.depth_m,
                        );
                        const flyAfter = get() as unknown as {
                          flyCameraTo?: (
                            position: [number, number, number],
                            target: [number, number, number],
                          ) => void;
                        };
                        const dist = Math.max(longestRoom * 1.0, 3.0);
                        const camPos: [number, number, number] = [
                          dist,
                          dist * 0.55,
                          dist,
                        ];
                        const camTarget: [number, number, number] = [0, 0.5, 0];
                        flyAfter.flyCameraTo?.(camPos, camTarget);
                      }
                    } catch {
                      // Camera fly is non-critical; never block the
                      // turn-complete handler.
                    }

                    finishTurn(response);
                  } else if (result.kind === "error") {
                    finishTurn(`Error: ${result.message ?? "unknown"}`);
                  } else if (result.kind === "aborted") {
                    finishTurn("Cancelled.");
                  }
                },
              });
            } else {
              // mode === "Furniture"
              // v0.40.26: tier was hardcoded "preview" — that ignored the
              // user's interaction-style choice. Creative Mode + Furniture
              // generation now uses the hero provider (Hunyuan3D) just
              // like Room Layout's Creative Mode does. ~30s/piece instead
              // of ~1s, but mesh orientation is much more reliably
              // canonical (TripoSR's docs explicitly say the model
              // "guesses" camera params, which is why preview-tier
              // pieces sometimes come out tilted).
              const furnitureTier: "preview" | "hero" =
                s.interactionStyle === "create" ? "hero" : "preview";
              const result = await runAssetGeneration({
                prompt: userText,
                signal: abort.signal,
                referenceImageUrl,
                tier: furnitureTier,
              });

              if (result.kind === "complete" && result.glbUrl && result.piece) {
                const pieceLabel = result.piece.description.slice(0, 60);

                // Push the result into the generations slice as a tile.
                // The tile remains visible so the user can re-place a
                // duplicate if they want, but they no longer have to
                // click it to see the result — auto-placement happens
                // below.
                const assetId = `asset_${Date.now().toString(36)}`;
                const after = get() as unknown as {
                  addAssetGeneration?: (asset: {
                    id: string;
                    label: string;
                    glbUrl: string;
                    imageUrl?: string;
                    piece: typeof result.piece;
                    style: typeof result.style;
                    createdAt: number;
                  }) => void;
                  apartmentCenter?: [number, number] | null;
                  sceneSource?: "viewer" | "room-director";
                  flyCameraTo?: (
                    position: [number, number, number],
                    target: [number, number, number],
                  ) => void;
                };
                const assetForStore = {
                  id: assetId,
                  label: pieceLabel,
                  glbUrl: result.glbUrl,
                  imageUrl: result.imageUrl,
                  piece: result.piece,
                  style: result.style,
                  createdAt: Date.now(),
                };
                after.addAssetGeneration?.(assetForStore);

                // Auto-place into the scene so the user sees the result
                // immediately. v0.40.3 required a manual tile-click,
                // which left the user staring at chat for several seconds
                // wondering if anything happened. The tile still appears
                // for re-placement; the live scene now updates on its own.
                try {
                  const { placeGeneratedAssetIntoScene } =
                    await import("@studio/scene/place-generated-asset");
                  placeGeneratedAssetIntoScene(assetForStore as never, {
                    apartmentCenter: after.apartmentCenter ?? null,
                    sceneSource:
                      after.sceneSource === "room-director"
                        ? "room-director"
                        : "viewer",
                  });

                  // Frame the camera onto the new piece if we're on a
                  // blank canvas. Without this, the default camera is
                  // tuned for the apartamento.glb (~10m apartment) and
                  // a single 2m sofa at origin looks tiny + far away.
                  //
                  // The framing logic mirrors what the user manually
                  // does with orbit controls: position the camera at
                  // a 30°-elevated 3/4 view, roughly 3× the piece's
                  // longest dimension away. Target the piece's center.
                  const piece = result.piece;
                  const longest = Math.max(
                    piece.dimensions_hint.length,
                    piece.dimensions_hint.width,
                    piece.dimensions_hint.height,
                  );
                  // v0.40.29: tightened further (longest * 1.0 vs 1.3,
                  // floor 1.2m vs 1.8m). For a 2.2m sofa the camera
                  // lands at ~2.2m — close enough to read texture detail
                  // on the mesh while keeping the whole piece in frame.
                  // Y component dropped to dist * 0.4 to be near-eye-
                  // level (just slightly above) rather than top-down.
                  const dist = Math.max(longest * 1.0, 1.2);
                  const camPos: [number, number, number] = [
                    dist,
                    dist * 0.4,
                    dist,
                  ];
                  const camTarget: [number, number, number] = [
                    0,
                    piece.dimensions_hint.height / 2,
                    0,
                  ];
                  after.flyCameraTo?.(camPos, camTarget);
                } catch (e) {
                  // Auto-placement failure shouldn't break the chat
                  // turn — the tile is still in Recent Generations,
                  // user can click it the old way.

                  console.warn("[chat] auto-place failed", e);
                }

                // Conversation turn copy: now reflects that the piece
                // is already in the scene. The "click the tile" hint
                // from v0.40.3 was misleading after auto-placement.
                finishTurn(
                  `Generated and placed: ${pieceLabel}.\nDrag in the scene to reposition. Click the Recent Generations tile to add another copy.`,
                );
              } else if (result.kind === "error") {
                finishTurn(`Error: ${result.message ?? "unknown"}`);
              } else if (result.kind === "aborted") {
                finishTurn("Cancelled.");
              }
            }
          } catch (err) {
            // Surface any unexpected exception as a chat error rather
            // than letting it become an unhandled rejection that
            // crashes the studio. Logged so we can grep for the
            // pattern in dev tools.

            console.error("[chat] generation IIFE threw:", err);
            const message =
              err instanceof Error ? err.message : "Unknown generation error";
            finishTurn(`Error: ${message}`);
          }

          // Whatever happened, the run is done. Clear the active abort
          // controller so a subsequent submit gets a fresh one.
          if (activeGenerationAbort === abort) {
            activeGenerationAbort = null;
          }
        })();

        return;
      }

      // ── Existing "Interior Design" / chat path (unchanged) ─────────
      // Flip into thinking mode and clear the draft optimistically.
      set({
        isThinking: true,
        // v0.40.27: also surface the in-flight echo here so the chat
        // path (Interior Design / Ask) gets the same pinned-message
        // treatment as the generation paths.
        pendingUserText: userText,
        bubbleExpanded: false,
        bubbleHidden: false,
        message: "",
        guidedValues: {},
      });

      // Real /api/chat fetch with a graceful local-stub fallback when
      // the server rejects the request as unavailable (e.g. missing
      // OpenAI key → 503); we show a canned demo response so local dev
      // works without full provider configuration.
      void (async () => {
        try {
          const state = get();
          // Build the scene-context snapshot inline to avoid pulling
          // a buildSceneContext import into the slice.
          const placed = state.furniture?.filter?.((f: any) => f.placed) ?? [];
          const ctxLines: string[] = [];
          if (placed.length === 0) {
            ctxLines.push("(empty room — no furniture currently placed)");
          } else {
            ctxLines.push(`Items currently placed (${placed.length}):`);
            for (const f of placed) {
              const visMark = f.visible ? "" : " (hidden)";
              ctxLines.push(
                `  ${f.id} · ${f.label} · ${f.width.toFixed(2)}×${f.depth.toFixed(2)}m${visMark}`,
              );
            }
          }
          const context = ctxLines.join("\n");

          // Last 6 turns flattened to {role, content} alternation.
          // Pulls from the currently-active conversation; falls back to
          // empty if somehow there's no active conversation (shouldn't
          // happen after the seed but defensive).
          const activeConvo = findConversation(
            state.conversations,
            state.activeConversationId,
          );
          const history: Array<{
            role: "user" | "assistant";
            content: string;
          }> = [];
          for (const turn of activeConvo?.turns.slice(-6) ?? []) {
            history.push({ role: "user", content: turn.userText });
            history.push({ role: "assistant", content: turn.response });
          }

          // Structured brain payload. Legacy JSON chat is gone.
          const brainPayload = buildBrainPayload(state);

          const res = await fetch("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...getAuthHeaders(),
            },
            body: JSON.stringify({
              message: userText,
              context,
              history,
              ...brainPayload,
              clientSurface: CLIENT_SURFACE_STUDIO_RAIL,
              assistantId: state.activePersonaId ?? DEFAULT_ASSISTANT_ID,
              personaId: state.activePersonaId ?? DEFAULT_ASSISTANT_ID,
            }),
          });

          console.info("[chat] /api/chat responded", {
            status: res.status,
            contentType: res.headers.get("Content-Type"),
            chatRequestId: res.headers.get("X-Chat-Request-Id"),
            generationFailure: res.headers.get("X-Chat-Generation-Failure"),
          });

          if (res.status === 503) {
            const turn = {
              id: turnId,
              userText,
              response:
                getDemoResponse(userText) +
                "\n\n(Note: real AI is not configured on this server. Set ANTHROPIC_API_KEY to enable Claude.)",
              time,
              personaId: get().activePersonaId ?? DEFAULT_ASSISTANT_ID,
            };
            let activeId: string | null = null;
            set((curr) => {
              activeId = curr.activeConversationId;
              return {
                isThinking: false,
                pendingUserText: "",
                conversations: appendTurn(
                  curr.conversations,
                  curr.activeConversationId,
                  turn,
                ),
              };
            });
            if (activeId) void pushTurn(activeId, turn);
            applyTurnPreferenceExtraction(get, set, userText, turnId);
            return;
          }

          if (!res.ok) {
            const err = await res
              .json()
              .catch(() => ({ error: `Request failed: ${res.status}` }));
            const turn = {
              id: turnId,
              userText,
              response: `Error: ${err.error ?? "Request failed."}`,
              time,
            };
            let activeId: string | null = null;
            set((curr) => {
              activeId = curr.activeConversationId;
              return {
                isThinking: false,
                pendingUserText: "",
                conversations: appendTurn(
                  curr.conversations,
                  curr.activeConversationId,
                  turn,
                ),
              };
            });
            if (activeId) void pushTurn(activeId, turn);
            return;
          }

          const contentType = res.headers.get("Content-Type") ?? "";
          const isStreaming = contentType.includes("text/event-stream");

          if (isStreaming && res.body) {
            // Streaming brain branch. Append an empty turn immediately,
            // then mutate its `response` field as deltas arrive.
            const initialTurn: ConversationTurn = {
              id: turnId,
              userText,
              response: "",
              time,
              personaId: get().activePersonaId ?? DEFAULT_ASSISTANT_ID,
            };
            let activeId: string | null = null;
            set((curr) => {
              activeId = curr.activeConversationId;
              return {
                isThinking: false, // turn is now visible; no separate thinking row
                pendingUserText: "",
                conversations: appendTurn(
                  curr.conversations,
                  curr.activeConversationId,
                  initialTurn,
                ),
              };
            });

            let accumulated = "";
            let failureDisplayMessage: string | null = null;
            let deltaCount = 0;

            await consumeChatBrainStream(res.body, (ev) => {
              if (ev.type === "delta" && typeof ev.text === "string") {
                accumulated += ev.text;
                deltaCount++;
                set((curr) => ({
                  conversations: updateExistingTurn(
                    curr.conversations,
                    activeId,
                    turnId,
                    { response: accumulated },
                  ),
                }));
              } else if (ev.type === "error") {
                // Mid-stream failure. Replace the response with the
                // user-facing display string.
                failureDisplayMessage =
                  ev.displayMessage ??
                  "I couldn't finish that reply. Try again in a moment.";
                set((curr) => ({
                  conversations: updateExistingTurn(
                    curr.conversations,
                    activeId,
                    turnId,
                    { response: failureDisplayMessage as string },
                  ),
                }));
              }
              // ev.type === "done" → no state change here; the
              // accumulated text is already in the turn.
            });

            console.info("[chat] stream finished", {
              deltaCount,
              accumulatedLength: accumulated.length,
              failureMessage: failureDisplayMessage,
            });

            // Persist the final turn (best-effort server sync).
            const finalText = failureDisplayMessage ?? accumulated;
            if (activeId) {
              void pushTurn(activeId, {
                id: turnId,
                userText,
                response: finalText,
                time,
                personaId: get().activePersonaId ?? DEFAULT_ASSISTANT_ID,
              });
            }
            if (!failureDisplayMessage) {
              applyTurnPreferenceExtraction(get, set, userText, turnId);
            }
            return;
          }

          // ─── Legacy / non-streaming JSON path ─────────────────────
          const data = (await res.json()) as {
            reply: string;
            actions: Array<{ type: string; id: string; visible?: boolean }>;
          };

          {
            const turn = {
              id: turnId,
              userText,
              response: data.reply,
              time,
              personaId: get().activePersonaId ?? DEFAULT_ASSISTANT_ID,
            };
            let activeId: string | null = null;
            set((curr) => {
              activeId = curr.activeConversationId;
              return {
                isThinking: false,
                pendingUserText: "",
                conversations: appendTurn(
                  curr.conversations,
                  curr.activeConversationId,
                  turn,
                ),
              };
            });
            if (activeId) void pushTurn(activeId, turn);
            applyTurnPreferenceExtraction(get, set, userText, turnId);
          }

          const after = get();
          for (const a of data.actions ?? []) {
            if (a.type === "delete") {
              after.removeFurniture(a.id);
            } else if (a.type === "setVisibility") {
              const item = after.furniture.find((f: any) => f.id === a.id);
              if (item && item.visible !== !!a.visible) {
                after.toggleFurnitureVisibility(a.id);
              }
            }
          }
        } catch (e) {
          const turn = {
            id: turnId,
            userText,
            response: `Couldn't reach the assistant — ${
              e instanceof Error ? e.message : "unknown error"
            }`,
            time,
          };
          let activeId: string | null = null;
          set((curr) => {
            activeId = curr.activeConversationId;
            return {
              isThinking: false,
              pendingUserText: "",
              conversations: appendTurn(
                curr.conversations,
                curr.activeConversationId,
                turn,
              ),
            };
          });
          if (activeId) void pushTurn(activeId, turn);
        }
      })();
    },
  };
};

// ── Helper exports for components that need the same predicates ─────

/** True when the current draft is sendable. Mirrors the slice's internal
 *  check so components can wire the Send button to it without poking
 *  into private logic. */
export function selectCanSend(
  s: ChatSlice & { currentProjectId?: string },
): boolean {
  if (!s.currentProjectId) return false;
  return canSendNow(s.guidedContext, s.mode, s.guidedValues, s.message);
}

/** True when every guided field for the current mode has a value. Used by
 *  the input to unlock the optional free-form notes textarea. */
export function selectAllKeywordsFilled(s: ChatSlice): boolean {
  const fields = MODE_CONFIG[s.mode].keywords;
  return fields.every((kw) => (s.guidedValues[kw.key] ?? "").trim().length > 0);
}

/** Return the currently-active Conversation, or null if none. Stable
 *  selector — components subscribe via `useStore(selectActiveConversation)`
 *  and re-render only when the active conversation's identity changes. */
export function selectActiveConversation(s: ChatSlice): Conversation | null {
  if (!s.activeConversationId) return null;
  return s.conversations.find((c) => c.id === s.activeConversationId) ?? null;
}

/** Return the turns of the active conversation (empty array if none).
 *  Convenience for components that previously read `s.conversation`
 *  directly — those switch to `useStore(selectActiveConversationTurns)`
 *  with no other change to their logic.
 *
 *  Returns the same `EMPTY_TURNS` reference whenever there's no active
 *  conversation, so a Zustand subscriber doesn't see a fresh array on
 *  every store change. (If the active conversation exists, we return
 *  its `turns` array directly — that reference is also stable across
 *  reads that don't mutate the conversation.) */
const EMPTY_TURNS: ConversationTurn[] = [];
export function selectActiveConversationTurns(
  s: ChatSlice,
): ConversationTurn[] {
  if (!s.activeConversationId) return EMPTY_TURNS;
  const c = s.conversations.find((x) => x.id === s.activeConversationId);
  return c?.turns ?? EMPTY_TURNS;
}

/** Return all conversations belonging to the current project, sorted
 *  most-recent-updated first. Used by the conversation switcher
 *  dropdown to render the per-project list. */
/**
 * Per-project conversations selector. Returns conversations belonging
 * to the current project, sorted most-recently-updated first.
 *
 * Memoization note: returns a fresh array on every call. Zustand
 * subscribers using this with default Object.is equality will re-render
 * whenever any field on the chat slice changes (since the array
 * identity is new each time). For a card component subscribing to
 * this AND only updating in response to conversation-list changes,
 * that's the right behavior — every conversation-list update creates
 * a new array. Excessive re-renders here are bounded by the number of
 * conversations (small) and don't block paint.
 *
 * Defensive against malformed data: if a conversation's `turns` array
 * is missing (older snapshots, partial hydration), we treat it as
 * empty rather than crashing. The list component reads `.turns.length`
 * directly on the result.
 */
export function selectCurrentProjectConversations(
  s: ChatSlice & { currentProjectId?: string },
): Conversation[] {
  const projectId = s.currentProjectId;
  if (!projectId) return [];
  const list = Array.isArray(s.conversations) ? s.conversations : [];
  return list
    .filter((c) => c && c.projectId === projectId)
    .map((c) =>
      // Defensive: ensure `turns` is always an array. Some legacy
      // snapshots and mid-hydrate states have `turns` as undefined.
      Array.isArray(c.turns) ? c : { ...c, turns: [] },
    )
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
