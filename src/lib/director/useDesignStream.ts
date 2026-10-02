"use client";

/**
 * useDesignStream — orchestrates one whole-room generation run from
 * the client side. The chat-slice's "Room Layout" mode handler calls
 * `run(prompt)`, which:
 *
 *   1. Opens an SSE stream to /api/generate-room (with retry/backoff
 *      from streaming.ts).
 *   2. Routes events into the store as they arrive:
 *        intent     → stage text "Parsing intent…"
 *        style      → stage text "Style: <name>"; stash StyleBible
 *        layout     → applyScene with sceneSource = "room-director"
 *                     and placeholder pieces (no GLBs yet)
 *        piece_ready → patch matching furniture[i].meta.glbUrl
 *        scene      → final applyScene + freezeOriginalScene
 *        error      → push error bubble, clear isGenerating
 *        progress   → stage text update only
 *   3. Calls onTurnComplete with a final summary string for the chat
 *      bubble. That hooks back into chat-slice's existing conversation
 *      surface so generation status flows through the same UI as chat.
 *
 * Cancel: abortRef.current?.abort() — propagates to fetch (closes
 * connection) → server's req.signal → orchestrator's signal →
 * Promise.allSettled inside the per-piece loop completes in-flight
 * pieces but the loop bails on next iteration. fal.ai calls already
 * dispatched will continue to charge until they resolve (we can't
 * cancel them mid-call), but no further work is scheduled.
 */

import { useCallback, useRef } from "react";
import { useStore } from "@studio/store";
import { startDesignStream } from "./streaming";
import { assembledSceneToStudio } from "./adapter";
import type { AssembledScene, PlacedPiece, StyleBible } from "./schema";
import { friendlyError } from "@studio/utils/friendly-error";

export interface RunOptions {
  quality?: "preview" | "hero";
  skipStyleAnchor?: boolean;
  /** Called when the run reaches a terminal state (complete, error,
   *  or aborted). The chat-slice uses this to close out the
   *  conversation turn — pushing a final bubble with the status. */
  onTurnComplete?: (status: {
    kind: "complete" | "error" | "aborted";
    pieceCount?: number;
    message?: string;
  }) => void;
  /** Called on every progress / stage event so the chat surface can
   *  push stage text into the conversation as it streams. */
  onStage?: (stage: string) => void;
}

/** Build a partial AssembledScene from the layout event so we can
 *  feed the studio its placeholder pieces immediately. We don't have
 *  a styleBible yet at layout time (style event came earlier and was
 *  stashed via lastStyle), so we substitute a neutral one if it's
 *  somehow missing. */
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

export function useDesignStream() {
  const abortRef = useRef<AbortController | null>(null);
  // Track the most recent style event so layout (which can fire
  // before/after style) can use it.
  const lastStyleRef = useRef<StyleBible | null>(null);

  // Pull the slice actions we need. Each is referenced via selector
  // so React re-renders this component only if the action changes
  // identity (rare — actions are stable references in Zustand).
  const applyScene = useStore((s) => s.applyScene);
  const patchItemMeta = useStore((s) => s.patchItemMeta);
  const setSceneSource = useStore((s) => s.setSceneSource);
  const setIsGenerating = useStore((s) => s.setIsGenerating);
  const setGenerationStage = useStore((s) => s.setGenerationStage);
  const freezeOriginalScene = useStore((s) => s.freezeOriginalScene);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const run = useCallback(
    async (prompt: string, opts: RunOptions = {}) => {
      // Cancel any in-flight stream first. We can't have two
      // overlapping runs writing to the same store.
      cancel();
      lastStyleRef.current = null;

      const abort = new AbortController();
      abortRef.current = abort;

      setIsGenerating(true);
      setGenerationStage("Initializing…");
      opts.onStage?.("Initializing…");

      try {
        const stream = startDesignStream({
          prompt,
          quality: opts.quality ?? "preview",
          skipStyleAnchor: opts.skipStyleAnchor ?? false,
          signal: abort.signal,
        });

        let pieceReadyCount = 0;
        let layoutPieceCount = 0;

        for await (const event of stream) {
          switch (event.kind) {
            case "intent": {
              const stage = "Parsing intent…";
              setGenerationStage(stage);
              opts.onStage?.(stage);
              break;
            }

            case "style": {
              lastStyleRef.current = event.style;
              const stage = `Style: ${event.style.name}`;
              setGenerationStage(stage);
              opts.onStage?.(stage);
              break;
            }

            case "layout": {
              layoutPieceCount = event.pieces.length;
              const stage = `Placing ${event.pieces.length} piece${event.pieces.length === 1 ? "" : "s"}…`;
              setGenerationStage(stage);
              opts.onStage?.(stage);

              // Apply the partial scene: placeholders without GLBs
              // yet. Adapter handles z-UP → y-UP coords.
              const partial = assembleFromLayout(
                event.pieces,
                event.room,
                lastStyleRef.current,
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
              const stage = `Mesh ${pieceReadyCount}${
                layoutPieceCount > 0 ? ` of ${layoutPieceCount}` : ""
              }…`;
              setGenerationStage(stage);
              opts.onStage?.(stage);

              // Attach the GLB url to the matching piece in the
              // furniture array. Turn 4's GeneratedPieceMesh will
              // re-render and load the actual mesh.
              patchItemMeta(event.piece_id, {
                glbUrl: event.glb_url,
                previewGlbUrl: event.preview_glb_url,
              });
              break;
            }

            case "scene": {
              // Final assembled scene — apply it cleanly. This
              // overwrites the partial state from the layout event
              // with the same pieces but possibly with extra
              // metadata (reference image, layout archetype) and
              // the full set of walls/openings the orchestrator
              // produced.
              const studio = assembledSceneToStudio(event.scene);
              applyScene({
                furniture: studio.furniture,
                roomMeta: studio.roomMeta,
                walls: studio.walls,
                openings: studio.openings,
                styleBible: studio.style,
                referenceImageUrl: studio.referenceImageUrl,
              });

              // Freeze the originalScene baseline so Reset-to-original
              // can restore later.
              freezeOriginalScene();

              const stage = "Done";
              setGenerationStage(stage);
              opts.onStage?.(stage);

              opts.onTurnComplete?.({
                kind: "complete",
                pieceCount: event.scene.pieces.length,
              });
              break;
            }

            case "error": {
              const friendly = friendlyError(event.message);
              setGenerationStage("");
              opts.onTurnComplete?.({
                kind: "error",
                message: friendly,
              });
              return;
            }

            case "progress": {
              // Detail (when present) is more user-readable than the
              // raw stage. Default to the stage if no detail.
              const text = event.detail || event.stage;
              setGenerationStage(text);
              opts.onStage?.(text);
              break;
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User clicked stop.
          setGenerationStage("");
          opts.onTurnComplete?.({ kind: "aborted" });
          return;
        }
        const message = err instanceof Error ? err.message : "Stream failed";
        const friendly = friendlyError(message);
        setGenerationStage("");
        opts.onTurnComplete?.({
          kind: "error",
          message: friendly,
        });
      } finally {
        // Whatever happens, we leave isGenerating false so the chat
        // dock returns to its idle state.
        setIsGenerating(false);
        // Clear sceneSource? No — even on error we leave whatever
        // partial scene the user has. They can reset, edit, or
        // start a new generation.
        abortRef.current = null;
        // Keep stage text visible for ~2s so the user sees "Done"
        // before it disappears.
        setTimeout(() => {
          // Only clear if we're still not generating (a new run
          // would have replaced the stage already).
          if (!useStore.getState().isGenerating) {
            setGenerationStage("");
          }
        }, 2000);
      }
    },
    [
      applyScene,
      cancel,
      freezeOriginalScene,
      patchItemMeta,
      setGenerationStage,
      setIsGenerating,
      setSceneSource,
    ],
  );

  return { run, cancel };
}
