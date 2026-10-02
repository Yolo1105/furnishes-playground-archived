"use client";

/**
 * Generation runners — the non-hook entry points that the chat-slice
 * calls when the user submits a prompt in "Furniture" or "Room Layout"
 * mode.
 *
 * Why these exist next to useDesignStream:
 *   - useDesignStream is a React hook (uses useRef, useCallback) for
 *     components that want a stable cancel handle and re-render on
 *     state changes. It's the right surface for, say, a future
 *     dedicated DesignPanel we don't have today.
 *   - The chat-slice's sendMessage action runs OUTSIDE React render
 *     context — slice actions can't call hooks. So we duplicate the
 *     core flow as plain async functions that read store actions via
 *     useStore.getState() instead.
 *   - Two implementations sharing the same underlying schema + adapter
 *     keeps both surfaces useful without forcing one to be awkward.
 *
 * Both runners:
 *   1. Push a "user" turn into the conversation (the chat-slice does
 *      this; we just receive a callback).
 *   2. Toggle isGenerating on, set initial stage.
 *   3. Run the pipeline (SSE stream for room, sync POST for asset).
 *   4. Update store progressively as events arrive.
 *   5. Push a final "assistant" turn summarizing the result.
 *   6. Toggle isGenerating off.
 *
 * Cancellation: the chat-slice owns the AbortController. We accept it
 * as a parameter so the slice can keep one canonical reference and
 * abort it on a "Stop" click or on a competing submit.
 */

import { useStore } from "@studio/store";
import { startDesignStream } from "./streaming";
import { assembledSceneToStudio, pieceToFurniture } from "./adapter";
import type {
  AssembledScene,
  PlacedPiece,
  StyleBible,
  PieceRequest,
} from "./schema";
import { friendlyError } from "@studio/utils/friendly-error";
import { getAuthHeaders } from "@studio/client/auth-headers";
import type { PlacedItem } from "@studio/store/furniture-slice";
import type { SgHdbProfile } from "@studio/profiles/sg-hdb";

// ────────────────────────────────────────────────────────────────────
// Whole-room generation
// ────────────────────────────────────────────────────────────────────

export interface RoomRunParams {
  prompt: string;
  signal: AbortSignal;
  /** Optional reference image (data URL or HTTPS) attached to the
   *  generation. When present, the orchestrator skips its own
   *  Flux-generated style anchor and uses this image as the room-level
   *  reference, plus passes it to Claude as a vision input so the
   *  derived StyleBible reflects the photo's actual look (palette,
   *  materials, mood). When absent, the existing Flux anchor pass
   *  runs as before. */
  referenceImageUrl?: string;
  /** Called whenever the stage text changes — chat-slice can use
   *  this to push status into the active conversation turn (or
   *  surface elsewhere). */
  onStage?: (stage: string) => void;
  /** Called once when the run reaches a terminal state. The
   *  chat-slice closes out the active turn from this callback. */
  onComplete?: (result: {
    kind: "complete" | "error" | "aborted";
    pieceCount?: number;
    /** v0.40.31: count of pieces whose mesh generation failed. The
     *  chat-slice surfaces this in the completion message so the
     *  user knows partial results landed. Pieces in this set still
     *  appear in the scene but as placeholder boxes. */
    failedPieceCount?: number;
    /** v0.40.31: IDs of pieces with failed meshes. Carried through
     *  so the Properties card can offer per-piece retry on the
     *  matching placeholder. */
    failedPieceIds?: string[];
    message?: string;
    /** StyleBible used for the generation. Only present on complete.
     *  chat-slice uses this to write a 2–3 sentence "why I designed it
     *  this way" explanation in the conversation turn. */
    style?: StyleBible;
    /** Room dimensions used for the generation. Only present on
     *  complete. Chat-slice uses these to mention scale in the
     *  explanation. */
    room?: AssembledScene["room"];
    /** First few piece descriptions (capped at ~6). Used to surface
     *  the headline pieces in the explanation. */
    pieceDescriptions?: string[];
    /** Frozen scene snapshot — the same shape applyScene was called
     *  with. v0.40.16: the chat-slice persists this on the generations
     *  list so a tile click can re-apply this room. */
    scene?: {
      furniture: unknown[];
      roomMeta: unknown;
      walls: unknown[];
      openings: unknown[];
      style: StyleBible | null;
    };
  }) => void;
  quality?: "preview" | "hero";
  skipStyleAnchor?: boolean;
  /** When true, the orchestrator skips per-piece mesh generation —
   *  the room ships with placeholder boxes. Used by Room Layout
   *  chat mode where the deliverable is the floor plan, not the
   *  meshes. ~5–15s instead of 60+s. */
  skipPieceMeshes?: boolean;
  /** v0.40.37: Singapore HDB profile selected by the user. When
   *  present, the orchestrator pre-fills room dimensions from the
   *  profile spec and injects HDB-specific guidance into the
   *  prompt. Threaded straight through to OrchestratorOptions. */
  profile?: SgHdbProfile;
}

/** Build a partial AssembledScene from a layout event so the studio
 *  can render placeholder pieces immediately, before any GLBs arrive. */
function assembleFromLayout(
  pieces: PlacedPiece[],
  room: AssembledScene["room"],
  style: StyleBible | null,
): AssembledScene {
  return {
    style: style ?? {
      name: "loading",
      palette: { walls: "#FFF4EC", accent: "#FF5A1F" },
      materials: {},
      mood: "neutral",
      lighting: "neutral",
      forbidden: [],
    },
    room,
    pieces,
    walls: [],
    openings: [],
    layout_score: null,
    score_breakdown: null,
  };
}

/** Run a room generation. Returns when the stream is fully consumed
 *  or terminates with an error. Caller is responsible for awaiting. */
export async function runRoomGeneration(params: RoomRunParams): Promise<void> {
  const store = useStore.getState();
  const setIsGenerating = store.setIsGenerating;
  const setGenerationStage = store.setGenerationStage;
  const applyScene = store.applyScene;
  const patchItemMeta = store.patchItemMeta;
  const freezeOriginalScene = store.freezeOriginalScene;

  setIsGenerating(true);
  setGenerationStage("Initializing…");
  params.onStage?.("Initializing…");

  let lastStyle: StyleBible | null = null;
  let layoutPieceCount = 0;
  let pieceReadyCount = 0;
  // v0.40.19: keep a piece_id → short label map so piece_ready events
  // can show "Generated: low futon sofa" instead of "Mesh 3 of 7".
  // The user reported the thinking log felt generic — they wanted to
  // see WHAT was being generated, not just a counter. We populate
  // this from the layout event (which arrives before any
  // piece_ready), trim each description to a digestible length, and
  // look it up at piece_ready time.
  const pieceLabels = new Map<string, string>();

  try {
    const stream = startDesignStream({
      prompt: params.prompt,
      quality: params.quality ?? "preview",
      skipStyleAnchor: params.skipStyleAnchor ?? false,
      skipPieceMeshes: params.skipPieceMeshes ?? false,
      referenceImageUrl: params.referenceImageUrl,
      signal: params.signal,
      profile: params.profile,
    });

    for await (const event of stream) {
      switch (event.kind) {
        case "intent": {
          setGenerationStage("Parsing intent…");
          params.onStage?.("Parsing intent…");
          break;
        }

        case "style": {
          lastStyle = event.style;
          const stage = `Style: ${event.style.name}`;
          setGenerationStage(stage);
          params.onStage?.(stage);
          break;
        }

        case "layout": {
          layoutPieceCount = event.pieces.length;
          // Build the piece_id → label map. Trim each description to
          // ~40 chars so it fits on the thinking log without wrapping.
          // We use the first 40 chars + "…" if longer, keeping the
          // start of the description (which usually carries the
          // category — "low futon sofa with linen upholstery" → "low
          // futon sofa with linen upholstery").
          for (const p of event.pieces) {
            const desc = p.description ?? p.id;
            const trimmed = desc.length > 40 ? desc.slice(0, 40) + "…" : desc;
            pieceLabels.set(p.id, trimmed);
          }

          // Stage label for layout itself — show the piece count + a
          // "Sketching the floor plan" framing that matches the
          // user's mental model of "design progresses through the
          // floor plan, then materials, then individual pieces."
          const stage = `Sketching the floor plan (${event.pieces.length} piece${event.pieces.length === 1 ? "" : "s"})…`;
          setGenerationStage(stage);
          params.onStage?.(stage);

          const partial = assembleFromLayout(
            event.pieces,
            event.room,
            lastStyle,
          );
          const studio = assembledSceneToStudio(partial);
          applyScene({
            furniture: studio.furniture,
            roomMeta: studio.roomMeta,
            walls: studio.walls,
            openings: studio.openings,
            styleBible: studio.style,
          });
          break;
        }

        case "piece_ready": {
          pieceReadyCount += 1;
          // Look up the specific piece description so the user sees
          // WHAT just rendered. Falls back to the generic counter
          // when we don't have a label (race conditions where
          // piece_ready arrives before the layout event was fully
          // recorded — shouldn't happen in normal flow but defensive).
          const label = pieceLabels.get(event.piece_id);
          const counter =
            layoutPieceCount > 0
              ? `${pieceReadyCount} of ${layoutPieceCount}`
              : `${pieceReadyCount}`;
          const stage = label
            ? `Rendered (${counter}): ${label}`
            : `Rendering mesh ${counter}…`;
          setGenerationStage(stage);
          params.onStage?.(stage);

          patchItemMeta(event.piece_id, {
            glbUrl: event.glb_url,
            previewGlbUrl: event.preview_glb_url,
          });
          break;
        }

        case "scene": {
          const studio = assembledSceneToStudio(event.scene);
          applyScene({
            furniture: studio.furniture,
            roomMeta: studio.roomMeta,
            walls: studio.walls,
            openings: studio.openings,
            styleBible: studio.style,
            referenceImageUrl: studio.referenceImageUrl,
          });
          freezeOriginalScene();

          setGenerationStage("Done");
          params.onStage?.("Done");
          // v0.40.31: derive partial-failure status from the scene.
          // failed_piece_ids was added by the orchestrator when any
          // per-piece mesh generation failed. Empty / undefined means
          // every piece's mesh succeeded.
          const failedIds = event.scene.failed_piece_ids ?? [];
          params.onComplete?.({
            kind: "complete",
            pieceCount: event.scene.pieces.length,
            failedPieceCount: failedIds.length,
            failedPieceIds: failedIds,
            style: event.scene.style,
            room: event.scene.room,
            pieceDescriptions: event.scene.pieces
              .slice(0, 6)
              .map((p) => p.description),
            scene: {
              furniture: studio.furniture,
              roomMeta: studio.roomMeta,
              walls: studio.walls,
              openings: studio.openings,
              style: studio.style,
            },
          });
          break;
        }

        case "error": {
          const friendly = friendlyError(event.message);
          setGenerationStage("");
          params.onComplete?.({
            kind: "error",
            message: friendly,
          });
          return;
        }

        case "progress": {
          const text = event.detail || event.stage;
          setGenerationStage(text);
          params.onStage?.(text);
          break;
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      setGenerationStage("");
      params.onComplete?.({ kind: "aborted" });
      return;
    }
    const message = err instanceof Error ? err.message : "Stream failed";
    const friendly = friendlyError(message);
    setGenerationStage("");
    params.onComplete?.({
      kind: "error",
      message: friendly,
    });
  } finally {
    setIsGenerating(false);
    // Leave stage text visible briefly so user sees "Done" before
    // it disappears. Clear only if no new run started in the
    // meantime.
    setTimeout(() => {
      if (!useStore.getState().isGenerating) {
        setGenerationStage("");
      }
    }, 2000);
  }
}

// ────────────────────────────────────────────────────────────────────
// Single-piece (asset) generation
// ────────────────────────────────────────────────────────────────────

export interface AssetRunResult {
  kind: "complete" | "error" | "aborted";
  /** Populated on success. The piece + GLB url are also added to the
   *  generations slice as a tile. */
  glbUrl?: string;
  imageUrl?: string;
  piece?: PieceRequest;
  style?: StyleBible;
  message?: string;
}

export interface AssetRunParams {
  prompt: string;
  signal: AbortSignal;
  /** Optional reference image (data URL or HTTPS) attached to the
   *  generation. When present, /api/generate-asset skips Flux
   *  entirely and feeds the reference straight to fal.ai's image-to-3D
   *  mesh provider — so "here's a photo of my couch" becomes a 3D mesh
   *  of that exact couch (within the model's reconstruction quality),
   *  not a stylized re-imagining of it. */
  referenceImageUrl?: string;
  onStage?: (stage: string) => void;
  tier?: "preview" | "hero";
}

/** Run a single-piece generation. Synchronous endpoint — no SSE. */
export async function runAssetGeneration(
  params: AssetRunParams,
): Promise<AssetRunResult> {
  const store = useStore.getState();
  const setIsGenerating = store.setIsGenerating;
  const setGenerationStage = store.setGenerationStage;

  setIsGenerating(true);
  setGenerationStage("Designing piece…");
  params.onStage?.("Designing piece…");

  try {
    const res = await fetch("/api/generate-asset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // v0.40.48: same auth-header fix as the room-stream path.
        // /api/generate-asset gates on Supabase Bearer auth in
        // production, and the chat-mode Furniture path never sent
        // the token — every generation 401'd silently. Reuses the
        // same helper as conversation-sync's getBearer().
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        prompt: params.prompt,
        tier: params.tier ?? "preview",
        referenceImageUrl: params.referenceImageUrl,
      }),
      signal: params.signal,
    });

    if (params.signal.aborted) {
      setGenerationStage("");
      return { kind: "aborted" };
    }

    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: `Request failed: ${res.status}` }));
      const friendly = friendlyError(
        (err as { error?: string }).error ?? `Status ${res.status}`,
      );
      setGenerationStage("");
      return { kind: "error", message: friendly };
    }

    const data = (await res.json()) as {
      glb_url: string;
      image_url: string;
      provider: string;
      duration_ms: number;
      piece: PieceRequest;
      style: StyleBible;
    };

    setGenerationStage("Done");
    params.onStage?.("Done");

    return {
      kind: "complete",
      glbUrl: data.glb_url,
      imageUrl: data.image_url,
      piece: data.piece,
      style: data.style,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      setGenerationStage("");
      return { kind: "aborted" };
    }
    const message = err instanceof Error ? err.message : "Request failed";
    const friendly = friendlyError(message);
    setGenerationStage("");
    return { kind: "error", message: friendly };
  } finally {
    setIsGenerating(false);
    setTimeout(() => {
      if (!useStore.getState().isGenerating) {
        setGenerationStage("");
      }
    }, 2000);
  }
}

// Re-export adapter helpers so consumers (chat-slice) only need this
// barrel.
export { pieceToFurniture };
export type { PlacedItem };
