import type { StateCreator } from "zustand";
import { TOOL_NAME_TO_CARD_ID, isTopStackCard } from "./card-positions-slice";

/**
 * Environment-lighting presets. Mirrors a subset of drei's built-in
 * HDRI environments — only the values we expose in the picker. The
 * actual scene wiring lands later; today the value just lives in the
 * store so the dropdown can show a check on the active option.
 */
export type EnvPreset =
  | "apartment"
  | "city"
  | "dawn"
  | "forest"
  | "lobby"
  | "night"
  | "park"
  | "studio"
  | "sunset"
  | "warehouse";

export const ENV_PRESETS: { value: EnvPreset; label: string }[] = [
  { value: "apartment", label: "Apartment" },
  { value: "city", label: "City" },
  { value: "dawn", label: "Dawn" },
  { value: "forest", label: "Forest" },
  { value: "lobby", label: "Lobby" },
  { value: "night", label: "Night" },
  { value: "park", label: "Park" },
  { value: "studio", label: "Studio" },
  { value: "sunset", label: "Sunset" },
  { value: "warehouse", label: "Warehouse" },
];

/**
 * Identifier for a "Coming soon" placeholder card that the top bar can
 * show. `null` when no card is open. Adding a new top-bar entry that
 * needs a Coming-soon experience just means adding a new union value.
 */
export type ComingSoonTarget = "tour" | null;

/**
 * Identifier for one of the floating tool cards that the user can
 * open from the Tools card. Each tool may be open or closed
 * independently — multiple tools can be open at once and overlap on
 * the canvas. The "active" pill state in the Tools list is driven
 * by membership in `openTools`.
 *
 * `catalog` opens a floating picker (square/rect pieces) beside Tools;
 * `inventory` opens a side card listing what's currently placed.
 * The two were previously labeled "Pieces" and "Inventory" but their
 * jobs overlapped — Catalog now unambiguously means "the place to
 * add things" and Inventory means "what's already in your scene."
 */
export type ToolName =
  | "reference"
  | "catalog"
  | "inventory"
  | "generations"
  | "chat-history"
  | "starred"
  | "room-grid";

/**
 * Which view fills the main viewport. The Reference tool's swap
 * button flips this between 3D (the GLB scene) and 2D (a top-down
 * SVG floor plan). The reference card itself shows the *other*
 * mode, so the two views are always paired.
 */
export type MainViewMode = "3d" | "2d";

/**
 * UI-flags slice — ephemeral display-state toggles that don't belong
 * to chat content, projects, or history. As tools come online in
 * later steps each tool's open/closed state will land here too.
 */
export interface UiFlagsSlice {
  /** Centered upload-image modal is visible. */
  uploadModalOpen: boolean;
  /** Quick-suggestion chip strip is visible above the input. */
  suggestionsOpen: boolean;
  /** Immersive mode — every floating UI surface is hidden, only the
   *  3D scene is visible. Toggled with the `H` key; exited with
   *  `Esc` or `H`. */
  immersive: boolean;

  /** Top-bar help / quick-start modal is visible. */
  helpModalOpen: boolean;
  /** Top-bar suggestions modal is visible. Turn 5+. */
  suggestionsModalOpen: boolean;
  /** Which top-bar Coming-soon placeholder card is showing
   *  (tour / null). The "planner" target was retired in
   *  Phase F1 — Planner now opens its own real workspace
   *  via `plannerOpen` instead of showing a coming-soon stub. */
  comingSoonCard: ComingSoonTarget;
  /** Whether the Planner workspace modal is open. The Planner
   *  is a centered modal opened from the Tools card's Planner
   *  tile (and also from the top-bar Planner button). It hosts
   *  internal tabs for Requirements / Options / Inspect / etc.;
   *  Phase F1 ships the Requirements tab with the rest as
   *  placeholders. */
  plannerOpen: boolean;
  /** Whether the projects-CRUD modal is open. Centered modal sized
   *  like the Catalog modal — list of all projects with rename,
   *  delete, switch, and create. Opened from the TopProjectCard
   *  dropdown's "See all projects" row. */
  projectsModalOpen: boolean;

  /** Whether the Tools card itself is expanded (showing the tool
   *  list) or collapsed to a "Tools" pill. */
  toolsCardOpen: boolean;
  /** Which tool floating cards are currently open. Multiple tools
   *  may be open at once; clicking a tool tile toggles membership
   *  in this set. */
  openTools: ToolName[];

  /** Which view fills the main viewport. The Reference card's
   *  swap button flips this between 3D and 2D; the Reference card
   *  always shows whichever the main view is NOT. */
  mainViewMode: MainViewMode;
  /** Size of the Reference card. Driven by its four-corner resize
   *  handle. Stored in the slice so positions and sizes survive
   *  re-renders together. */
  referenceSize: { width: number; height: number };

  /** Top-bar visual toggles. The 3D scene reads these and adjusts
   *  itself: `showHotspots` renders clickable accent disks on the
   *  floor; `envPreset` swaps the drei <Environment> HDRI;
   *  `showWireframe` draws mesh wireframe overlays (selection +
   *  placeholder X-grid). */
  showHotspots: boolean;
  showWireframe: boolean;
  envPreset: EnvPreset;

  /** v0.40.47: cardinal lights inspection mode. When true, the
   *  Scene replaces its single warm-key + cool-fill rig with four
   *  equal-strength directional lights from N / S / E / W. Used
   *  to inspect generated furniture meshes — fills every face from
   *  every horizontal direction so albedo issues, baked shadows
   *  in textures, and one-sided materials are easy to spot. The
   *  HDRI environment lighting still contributes for reflections;
   *  only the directional rig changes. */
  cardinalLightsMode: boolean;

  /** Camera control: monotonically increasing version stamp that
   *  the Scene's OrbitControls watches; bumping it triggers a snap
   *  back to the default camera position. */
  cameraResetVersion: number;
  /** Camera control: index into the cinematic-preset list. The
   *  Scene flies the camera to the matching preset whenever this
   *  changes. The "Shuffle" top-bar button advances this index. */
  cameraPresetIndex: number;
  /** Ad-hoc camera fly target — used by floor hotspots and any
   *  other one-shot camera move. The CameraController watches
   *  the version field and animates when it bumps. */
  pendingCameraFly: {
    position: [number, number, number];
    target: [number, number, number];
    version: number;
  } | null;

  setUploadModalOpen: (b: boolean) => void;
  setSuggestionsOpen: (b: boolean) => void;
  toggleSuggestions: () => void;
  setImmersive: (b: boolean) => void;

  setHelpModalOpen: (b: boolean) => void;
  setSuggestionsModalOpen: (b: boolean) => void;
  setComingSoonCard: (target: ComingSoonTarget) => void;
  setPlannerOpen: (b: boolean) => void;
  setProjectsModalOpen: (b: boolean) => void;

  setToolsCardOpen: (b: boolean) => void;
  toggleTool: (tool: ToolName) => void;
  closeTool: (tool: ToolName) => void;
  swapMainViewMode: () => void;
  /** Direct setter for main view mode. Used by chat-slice when
   *  starting a Room Layout generation — flips main view to 2D so
   *  the floor plan IS the deliverable, not a side reference. */
  setMainViewMode: (m: MainViewMode) => void;
  setReferenceSize: (size: { width: number; height: number }) => void;

  /** CAD (main 2D) tool palette — driven by the top bar when
   *  `mainViewMode === "2d"`. CadWorkplane reads these. */
  cadTool: "select" | "pan" | "measure";
  cadSnap: boolean;
  cadOrthoView:
    | "front"
    | "back"
    | "top"
    | "bottom"
    | "left"
    | "right";
  /** Bumped to ask CadWorkplane to fit the subject. */
  cadFitNonce: number;
  /** Bumped with `cadZoomFactor` to zoom toward view center. */
  cadZoomNonce: number;
  cadZoomFactor: number;
  setCadTool: (t: "select" | "pan" | "measure") => void;
  setCadSnap: (b: boolean) => void;
  setCadOrthoView: (
    v: "front" | "back" | "top" | "bottom" | "left" | "right",
  ) => void;
  fitCadView: () => void;
  zoomCadView: (factor: number) => void;

  /**
   * Rotation UI for the selected piece:
   *   - `"off"`      — no rotate chrome
   *   - `"cardinal"` — 上下左右 step buttons (90°)
   */
  rotateMode: "off" | "cardinal";
  setRotateMode: (m: "off" | "cardinal") => void;

  /** When true, the translation gizmo (axis arrows + center pad)
   *  renders around the selected item. Drag any arrow to slide the
   *  item along that axis; drag the center pad to slide it freely
   *  on the floor. Like rotateMode, default false — gated by an
   *  explicit topbar toggle so the scene stays clean.
   */
  translateMode: boolean;
  setTranslateMode: (b: boolean) => void;

  setShowHotspots: (b: boolean) => void;
  setShowWireframe: (b: boolean) => void;
  setEnvPreset: (preset: EnvPreset) => void;
  setCardinalLightsMode: (b: boolean) => void;
  toggleCardinalLightsMode: () => void;

  /** Fire a camera reset. Bumps `cameraResetVersion`; Scene
   *  reacts by snapping back to the default camera position. */
  resetCamera: () => void;
  /** Advance the cinematic preset index by 1 (wrapping). */
  shuffleCameraPreset: () => void;
  /** Ad-hoc fly to a position + look-at target. */
  flyCameraTo: (
    position: [number, number, number],
    target: [number, number, number],
  ) => void;
}

export const createUiFlagsSlice: StateCreator<UiFlagsSlice> = (set) => ({
  uploadModalOpen: false,
  suggestionsOpen: false,
  immersive: false,

  helpModalOpen: false,
  suggestionsModalOpen: false,
  comingSoonCard: null,
  plannerOpen: false,
  projectsModalOpen: false,

  toolsCardOpen: true,
  // Reference + Inventory + Generations are open by default. Inventory
  // and Generations both self-hide when their data is empty (no placed
  // furniture, no asset generations) so the user sees only Reference
  // on a fresh blank canvas. The moment a generation lands, both fill
  // in automatically — no need for the user to first click the Tools
  // tile to "enable" them.
  openTools: ["reference", "inventory"],
  mainViewMode: "3d",
  referenceSize: { width: 420, height: 300 },
  rotateMode: "off",
  translateMode: false,

  cadTool: "select",
  cadSnap: true,
  cadOrthoView: "front",
  cadFitNonce: 0,
  cadZoomNonce: 0,
  cadZoomFactor: 1,

  showHotspots: false,
  showWireframe: false,
  envPreset: "apartment",
  cardinalLightsMode: false,

  cameraResetVersion: 0,
  cameraPresetIndex: 0,
  pendingCameraFly: null,

  setUploadModalOpen: (b) => set({ uploadModalOpen: b }),
  setSuggestionsOpen: (b) => set({ suggestionsOpen: b }),
  toggleSuggestions: () =>
    set((s) => ({ suggestionsOpen: !s.suggestionsOpen })),
  setImmersive: (b) => set({ immersive: b }),

  setHelpModalOpen: (b) => set({ helpModalOpen: b }),
  setSuggestionsModalOpen: (b) => set({ suggestionsModalOpen: b }),
  setComingSoonCard: (target) => set({ comingSoonCard: target }),
  setPlannerOpen: (b) => set({ plannerOpen: b }),
  setProjectsModalOpen: (b) => set({ projectsModalOpen: b }),

  setToolsCardOpen: (b) => set({ toolsCardOpen: b }),
  toggleTool: (tool) =>
    set((s) => {
      const isOpen = s.openTools.includes(tool);
      const cardId = TOOL_NAME_TO_CARD_ID[tool];
      const ranks =
        (s as { cardStackRank?: Partial<Record<string, number>> })
          .cardStackRank ?? {};
      const seq =
        (s as { cardStackSeq?: number }).cardStackSeq ?? 0;

      if (isOpen) {
        // Already open — raise it instead of closing on this click,
        // unless it's already the topmost (then close).
        if (cardId && !isTopStackCard(cardId, ranks)) {
          const nextSeq = seq + 1;
          return {
            cardStackSeq: nextSeq,
            cardStackRank: { ...ranks, [cardId]: nextSeq },
          } as never;
        }
        return {
          openTools: s.openTools.filter((t) => t !== tool),
        };
      }
      if (cardId) {
        const nextSeq = seq + 1;
        return {
          openTools: [...s.openTools, tool],
          cardStackSeq: nextSeq,
          cardStackRank: { ...ranks, [cardId]: nextSeq },
        } as never;
      }
      return {
        openTools: [...s.openTools, tool],
      };
    }),
  closeTool: (tool) =>
    set((s) => ({ openTools: s.openTools.filter((t) => t !== tool) })),
  swapMainViewMode: () =>
    set((s) => ({ mainViewMode: s.mainViewMode === "3d" ? "2d" : "3d" })),
  setMainViewMode: (m) => set({ mainViewMode: m }),
  setReferenceSize: (size) => set({ referenceSize: size }),
  setCadTool: (t) => set({ cadTool: t }),
  setCadSnap: (b) => set({ cadSnap: b }),
  setCadOrthoView: (v) => set({ cadOrthoView: v }),
  fitCadView: () => set((s) => ({ cadFitNonce: s.cadFitNonce + 1 })),
  zoomCadView: (factor) =>
    set((s) => ({
      cadZoomNonce: s.cadZoomNonce + 1,
      cadZoomFactor: factor,
    })),
  setRotateMode: (m) => set({ rotateMode: m }),
  setTranslateMode: (b) => set({ translateMode: b }),

  setShowHotspots: (b) => set({ showHotspots: b }),
  setShowWireframe: (b) => set({ showWireframe: b }),
  setEnvPreset: (preset) => set({ envPreset: preset }),
  setCardinalLightsMode: (b) => set({ cardinalLightsMode: b }),
  toggleCardinalLightsMode: () =>
    set((s) => ({ cardinalLightsMode: !s.cardinalLightsMode })),

  resetCamera: () =>
    set((s) => ({ cameraResetVersion: s.cameraResetVersion + 1 })),
  shuffleCameraPreset: () =>
    set((s) => ({ cameraPresetIndex: s.cameraPresetIndex + 1 })),
  flyCameraTo: (position, target) =>
    set((s) => ({
      pendingCameraFly: {
        position,
        target,
        version: (s.pendingCameraFly?.version ?? 0) + 1,
      },
    })),
});
