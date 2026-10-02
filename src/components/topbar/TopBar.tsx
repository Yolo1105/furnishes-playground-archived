"use client";

import { useEffect, useState } from "react";
import { useStore } from "@studio/store";
import { buildTourPath } from "@studio/three/tourPath";
import {
  UndoIcon,
  RedoIcon,
  HomeViewIcon,
  RotateCardinalIcon,
  ShuffleIcon,
  ClipboardListIcon,
  MapIcon,
  HelpCircleIcon,
  SparkleIcon,
  FootprintsIcon,
  RewindIcon,
  MoveIcon,
  MousePointerIcon,
  HandIcon,
  RulerIcon,
  ZoomInIcon,
  ZoomOutIcon,
  MaximizeIcon,
  PlusIcon,
  ChevronDownIcon,
  EyeIcon,
} from "@studio/icons";
import { TopBarButton, TopBarDivider } from "./TopBarButton";
import { ViewSettingsDropdown } from "./ViewSettingsDropdown";
import { ORTHO_VIEWS } from "@studio/views/cadOrtho";
import { CAD_EDGE_NUDGE_PX } from "@studio/layout/cadEdgeNudge";
import { isPlaygroundDemoApartmentProject } from "@studio/projects/playground-demo-constants";

/** Default top offset; CAD mode drops by the same nudge as edge cards. */
const TOP_BAR_TOP_PX = 14;

/**
 * Top-center toolbar. Morphs between studio (3D) controls and CAD
 * (2D) controls when the Reference swap flips `mainViewMode`, with a
 * short crossfade animation. In CAD/grid mode it also slides down a
 * little so the top ruler stays readable.
 *
 * Blank / 柜子 projects get a slim 3D bar (no walk / tour / planner).
 * Demo apartment keeps the full studio chrome.
 */
export function TopBar() {
  const mainViewMode = useStore((s) => s.mainViewMode);
  const cadMode = mainViewMode === "2d";
  const demoApartment = useStore((s) => {
    const p = s.projects.find((x) => x.id === s.currentProjectId);
    return isPlaygroundDemoApartmentProject(p);
  });

  return (
    <div
      data-top-bar="true"
      style={{
        position: "fixed",
        top: cadMode ? TOP_BAR_TOP_PX + CAD_EDGE_NUDGE_PX : TOP_BAR_TOP_PX,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 5,
        transition: "top 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        className="glass"
        style={{
          display: "inline-flex",
          alignItems: "center",
          borderRadius: 12,
          padding: 5,
          // Keep visible so CAD view / studio dropdowns aren't clipped.
          overflow: "visible",
          transition:
            "min-width 280ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 280ms ease",
        }}
      >
        <div
          key={cadMode ? "cad" : demoApartment ? "studio" : "panel"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 2,
            animation: "topbar-mode-in 280ms cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          <style>{`
            @keyframes topbar-mode-in {
              from { opacity: 0; transform: translateY(4px) scale(0.98); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            @media (prefers-reduced-motion: reduce) {
              @keyframes topbar-mode-in {
                from { opacity: 1; transform: none; }
                to   { opacity: 1; transform: none; }
              }
            }
          `}</style>
          {cadMode ? (
            <CadModeTools />
          ) : demoApartment ? (
            <StudioModeTools />
          ) : (
            <PanelDesignModeTools />
          )}
        </div>
      </div>
    </div>
  );
}

/** Slim 3D bar for blank 柜子 / panel projects — no room-tour chrome. */
function PanelDesignModeTools() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const undoDepth = useStore((s) => s.undoStack.length);
  const redoDepth = useStore((s) => s.redoStack.length);

  const tourActive = useStore((s) => s.tourActive);
  const stopTour = useStore((s) => s.stopTour);
  const setCameraMode = useStore((s) => s.setCameraMode);
  const resetCamera = useStore((s) => s.resetCamera);
  const shuffleCameraPreset = useStore((s) => s.shuffleCameraPreset);

  const rotateMode = useStore((s) => s.rotateMode);
  const setRotateMode = useStore((s) => s.setRotateMode);

  const translateMode = useStore((s) => s.translateMode);
  const setTranslateMode = useStore((s) => s.setTranslateMode);

  const toggleTool = useStore((s) => s.toggleTool);
  const setHelpModalOpen = useStore((s) => s.setHelpModalOpen);

  return (
    <>
      <TopBarButton
        onClick={() => undo()}
        disabled={undoDepth === 0}
        title={`Undo${undoDepth > 0 ? ` (${undoDepth})` : " — nothing to undo yet"}`}
      >
        <UndoIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => redo()}
        disabled={redoDepth === 0}
        title={`Redo${redoDepth > 0 ? ` (${redoDepth})` : " — nothing to redo"}`}
      >
        <RedoIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton
        onClick={() => {
          if (tourActive) stopTour();
          setCameraMode("orbit");
          resetCamera();
        }}
        title="Home view — reset camera if you get lost"
      >
        <HomeViewIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => shuffleCameraPreset()}
        title="Shuffle camera angle"
      >
        <ShuffleIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() =>
          setRotateMode(rotateMode === "cardinal" ? "off" : "cardinal")
        }
        title={
          rotateMode === "cardinal"
            ? "Cardinal rotate ON — Up / Down / Left / Right 90°"
            : "Cardinal rotate — Up / Down / Left / Right 90° steps"
        }
        active={rotateMode === "cardinal"}
      >
        <RotateCardinalIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => setTranslateMode(!translateMode)}
        title={translateMode ? "Move mode: ON" : "Move mode: OFF"}
        active={translateMode}
      >
        <MoveIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton
        onClick={() => toggleTool("catalog")}
        title="Add panel from catalog — Shelf, Divider, Back Panel"
      >
        <PlusIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton
        onClick={() => setHelpModalOpen(true)}
        title="Help — shortcuts + quick start"
      >
        <HelpCircleIcon size={14} />
      </TopBarButton>
    </>
  );
}

function StudioModeTools() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const undoDepth = useStore((s) => s.undoStack.length);
  const redoDepth = useStore((s) => s.redoStack.length);

  const cameraMode = useStore((s) => s.cameraMode);
  const setCameraMode = useStore((s) => s.setCameraMode);

  const tourActive = useStore((s) => s.tourActive);
  const startTour = useStore((s) => s.startTour);
  const stopTour = useStore((s) => s.stopTour);
  const customWaypoints = useStore((s) => s.customWaypoints);
  const furniture = useStore((s) => s.furniture);
  const apartmentCenter = useStore((s) => s.apartmentCenter);

  const resetCamera = useStore((s) => s.resetCamera);
  const shuffleCameraPreset = useStore((s) => s.shuffleCameraPreset);

  const rotateMode = useStore((s) => s.rotateMode);
  const setRotateMode = useStore((s) => s.setRotateMode);

  const translateMode = useStore((s) => s.translateMode);
  const setTranslateMode = useStore((s) => s.setTranslateMode);

  const originalScene = useStore((s) => s.originalScene);
  const resetToOriginalScene = useStore((s) => s.resetToOriginalScene);

  const setPlannerOpen = useStore((s) => s.setPlannerOpen);
  const setHelpModalOpen = useStore((s) => s.setHelpModalOpen);
  const setSuggestionsModalOpen = useStore((s) => s.setSuggestionsModalOpen);

  return (
    <>
      <TopBarButton
        onClick={() => undo()}
        disabled={undoDepth === 0}
        title={`Undo${undoDepth > 0 ? ` (${undoDepth})` : " — nothing to undo yet"}`}
      >
        <UndoIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => redo()}
        disabled={redoDepth === 0}
        title={`Redo${redoDepth > 0 ? ` (${redoDepth})` : " — nothing to redo"}`}
      >
        <RedoIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton
        onClick={() => {
          if (tourActive) stopTour();
          setCameraMode("orbit");
          resetCamera();
        }}
        title="Home view — reset camera if you get lost"
      >
        <HomeViewIcon size={14} />
      </TopBarButton>
      <TopBarButton onClick={() => shuffleCameraPreset()} title="Shuffle camera angle">
        <ShuffleIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() =>
          setRotateMode(rotateMode === "cardinal" ? "off" : "cardinal")
        }
        title={
          rotateMode === "cardinal"
            ? "Cardinal rotate ON — Up / Down / Left / Right 90°"
            : "Cardinal rotate — Up / Down / Left / Right 90° steps"
        }
        active={rotateMode === "cardinal"}
      >
        <RotateCardinalIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => setTranslateMode(!translateMode)}
        title={translateMode ? "Move mode: ON" : "Move mode: OFF"}
        active={translateMode}
      >
        <MoveIcon size={14} />
      </TopBarButton>

      {originalScene !== null && (
        <TopBarButton
          onClick={() => {
            if (
              typeof window !== "undefined" &&
              window.confirm(
                "Reset to the original generated scene? Your edits will be discarded.",
              )
            ) {
              resetToOriginalScene();
            }
          }}
          title="Reset to the original generated scene (discards edits)"
        >
          <RewindIcon size={14} />
        </TopBarButton>
      )}

      <TopBarDivider />

      <TopBarButton
        onClick={() => setCameraMode(cameraMode === "walk" ? "orbit" : "walk")}
        active={cameraMode === "walk"}
        title={
          cameraMode === "walk"
            ? "Exit walk mode (Esc)"
            : "Walk mode — first-person; WASD to move, mouse to look"
        }
      >
        <FootprintsIcon size={14} />
      </TopBarButton>
      <ViewSettingsDropdown />

      <TopBarDivider />

      <TopBarButton
        onClick={() => setPlannerOpen(true)}
        title="Planner — design requirements + AI options"
      >
        <ClipboardListIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => {
          if (tourActive) {
            stopTour();
            return;
          }
          const path = buildTourPath(
            customWaypoints,
            furniture,
            apartmentCenter,
          );
          if (path.length >= 2) startTour(path);
        }}
        active={tourActive}
        title={
          tourActive
            ? "Stop tour"
            : customWaypoints.length > 0
              ? `Start tour through your ${customWaypoints.length} waypoints`
              : "Start tour — auto-flythrough through key items"
        }
      >
        <MapIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton
        onClick={() => setSuggestionsModalOpen(true)}
        title="Design suggestions — proactive observations from the brain"
      >
        <SparkleIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => setHelpModalOpen(true)}
        title="Help — shortcuts + quick start"
      >
        <HelpCircleIcon size={14} />
      </TopBarButton>
    </>
  );
}

function CadModeTools() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const undoDepth = useStore((s) => s.undoStack.length);
  const redoDepth = useStore((s) => s.redoStack.length);

  const cadTool = useStore((s) => s.cadTool);
  const setCadTool = useStore((s) => s.setCadTool);
  const cadSnap = useStore((s) => s.cadSnap);
  const setCadSnap = useStore((s) => s.setCadSnap);
  const cadOrthoView = useStore((s) => s.cadOrthoView);
  const setCadOrthoView = useStore((s) => s.setCadOrthoView);
  const fitCadView = useStore((s) => s.fitCadView);
  const zoomCadView = useStore((s) => s.zoomCadView);
  const toggleTool = useStore((s) => s.toggleTool);

  const [viewOpen, setViewOpen] = useState(false);
  useEffect(() => {
    if (!viewOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-cad-view-menu]")) return;
      setViewOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [viewOpen]);

  const viewLabel =
    ORTHO_VIEWS.find((v) => v.id === cadOrthoView)?.label ?? "Front";

  return (
    <>
      <TopBarButton
        onClick={() => setCadTool("select")}
        active={cadTool === "select"}
        title="Select (V) — edit draft; drag empty space to pan"
      >
        <MousePointerIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => setCadTool("pan")}
        active={cadTool === "pan"}
        title="Pan (H / hold Space) — move the view without editing"
      >
        <HandIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => setCadTool("measure")}
        active={cadTool === "measure"}
        title="Measure (M) — click two points or drag for distance in mm"
      >
        <RulerIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton
        onClick={() => toggleTool("catalog")}
        title="Add from catalog"
      >
        <PlusIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton
        onClick={() => undo()}
        disabled={undoDepth === 0}
        title={`Undo${undoDepth > 0 ? ` (${undoDepth})` : ""}`}
      >
        <UndoIcon size={14} />
      </TopBarButton>
      <TopBarButton
        onClick={() => redo()}
        disabled={redoDepth === 0}
        title={`Redo${redoDepth > 0 ? ` (${redoDepth})` : ""}`}
      >
        <RedoIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton onClick={() => zoomCadView(1 / 1.15)} title="Zoom out">
        <ZoomOutIcon size={14} />
      </TopBarButton>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "rgba(26,26,26,0.55)",
          padding: "0 4px",
          fontFamily: "var(--font-app), system-ui, sans-serif",
          minWidth: 36,
          textAlign: "center",
        }}
      >
        Zoom
      </span>
      <TopBarButton onClick={() => zoomCadView(1.15)} title="Zoom in">
        <ZoomInIcon size={14} />
      </TopBarButton>
      <TopBarButton onClick={() => fitCadView()} title="Fit view">
        <MaximizeIcon size={14} />
      </TopBarButton>

      <TopBarDivider />

      <TopBarButton
        onClick={() => setCadSnap(!cadSnap)}
        active={cadSnap}
        title={cadSnap ? "Snap on (100 mm)" : "Snap off"}
      >
        <span style={{ fontSize: 10, fontWeight: 600 }}>100</span>
      </TopBarButton>

      <div style={{ position: "relative", zIndex: viewOpen ? 40 : undefined }} data-cad-view-menu="true">
        <TopBarButton
          onClick={() => setViewOpen((o) => !o)}
          active={viewOpen || cadOrthoView !== "front"}
          title="View — Front, Top, Back, Left, Right, Bottom"
          withChevron
        >
          <EyeIcon size={14} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              maxWidth: 52,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {viewLabel}
          </span>
          <ChevronDownIcon size={10} rotated={viewOpen} />
        </TopBarButton>
        {viewOpen && (
          <div
            className="glass-popover"
            role="menu"
            aria-label="Orthographic view"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              minWidth: 132,
              borderRadius: 10,
              padding: 4,
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              boxShadow: "0 12px 32px -12px rgba(26, 18, 10, 0.35)",
            }}
          >
            {ORTHO_VIEWS.map((v) => {
              const active = v.id === cadOrthoView;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setCadOrthoView(v.id);
                    setViewOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 7,
                    background: active
                      ? "rgba(255, 90, 31, 0.12)"
                      : "transparent",
                    color: active ? "#FF5A1F" : "#1A1A1A",
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    fontFamily: "var(--font-app), system-ui, sans-serif",
                    textAlign: "left",
                  }}
                >
                  <span>{v.label}</span>
                  {active ? "✓" : ""}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
