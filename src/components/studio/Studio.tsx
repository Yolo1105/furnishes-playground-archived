"use client";

import { useStore } from "@studio/store";
import { ChatDock } from "@studio/chat/ChatDock";
import { WaypointAuthoringPanel } from "@studio/tour/WaypointAuthoringPanel";
import { UploadModal } from "@studio/chat/UploadModal";
import { TopProjectCard } from "@studio/project/TopProjectCard";
import { ProjectsModal } from "@studio/project/ProjectsModal";
import { ToolsCard } from "@studio/tools/ToolsCard";
import { ToolFloatingCards } from "@studio/tools/ToolFloatingCard";
import { PlannerShell } from "@studio/planner/PlannerShell";
import { PropertiesCard } from "@studio/tools/PropertiesCard";
import { ImmersiveToast } from "@studio/shortcuts/ImmersiveToast";
import { TopBar } from "@studio/topbar/TopBar";
import { ComingSoonCard } from "@studio/topbar/ComingSoonCard";
import { HelpModal } from "@studio/topbar/HelpModal";
import { SuggestionsModal } from "@studio/suggestions/SuggestionsModal";
import { TourProgressOverlay } from "@studio/scene/TourProgressOverlay";
import { MainViewport } from "@studio/views/MainViewport";
import { StaggeredMount } from "@studio/studio/StaggeredMount";
import { useKeyboardShortcuts } from "@studio/hooks/useKeyboardShortcuts";
import { useStudioProjectsBootstrap } from "@studio/hooks/useStudioProjectsBootstrap";
import { usePersistence } from "@studio/persistence/usePersistence";
import { useCadEdgeNudge } from "@studio/hooks/useCadEdgeNudge";

/**
 * Top-level shell. Composes the layers of the app:
 *
 *   z=1   MainViewport — full-viewport 3D scene OR 2D floor plan
 *                        depending on `mainViewMode`. Swapped by
 *                        the Reference card's swap button.
 *   z=4   Tool floating cards (Reference, Pieces, Health). Each is
 *         independently draggable.
 *   z=5   Brand UI: TopProjectCard, ToolsCard, TopBar, ChatDock
 *         — hidden when immersive mode is active. All draggable
 *           except the chat dock and top bar (anchored controls).
 *   z=30  Top-bar dropdowns (env lighting picker)
 *   z=40+ ComingSoonCard backdrop + card
 *   z=50  ImmersiveToast — appears briefly on entry to immersive
 *   z=100 UploadModal, HelpModal — centered overlays
 *
 * Immersive mode (`H` to toggle, `Esc` to exit) hides every
 * floating UI surface so the user can see the main viewport
 * unobstructed. The floating UI is unmounted (not just visually
 * hidden) so its local dropdowns and hover states reset cleanly
 * between sessions.
 */
export function Studio() {
  useKeyboardShortcuts();
  useStudioProjectsBootstrap();
  usePersistence();
  useCadEdgeNudge();
  const immersive = useStore((s) => s.immersive);
  // Crossfade overlay state — true for ~500ms after a multi-piece
  // applyScene swap. The overlay is a full-viewport semi-transparent
  // layer that fades in and out, masking the scene swap so the user
  // sees a smooth "fade to cream → fade back to new scene" rather
  // than 8 pieces popping in instantly. Single-piece swaps don't
  // trigger this (sceneTransitionActive stays false) so the snappy
  // feel is preserved for those.
  const sceneTransitionActive = useStore((s) =>
    Boolean(
      (s as unknown as { sceneTransitionActive?: boolean })
        .sceneTransitionActive,
    ),
  );

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Main viewport — 3D scene or 2D floor plan. */}
      <MainViewport />

      {/* Crossfade overlay — pulses to ~85% opacity during the
          ~500ms window after a multi-piece scene swap, masking the
          replacement so the change feels intentional rather than
          jarring. The overlay's color matches the studio's cream
          background (#FFF5E8) so it reads as "the scene briefly
          dims and recomposes" rather than "a rectangle appears on
          top." pointer-events: none so it never blocks UI. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255, 245, 232, 0.85)",
          opacity: sceneTransitionActive ? 1 : 0,
          // The fade-in is faster than the fade-out: dim quickly,
          // reveal slowly. This matches how the eye actually handles
          // sudden visual change — a hard cut feels worse than
          // anything else, and a slow fade-in to the new scene
          // gives the brain time to reorient.
          transition: sceneTransitionActive
            ? "opacity 120ms ease-out"
            : "opacity 380ms ease-in",
          pointerEvents: "none",
          zIndex: 3,
        }}
      />

      {/* Empty-canvas hero removed — blank projects use the CAD
          workplane; a centered sparkle hero blinked on project switch
          and competed with the drafting surface. */}

      {/* Floating UI surfaces — hidden during immersive mode. Each is
          wrapped in StaggeredMount so the surfaces fade in over ~1
          second on first paint (TopBar first, then the corner cards,
          then chat). Reads like a real product loading itself in
          rather than every card appearing simultaneously. The wrapper
          is opacity-only — fixed-positioned children's anchors are
          preserved. prefers-reduced-motion users skip the animation.

          v0.40.42: instead of mounting/unmounting on `immersive`
          (hard cut), keep the tree mounted and animate
          opacity + transform when immersive toggles. The user
          reported that pressing H to hide caused everything to
          vanish abruptly, then reappear with a jarring layout
          jolt because each StaggeredMount re-ran its animation
          schedule. Now the tree stays mounted: hidden via opacity:0
          with pointerEvents:none + a subtle 4px upward translate to
          give the fade a sense of "lifting away" rather than just
          dimming.

          v0.40.45 CRITICAL FIX: dropped the transform.
          ANY transform on an ancestor (including transform:
          translateY(0) — the identity case) creates a new containing
          block for position:fixed descendants per CSS spec. That
          broke EVERY fixed-positioned UI surface inside this wrapper:
          TopBar, TopProjectCard, ToolsCard, the floating tool cards,
          PropertiesCard, ChatDock — they all became positioned
          relative to this 0-height wrapper instead of the viewport.
          Result: the user couldn't see the chat input box and
          couldn't click anything because nothing was where it should
          be on screen. Opacity alone gives us the fade without
          breaking layout. */}
      <div
        aria-hidden={immersive}
        style={{
          opacity: immersive ? 0 : 1,
          transition: "opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          pointerEvents: immersive ? "none" : "auto",
        }}
      >
        <StaggeredMount delayMs={120}>
          <TopBar />
        </StaggeredMount>
        <StaggeredMount delayMs={240}>
          <TopProjectCard />
        </StaggeredMount>
        <StaggeredMount delayMs={360}>
          <ToolsCard />
        </StaggeredMount>
        <StaggeredMount delayMs={480}>
          <ToolFloatingCards />
        </StaggeredMount>
        <StaggeredMount delayMs={480}>
          <PropertiesCard />
        </StaggeredMount>
        <StaggeredMount delayMs={620}>
          <ChatDock />
        </StaggeredMount>
        {/* Waypoint authoring panel — self-gates on
            waypointMode. Top-center overlay with current count
            + Clear / Play / Done controls. */}
        <WaypointAuthoringPanel />
      </div>

      {/* Modals + ambient toasts. Store-driven visibility; mounted
          unconditionally so they can fire even from immersive
          escape paths. */}
      <UploadModal />
      <HelpModal />
      <SuggestionsModal />
      <ComingSoonCard />
      {/* Projects CRUD modal — opens via "See all projects" row in
          the TopProjectCard dropdown. Centered glass modal with the
          full list (rename/delete/switch/create). Self-gates render
          on projectsModalOpen flag. */}
      <ProjectsModal />
      {/* Planner workspace modal — opens via setPlannerOpen(true)
          from Tools card's Planner tile or top-bar Planner button.
          Self-gates render on plannerOpen flag so this mount is
          essentially free until the user opens it. */}
      <PlannerShell />
      <ImmersiveToast />
      {/* Tour progress overlay — self-gates on tourActive, mounts
          unconditionally so it shows up even in immersive mode
          (the user might trigger a tour, then enter immersive). */}
      <TourProgressOverlay />
    </div>
  );
}
