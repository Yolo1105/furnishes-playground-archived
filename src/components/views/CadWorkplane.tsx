"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "@studio/store";
import {
  ORTHO_VIEWS,
  draftToBox,
  placedItemToBoxMm,
  projectBox,
  sortOrthoDrawOrder,
  type OrthoView,
} from "./cadOrtho";
import { CadOrthoSubject } from "./CadOrthoSubject";
import { DEFAULT_CAD_DRAFT, isDraftCadSubject, isLegacyRoomDraft } from "@studio/cad/draftRoom";
import {
  isSnapPanel,
  magneticSnapPanelView,
  resolveStudioY,
  snapNeighborsFor,
} from "@studio/collision/magneticSnap";

/**
 * CadWorkplane — interactive drafting page for empty (non-demo)
 * projects. Units are millimetres. Orthographic views (Front / Top /
 * Left …) project a single draft panel or selected piece with
 * dimension labels.
 *
 * Tools (exclusive; Space temporarily pans from any of them):
 *   • Select  — drag carcass panels (view-aware magnets), resize
 *               draft edges, drag draft interior; empty canvas pans
 *   • Pan     — navigate only (no edits)
 *   • Measure — two-point / drag distance in mm
 *
 * Demo apartment keeps the hardcoded GLB floor plan. Generated rooms
 * use RoomDirectorCadPlan.
 */

interface CadWorkplaneProps {
  compact?: boolean;
}

// Studio tokens — translucent so floating Reference / full CAD
// don't paint an opaque white slab over the page / other views.
const PAPER = "transparent";
const RULER_BG = "rgba(255, 250, 244, 0.1)";
const EDGE = "rgba(124, 80, 50, 0.18)";
const INK = "#1A1A1A";
const GRID_MINOR = "rgba(124, 80, 50, 0.12)";
const GRID_MAJOR = "rgba(124, 80, 50, 0.22)";
const TICK = "rgba(26, 26, 26, 0.4)";
const LABEL = "rgba(26, 26, 26, 0.52)";
const ACCENT = "#FF5A1F";
const MEASURE = "#1a5f8a";

const SNAP_MM = 100;
const MIN_PX_PER_MM = 0.04;
const MAX_PX_PER_MM = 8;
/** Fallback when store draft is not yet seeded. */
const DEFAULT_DRAFT = { ...DEFAULT_CAD_DRAFT };

type Camera = { cx: number; cy: number; pxPerMm: number };
type Tool = "select" | "pan" | "measure";
type Edge = "n" | "e" | "s" | "w";
type DraftRect = { minX: number; minY: number; maxX: number; maxY: number };
type Pt = { x: number; y: number };

function niceStep(mmPerLabel: number): number {
  const raw = Math.max(1, mmPerLabel);
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const n = raw / base;
  if (n <= 1) return base;
  if (n <= 2) return 2 * base;
  if (n <= 5) return 5 * base;
  return 10 * base;
}

function snapValue(v: number, step: number, enabled: boolean): number {
  if (!enabled || step <= 0) return v;
  return Math.round(v / step) * step;
}

function formatMm(v: number): string {
  const r = Math.round(v * 10) / 10;
  if (Math.abs(r) >= 1000) {
    const m = r / 1000;
    return `${Number(m.toFixed(2))} m`;
  }
  return `${r % 1 === 0 ? r : r.toFixed(1)} mm`;
}

function formatCoord(v: number): string {
  const r = Math.round(v);
  return `${r}`;
}

function isMultiple(v: number, step: number): boolean {
  if (step <= 0) return false;
  const n = Math.round(v / step);
  return Math.abs(v - n * step) < step * 1e-6;
}

/** Map a drag delta in projected mm (u,v) to world metres for the view. */
function projectedDeltaToWorldM(
  duMm: number,
  dvMm: number,
  view: OrthoView,
): { dx: number; dz: number; dStudioY: number } {
  const du = duMm / 1000;
  const dv = dvMm / 1000;
  switch (view) {
    case "front":
      return { dx: du, dz: 0, dStudioY: dv };
    case "back":
      return { dx: -du, dz: 0, dStudioY: dv };
    case "top":
      return { dx: du, dz: dv, dStudioY: 0 };
    case "bottom":
      return { dx: du, dz: -dv, dStudioY: 0 };
    case "left":
      // Looking toward +X: u = −Y (depth), v = height.
      return { dx: 0, dz: -du, dStudioY: dv };
    case "right":
      return { dx: 0, dz: du, dStudioY: dv };
  }
}

function hitProjectedPiece(
  p: Pt,
  pieces: Array<{ id: string; projected: { u0: number; u1: number; v0: number; v1: number } }>,
  preferId: string | null,
): string | null {
  const inside = (
    id: string,
    proj: { u0: number; u1: number; v0: number; v1: number },
  ) => {
    const x0 = Math.min(proj.u0, proj.u1);
    const x1 = Math.max(proj.u0, proj.u1);
    const y0 = Math.min(proj.v0, proj.v1);
    const y1 = Math.max(proj.v0, proj.v1);
    // Thin boards need a minimum hit pad in mm.
    const padX = Math.max(0, (8 - (x1 - x0)) / 2);
    const padY = Math.max(0, (8 - (y1 - y0)) / 2);
    return (
      p.x >= x0 - padX &&
      p.x <= x1 + padX &&
      p.y >= y0 - padY &&
      p.y <= y1 + padY
    );
  };
  if (preferId) {
    const pref = pieces.find((x) => x.id === preferId);
    if (pref && inside(pref.id, pref.projected)) return pref.id;
  }
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i]!;
    if (inside(piece.id, piece.projected)) return piece.id;
  }
  return null;
}

export function CadWorkplane({ compact = false }: CadWorkplaneProps) {
  const ruler = compact ? 0 : 26;
  const statusH = compact ? 0 : 28;
  const fontSize = 9;

  const planeRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [camera, setCamera] = useState<Camera>({
    cx: 2000,
    cy: 1500,
    pxPerMm: 0.18,
  });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const storeDraft = useStore((s) => s.cadDraft);
  const applyCadDraft = useStore((s) => s.applyCadDraft);
  const [draft, setDraftLocal] = useState<DraftRect>(
    () => storeDraft ?? DEFAULT_DRAFT,
  );
  const [measureFrom, setMeasureFrom] = useState<Pt | null>(null);
  const [measureTo, setMeasureTo] = useState<Pt | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  // Ensure blank projects show the open-front 柜子 (not leftover
  // draft panels / apartment inventory).
  useEffect(() => {
    const s = useStore.getState();
    const blank = Boolean(
      s.projects.find((p) => p.id === s.currentProjectId)?.blankScene,
    );
    if (!blank) return;
    const furniture = s.furniture ?? [];
    const hasCarcass = furniture.some(
      (f) =>
        f.meta?.source === "carcass-panel" ||
        Boolean(f.id?.startsWith("carcass-")),
    );
    const hasJunk = furniture.some(
      (f) =>
        f.meta?.source !== "carcass-panel" &&
        !f.id?.startsWith("carcass-") &&
        f.placed !== false,
    );
    const d = s.cadDraft;
    const thinLegacy =
      d != null &&
      Math.abs(d.maxX - d.minX) <= 40 &&
      Math.abs(d.maxY - d.minY) <= 500;
    if (
      !hasCarcass ||
      hasJunk ||
      !d ||
      isLegacyRoomDraft(d) ||
      thinLegacy ||
      (s.walls?.length ?? 0) > 0
    ) {
      applyCadDraft(
        d && !isLegacyRoomDraft(d) && !thinLegacy && hasCarcass && !hasJunk
          ? d
          : { ...DEFAULT_CAD_DRAFT },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
  }, []);

  // Keep local draft in sync when the store seeds / project switches.
  useEffect(() => {
    if (storeDraft) setDraftLocal(storeDraft);
  }, [storeDraft]);

  const setDraft = useCallback(
    (next: DraftRect | ((prev: DraftRect) => DraftRect)) => {
      setDraftLocal((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        // Defer store write so we don't setState-during-setState.
        queueMicrotask(() => applyCadDraft(resolved));
        return resolved;
      });
    },
    [applyCadDraft],
  );

  // Main CAD reads tools from the top bar store; Reference compact
  // stays a quiet pan-only grid (ignores CAD top-bar state).
  const storeTool = useStore((s) => s.cadTool);
  const storeSnap = useStore((s) => s.cadSnap);
  const storeOrthoView = useStore((s) => s.cadOrthoView);
  const setCadTool = useStore((s) => s.setCadTool);
  const cadFitNonce = useStore((s) => s.cadFitNonce);
  const cadZoomNonce = useStore((s) => s.cadZoomNonce);
  const cadZoomFactor = useStore((s) => s.cadZoomFactor);

  const tool: Tool = compact ? "pan" : storeTool;
  const snap = compact ? true : storeSnap;
  const mainViewMode = useStore((s) => s.mainViewMode);

  const furniture = useStore((s) => s.furniture);
  const selectedItem = useStore((s) => {
    if (!s.selectedId) return null;
    return (s.furniture ?? []).find((f) => f.id === s.selectedId) ?? null;
  });

  const placedPieces = useMemo(
    () =>
      (furniture ?? []).filter(
        (f) => f.placed && f.visible !== false && f.width > 0 && f.depth > 0,
      ),
    [furniture],
  );

  // Shared ortho view for Reference (compact) and main CAD grid —
  // both read `cadOrthoView` so changing Front/Left/… in grid mode
  // sticks when you swap back to Reference.
  const orthoView: OrthoView = storeOrthoView;

  /** Every placed piece projected into the active ortho view.
   *  Elevations: large faces first so interior shelves aren't covered. */
  const pieceViews = useMemo(() => {
    const views = placedPieces.map((p) => ({
      id: p.id,
      selected: selectedItem?.id === p.id,
      projected: projectBox(placedItemToBoxMm(p), orthoView),
    }));
    return sortOrthoDrawOrder(views, orthoView);
  }, [placedPieces, orthoView, selectedItem?.id]);

  const subjectBox = useMemo(() => {
    if (
      selectedItem &&
      selectedItem.placed &&
      selectedItem.width > 0 &&
      selectedItem.depth > 0 &&
      !isDraftCadSubject(selectedItem)
    ) {
      return placedItemToBoxMm(selectedItem);
    }
    return draftToBox(draft);
  }, [selectedItem, draft]);

  const draftProjected = useMemo(
    () => projectBox(subjectBox, orthoView),
    [subjectBox, orthoView],
  );

  // Fit camera to all pieces when we have them (Reference + elevations);
  // otherwise the single draft / selection subject.
  const projected = useMemo(() => {
    if (pieceViews.length === 0) return draftProjected;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pieceViews) {
      u0 = Math.min(u0, p.projected.u0, p.projected.u1);
      u1 = Math.max(u1, p.projected.u0, p.projected.u1);
      v0 = Math.min(v0, p.projected.v0, p.projected.v1);
      v1 = Math.max(v1, p.projected.v0, p.projected.v1);
    }
    return {
      ...draftProjected,
      u0,
      u1,
      v0,
      v1,
      widthMm: Math.max(1, u1 - u0),
      heightMm: Math.max(1, v1 - v0),
    };
  }, [pieceViews, draftProjected]);

  const planEditable = orthoView === "top" || orthoView === "bottom";
  const usingPiece = Boolean(
    selectedItem &&
      selectedItem.placed &&
      selectedItem.width > 0 &&
      !isDraftCadSubject(selectedItem),
  );

  const selectFurniture = useStore((s) => s.selectFurniture);
  const setItemTransform = useStore((s) => s.setItemTransform);

  const gesture = useRef<
    | null
    | {
        kind: "pan";
        sx: number;
        sy: number;
        cx: number;
        cy: number;
      }
    | {
        kind: "edge";
        edge: Edge;
        start: DraftRect;
      }
    | {
        kind: "move";
        start: DraftRect;
        ox: number;
        oy: number;
      }
    | {
        kind: "piece-move";
        id: string;
        startX: number;
        startZ: number;
        startStudioY: number;
        ox: number;
        oy: number;
      }
    | {
        kind: "measure";
        from: Pt;
      }
  >(null);

  // Fit subject once we know plane size (and when view / subject changes).
  const fitted = useRef(false);
  const fitToProjected = useCallback(
    (proj = projected, planeW = size.w, planeH = size.h) => {
      if (planeW < 2 || planeH < 2) return;
      const subjW = Math.max(1, Math.abs(proj.u1 - proj.u0));
      const subjH = Math.max(1, Math.abs(proj.v1 - proj.v0));
      // Fill most of the viewport with the panel (Reference tighter).
      // Old fixed 400 mm margins left a tiny speck on an 18×350 board.
      const fill = compact ? 0.82 : 0.7;
      const pxPerMm = Math.min(
        (planeW * fill) / subjW,
        (planeH * fill) / subjH,
      );
      setCamera({
        cx: (proj.u0 + proj.u1) / 2,
        cy: (proj.v0 + proj.v1) / 2,
        pxPerMm: Math.max(
          MIN_PX_PER_MM,
          Math.min(MAX_PX_PER_MM, pxPerMm || 0.18),
        ),
      });
    },
    [compact, projected, size.w, size.h],
  );

  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr || cr.width < 2 || cr.height < 2) return;
      setSize({ w: cr.width, h: cr.height });
      if (!fitted.current) {
        fitted.current = true;
        fitToProjected(projected, cr.width, cr.height);
      } else if (compact) {
        // Reference often lays out after mount — keep the panel framed.
        fitToProjected(projected, cr.width, cr.height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, fitToProjected, projected]);

  // Re-fit when the subject size changes (draft migrate / resize) so
  // Reference keeps the panel framed after seeding.
  const prevSubjectKey = useRef(
    `${projected.widthMm}x${projected.heightMm}`,
  );
  useEffect(() => {
    const key = `${projected.widthMm}x${projected.heightMm}`;
    const changed = prevSubjectKey.current !== key;
    prevSubjectKey.current = key;
    if (!fitted.current || !changed) return;
    fitToProjected();
  }, [fitToProjected, projected.heightMm, projected.widthMm]);

  // Entering main grid mode — reframe the panel (same idea as 3D zoom-in).
  useEffect(() => {
    if (compact) return;
    if (mainViewMode !== "2d") return;
    if (!fitted.current) return;
    fitToProjected();
  }, [compact, fitToProjected, mainViewMode]);

  // Re-fit only when the orthographic view changes (Top → Front, …).
  // Do NOT re-fit when the draft moves/resizes — that yanked the camera
  // back to center and made free panning feel broken (main CAD).
  const prevView = useRef(orthoView);
  useEffect(() => {
    const viewChanged = prevView.current !== orthoView;
    prevView.current = orthoView;
    if (fitted.current && viewChanged) {
      fitToProjected();
    }
  }, [orthoView, fitToProjected]);

  // Top-bar Fit / Zoom (main CAD only). Skip re-fire when only
  // `fitToProjected` identity changes while the nonce stays put.
  const lastFitNonce = useRef(cadFitNonce);
  useEffect(() => {
    if (compact) return;
    if (cadFitNonce === lastFitNonce.current) return;
    lastFitNonce.current = cadFitNonce;
    fitToProjected();
  }, [cadFitNonce, compact, fitToProjected]);

  const lastZoomNonce = useRef(cadZoomNonce);
  useEffect(() => {
    if (compact) return;
    if (cadZoomNonce === lastZoomNonce.current) return;
    lastZoomNonce.current = cadZoomNonce;
    setCamera((cam) => ({
      ...cam,
      pxPerMm: Math.max(
        MIN_PX_PER_MM,
        Math.min(MAX_PX_PER_MM, cam.pxPerMm * cadZoomFactor),
      ),
    }));
  }, [cadZoomNonce, cadZoomFactor, compact]);

  useEffect(() => {
    if (compact) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setSpaceDown(true);
      }
      if (e.key === "m" || e.key === "M") setCadTool("measure");
      if (e.key === "h" || e.key === "H") {
        setCadTool("pan");
      }
      if (e.key === "v" || e.key === "V") {
        setCadTool("select");
      }
      if (e.key === "Escape") {
        setCadTool("select");
        setMeasureFrom(null);
        setMeasureTo(null);
        gesture.current = null;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [compact, setCadTool]);

  const bounds = useMemo(() => {
    const halfW = size.w / 2 / camera.pxPerMm;
    const halfH = size.h / 2 / camera.pxPerMm;
    return {
      minX: camera.cx - halfW,
      maxX: camera.cx + halfW,
      minY: camera.cy - halfH,
      maxY: camera.cy + halfH,
      worldW: halfW * 2,
      worldH: halfH * 2,
    };
  }, [camera, size]);

  const majorStep = useMemo(() => {
    const mmPerLabel = 72 / camera.pxPerMm;
    return niceStep(mmPerLabel);
  }, [camera.pxPerMm]);
  const minorStep = majorStep / 5;

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Pt => {
      const el = planeRef.current;
      if (!el) return { x: 0, y: 0 };
      const r = el.getBoundingClientRect();
      const sx = clientX - r.left;
      const sy = clientY - r.top;
      return {
        x: camera.cx + (sx - size.w / 2) / camera.pxPerMm,
        y: camera.cy - (sy - size.h / 2) / camera.pxPerMm,
      };
    },
    [camera, size],
  );

  // Non-passive wheel so preventDefault actually stops page scroll.
  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const before = screenToWorld(e.clientX, e.clientY);
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setCamera((cam) => {
        const next = Math.max(
          MIN_PX_PER_MM,
          Math.min(MAX_PX_PER_MM, cam.pxPerMm * factor),
        );
        const r = el.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        const cx = before.x - (sx - size.w / 2) / next;
        const cy = before.y + (sy - size.h / 2) / next;
        return { cx, cy, pxPerMm: next };
      });
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, [screenToWorld, size.w, size.h]);

  const applySnap = useCallback(
    (p: Pt): Pt => ({
      x: snapValue(p.x, SNAP_MM, snap),
      y: snapValue(p.y, SNAP_MM, snap),
    }),
    [snap],
  );

  const hitEdge = useCallback(
    (p: Pt): Edge | null => {
      if (compact || !planEditable || usingPiece) return null;
      const tol = 8 / camera.pxPerMm;
      const { minX, maxX, minY, maxY } = draft;
      const inX = p.x >= minX - tol && p.x <= maxX + tol;
      const inY = p.y >= minY - tol && p.y <= maxY + tol;
      if (!inX || !inY) return null;
      const dN = Math.abs(p.y - maxY);
      const dS = Math.abs(p.y - minY);
      const dE = Math.abs(p.x - maxX);
      const dW = Math.abs(p.x - minX);
      const m = Math.min(dN, dS, dE, dW);
      if (m > tol) return null;
      if (m === dN) return "n";
      if (m === dS) return "s";
      if (m === dE) return "e";
      return "w";
    },
    [camera.pxPerMm, compact, draft, planEditable, usingPiece],
  );

  /** Interior of the draft (inset past edge grips) — select tool moves it. */
  const hitBody = useCallback(
    (p: Pt): boolean => {
      if (compact || !planEditable || usingPiece) return false;
      const tol = 8 / camera.pxPerMm;
      const { minX, maxX, minY, maxY } = draft;
      return (
        p.x >= minX + tol &&
        p.x <= maxX - tol &&
        p.y >= minY + tol &&
        p.y <= maxY - tol
      );
    },
    [camera.pxPerMm, compact, draft, planEditable, usingPiece],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const raw = screenToWorld(e.clientX, e.clientY);
      const p = applySnap(raw);
      const forcePan = spaceDown || e.button === 1 || e.altKey;

      // ── Measure: click–drag or two-click distance in mm ─────────
      if (tool === "measure" && e.button === 0 && !forcePan) {
        if (!measureFrom || (measureFrom && measureTo)) {
          setMeasureFrom(p);
          setMeasureTo(null);
          gesture.current = { kind: "measure", from: p };
        } else {
          setMeasureTo(p);
          gesture.current = null;
        }
        return;
      }

      // ── Pan / Space / middle / Alt: navigate only ───────────────
      if (tool === "pan" || forcePan || e.button === 1) {
        if (e.button === 0 || e.button === 1) {
          gesture.current = {
            kind: "pan",
            sx: e.clientX,
            sy: e.clientY,
            cx: camera.cx,
            cy: camera.cy,
          };
        }
        return;
      }

      // ── Select: piece drag, resize edges, draft body, empty → pan ──
      if (tool === "select" && e.button === 0) {
        // Drag carcass / catalog panels in the active ortho view.
        if (!compact && pieceViews.length > 0) {
          const hitId = hitProjectedPiece(
            raw,
            pieceViews,
            selectedItem?.id ?? null,
          );
          if (hitId) {
            const piece = placedPieces.find((f) => f.id === hitId);
            if (piece && !piece.locked) {
              selectFurniture(hitId);
              gesture.current = {
                kind: "piece-move",
                id: hitId,
                startX: piece.x,
                startZ: piece.z,
                startStudioY: resolveStudioY(piece),
                ox: p.x,
                oy: p.y,
              };
              return;
            }
          }
        }
        const edge = hitEdge(raw);
        if (edge) {
          gesture.current = { kind: "edge", edge, start: { ...draft } };
          return;
        }
        if (hitBody(raw)) {
          gesture.current = {
            kind: "move",
            start: { ...draft },
            ox: p.x,
            oy: p.y,
          };
          return;
        }
        // Empty canvas — pan so the map stays freely draggable
        // without switching to the Hand tool.
        gesture.current = {
          kind: "pan",
          sx: e.clientX,
          sy: e.clientY,
          cx: camera.cx,
          cy: camera.cy,
        };
      }
    },
    [
      applySnap,
      camera.cx,
      camera.cy,
      compact,
      draft,
      hitBody,
      hitEdge,
      measureFrom,
      measureTo,
      placedPieces,
      pieceViews,
      screenToWorld,
      selectFurniture,
      selectedItem?.id,
      spaceDown,
      tool,
    ],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const raw = screenToWorld(e.clientX, e.clientY);
      const p = applySnap(raw);
      setCursor(p);

      const g = gesture.current;
      if (!g) return;

      if (g.kind === "pan") {
        const dx = (e.clientX - g.sx) / camera.pxPerMm;
        const dy = (e.clientY - g.sy) / camera.pxPerMm;
        setCamera((cam) => ({
          ...cam,
          cx: g.cx - dx,
          cy: g.cy + dy,
        }));
        return;
      }

      if (g.kind === "measure") {
        setMeasureTo(p);
        return;
      }

      if (g.kind === "piece-move") {
        const du = p.x - g.ox;
        const dv = p.y - g.oy;
        const delta = projectedDeltaToWorldM(du, dv, orthoView);
        const proposed = {
          x: g.startX + delta.dx,
          z: g.startZ + delta.dz,
          studioY: g.startStudioY + delta.dStudioY,
        };
        const piece = placedPieces.find((f) => f.id === g.id);
        if (!piece) return;
        const neighbors = snapNeighborsFor(
          useStore.getState().furniture,
          g.id,
        );
        const snapped =
          e.altKey || !isSnapPanel(piece)
            ? proposed
            : magneticSnapPanelView(piece, proposed, neighbors, orthoView);
        setItemTransform(g.id, {
          x: snapped.x,
          z: snapped.z,
          studioY: snapped.studioY,
        });
        return;
      }

      if (g.kind === "move") {
        const dx = p.x - g.ox;
        const dy = p.y - g.oy;
        setDraft({
          minX: g.start.minX + dx,
          maxX: g.start.maxX + dx,
          minY: g.start.minY + dy,
          maxY: g.start.maxY + dy,
        });
        return;
      }

      if (g.kind === "edge") {
        const next = { ...g.start };
        const minSize = SNAP_MM;
        if (g.edge === "n") {
          next.maxY = Math.max(next.minY + minSize, p.y);
        } else if (g.edge === "s") {
          next.minY = Math.min(next.maxY - minSize, p.y);
        } else if (g.edge === "e") {
          next.maxX = Math.max(next.minX + minSize, p.x);
        } else {
          next.minX = Math.min(next.maxX - minSize, p.x);
        }
        setDraft(next);
      }
    },
    [
      applySnap,
      camera.pxPerMm,
      orthoView,
      placedPieces,
      screenToWorld,
      setDraft,
      setItemTransform,
    ],
  );

  const onPointerUp = useCallback(() => {
    gesture.current = null;
  }, []);

  const onPointerLeave = useCallback(() => {
    if (!gesture.current) setCursor(null);
  }, []);

  // Tick arrays for visible range (world mm).
  const { majorX, minorX, majorY, minorY } = useMemo(() => {
    const majX: number[] = [];
    const minX: number[] = [];
    const majY: number[] = [];
    const minY: number[] = [];
    const x0 = Math.floor(bounds.minX / minorStep) * minorStep;
    for (let x = x0; x <= bounds.maxX + minorStep; x += minorStep) {
      const rx = Math.round(x * 1e6) / 1e6;
      if (isMultiple(rx, majorStep)) majX.push(rx);
      else minX.push(rx);
    }
    const y0 = Math.floor(bounds.minY / minorStep) * minorStep;
    for (let y = y0; y <= bounds.maxY + minorStep; y += minorStep) {
      const ry = Math.round(y * 1e6) / 1e6;
      if (isMultiple(ry, majorStep)) majY.push(ry);
      else minY.push(ry);
    }
    return { majorX: majX, minorX: minX, majorY: majY, minorY: minY };
  }, [bounds, majorStep, minorStep]);

  const worldToPlaneX = (x: number) =>
    size.w / 2 + (x - camera.cx) * camera.pxPerMm;
  const worldToPlaneY = (y: number) =>
    size.h / 2 - (y - camera.cy) * camera.pxPerMm;

  const draftW = draft.maxX - draft.minX;
  const draftH = draft.maxY - draft.minY;
  const measureDist =
    measureFrom && measureTo
      ? Math.hypot(measureTo.x - measureFrom.x, measureTo.y - measureFrom.y)
      : null;
  const measureDx =
    measureFrom && measureTo ? measureTo.x - measureFrom.x : null;
  const measureDy =
    measureFrom && measureTo ? measureTo.y - measureFrom.y : null;

  const edgeCursor = (() => {
    if (
      !cursor ||
      !planEditable ||
      tool !== "select" ||
      spaceDown
    ) {
      return null;
    }
    return hitEdge(cursor);
  })();

  const bodyHover =
    tool === "select" &&
    !spaceDown &&
    cursor &&
    !edgeCursor &&
    hitBody(cursor);

  const planeCursor =
    spaceDown || tool === "pan" || gesture.current?.kind === "pan"
      ? gesture.current?.kind === "pan"
        ? "grabbing"
        : "grab"
      : tool === "measure"
        ? "crosshair"
        : edgeCursor === "n" || edgeCursor === "s"
          ? "ns-resize"
          : edgeCursor === "e" || edgeCursor === "w"
            ? "ew-resize"
            : gesture.current?.kind === "move"
              ? "grabbing"
              : bodyHover
                ? "move"
                : "grab";

  const vb = `${bounds.minX} ${-bounds.maxY} ${bounds.worldW} ${bounds.worldH}`;
  const ready = size.w >= 32 && size.h >= 32;

  return (
    <div
      data-no-drag="true"
      style={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: compact ? "1fr" : `${ruler}px 1fr`,
        gridTemplateRows: compact
          ? "1fr"
          : `${ruler}px 1fr ${statusH}px`,
        background: "transparent",
        borderRadius: compact ? 8 : 10,
        overflow: "hidden",
        border: compact ? "none" : `1px solid ${EDGE}`,
        boxShadow: "none",
        fontFamily: "var(--font-app), system-ui, sans-serif",
        color: INK,
        userSelect: "none",
        position: "relative",
        // Avoid a one-frame glitch before ResizeObserver reports size
        // (tiny viewBox + strokes read as a centered cross).
        opacity: ready ? 1 : 0,
      }}
    >
      {!compact && (
        <>
      <div
        style={{
          background: RULER_BG,
          borderRight: `1px solid ${EDGE}`,
          borderBottom: `1px solid ${EDGE}`,
        }}
      />

      {/* Top ruler (X, mm) — synced to camera, screen-space ticks */}
      <div
        style={{
          position: "relative",
          background: RULER_BG,
          borderBottom: `1px solid ${EDGE}`,
          overflow: "hidden",
        }}
      >
        <svg width="100%" height="100%" style={{ display: "block" }}>
          {minorX.map((x) => {
            const sx = worldToPlaneX(x);
            return (
              <line
                key={`xt-${x}`}
                x1={sx}
                y1={ruler - 3.5}
                x2={sx}
                y2={ruler}
                stroke={TICK}
                strokeWidth={0.55}
              />
            );
          })}
          {majorX.map((x) => {
            const sx = worldToPlaneX(x);
            return (
              <g key={`xT-${x}`}>
                <line
                  x1={sx}
                  y1={ruler - 8}
                  x2={sx}
                  y2={ruler}
                  stroke={TICK}
                  strokeWidth={0.9}
                />
                <text
                  x={sx + 4}
                  y={11}
                  fill={LABEL}
                  fontSize={fontSize}
                  fontWeight={500}
                  style={{ fontFamily: "inherit" }}
                >
                  {formatCoord(x)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Left ruler (Y, mm) */}
      <div
        style={{
          position: "relative",
          background: RULER_BG,
          borderRight: `1px solid ${EDGE}`,
          overflow: "hidden",
        }}
      >
        <svg width="100%" height="100%" style={{ display: "block" }}>
          {minorY.map((y) => {
            const sy = worldToPlaneY(y);
            return (
              <line
                key={`yt-${y}`}
                x1={ruler - 3.5}
                y1={sy}
                x2={ruler}
                y2={sy}
                stroke={TICK}
                strokeWidth={0.55}
              />
            );
          })}
          {majorY.map((y) => {
            const sy = worldToPlaneY(y);
            return (
              <g key={`yT-${y}`}>
                <line
                  x1={ruler - 8}
                  y1={sy}
                  x2={ruler}
                  y2={sy}
                  stroke={TICK}
                  strokeWidth={0.9}
                />
                <text
                  x={2.5}
                  y={sy - 3}
                  fill={LABEL}
                  fontSize={fontSize}
                  fontWeight={500}
                  style={{ fontFamily: "inherit" }}
                >
                  {formatCoord(y)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
        </>
      )}

      {/* Drafting plane */}
      <div
        ref={planeRef}
        data-cad-drop="true"
        data-px-per-mm={camera.pxPerMm}
        data-cx={camera.cx}
        data-cy={camera.cy}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        style={{
          position: "relative",
          background: PAPER,
          minHeight: 0,
          minWidth: 0,
          cursor: planeCursor,
          backgroundImage: "none",
          touchAction: "none",
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={vb}
          preserveAspectRatio="none"
          style={{ display: "block" }}
        >
          {minorX.map((x) => (
            <line
              key={`gx-${x}`}
              x1={x}
              y1={-bounds.maxY}
              x2={x}
              y2={-bounds.minY}
              stroke={GRID_MINOR}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {minorY.map((y) => (
            <line
              key={`gy-${y}`}
              x1={bounds.minX}
              y1={-y}
              x2={bounds.maxX}
              y2={-y}
              stroke={GRID_MINOR}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {majorX.map((x) => (
            <line
              key={`GX-${x}`}
              x1={x}
              y1={-bounds.maxY}
              x2={x}
              y2={-bounds.minY}
              stroke={GRID_MAJOR}
              strokeWidth={0.7}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {majorY.map((y) => (
            <line
              key={`GY-${y}`}
              x1={bounds.minX}
              y1={-y}
              x2={bounds.maxX}
              y2={-y}
              stroke={GRID_MAJOR}
              strokeWidth={0.7}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Orthographic subjects — all placed pieces in this view.
              Draft-only when nothing is placed yet. */}
          {pieceViews.length > 0 ? (
            pieceViews.map((p) => (
              <CadOrthoSubject
                key={p.id}
                projected={p.projected}
                pxPerMm={camera.pxPerMm}
                compact={compact || !p.selected}
                dimmed={!p.selected && Boolean(selectedItem)}
              />
            ))
          ) : (
            <CadOrthoSubject
              projected={draftProjected}
              pxPerMm={camera.pxPerMm}
              compact={compact}
            />
          )}

          {/* Plan-only: drag draft edges (Top / Bottom views) */}
          {!compact &&
            planEditable &&
            !usingPiece &&
            (
              [
                {
                  edge: "n" as const,
                  x1: draft.minX,
                  y1: -draft.maxY,
                  x2: draft.maxX,
                  y2: -draft.maxY,
                },
                {
                  edge: "s" as const,
                  x1: draft.minX,
                  y1: -draft.minY,
                  x2: draft.maxX,
                  y2: -draft.minY,
                },
                {
                  edge: "e" as const,
                  x1: draft.maxX,
                  y1: -draft.minY,
                  x2: draft.maxX,
                  y2: -draft.maxY,
                },
                {
                  edge: "w" as const,
                  x1: draft.minX,
                  y1: -draft.minY,
                  x2: draft.minX,
                  y2: -draft.maxY,
                },
              ] as const
            ).map((seg) => (
              <line
                key={seg.edge}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke="transparent"
                strokeWidth={10}
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
              />
            ))}

          {/* Measure overlay */}
          {measureFrom && (
            <circle
              cx={measureFrom.x}
              cy={-measureFrom.y}
              r={4 / camera.pxPerMm}
              fill={MEASURE}
            />
          )}
          {measureFrom && measureTo && (
            <g>
              <line
                x1={measureFrom.x}
                y1={-measureFrom.y}
                x2={measureTo.x}
                y2={-measureTo.y}
                stroke={MEASURE}
                strokeWidth={1.5}
                strokeDasharray={`${6 / camera.pxPerMm} ${4 / camera.pxPerMm}`}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={measureFrom.x}
                y1={-measureFrom.y}
                x2={measureTo.x}
                y2={-measureFrom.y}
                stroke="rgba(26,95,138,0.35)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={measureTo.x}
                y1={-measureFrom.y}
                x2={measureTo.x}
                y2={-measureTo.y}
                stroke="rgba(26,95,138,0.35)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={measureTo.x}
                cy={-measureTo.y}
                r={4 / camera.pxPerMm}
                fill={MEASURE}
              />
              {measureDist != null && (
                <text
                  x={(measureFrom.x + measureTo.x) / 2}
                  y={
                    -(measureFrom.y + measureTo.y) / 2 -
                    14 / camera.pxPerMm
                  }
                  textAnchor="middle"
                  fill={MEASURE}
                  // SVG viewBox is mm; raw fontSize=12 is ~2px on screen.
                  // Scale to screen pixels like CadOrthoSubject dims.
                  fontSize={(compact ? 11 : 13) / camera.pxPerMm}
                  fontWeight={600}
                  style={{
                    fontFamily: "inherit",
                    paintOrder: "stroke fill",
                    stroke: "rgba(255, 250, 244, 0.92)",
                    strokeWidth: 3 / camera.pxPerMm,
                  }}
                >
                  {formatMm(measureDist)}
                </text>
              )}
            </g>
          )}

          {/* Cursor crosshair */}
          {cursor && tool === "measure" && (
            <g pointerEvents="none">
              <line
                x1={cursor.x}
                y1={-bounds.maxY}
                x2={cursor.x}
                y2={-bounds.minY}
                stroke="rgba(26,95,138,0.25)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={bounds.minX}
                y1={-cursor.y}
                x2={bounds.maxX}
                y2={-cursor.y}
                stroke="rgba(26,95,138,0.25)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Status bar */}
      {!compact && (
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 12px",
            borderTop: `1px solid ${EDGE}`,
            background: RULER_BG,
            fontSize: 11,
            fontWeight: 500,
            color: "rgba(26,26,26,0.65)",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span>
            {projected.uAxis}{" "}
            <strong style={{ color: INK }}>
              {cursor ? formatCoord(cursor.x) : "—"}
            </strong>{" "}
            mm
          </span>
          <span>
            {projected.vAxis}{" "}
            <strong style={{ color: INK }}>
              {cursor ? formatCoord(cursor.y) : "—"}
            </strong>{" "}
            mm
          </span>
          <span>
            {ORTHO_VIEWS.find((v) => v.id === orthoView)?.label}{" "}
            <strong style={{ color: ACCENT }}>
              {formatMm(projected.widthMm)} × {formatMm(projected.heightMm)}
            </strong>
            {usingPiece ? " · piece" : " · panel"}
          </span>
          {planEditable && !usingPiece && (
            <span style={{ opacity: 0.7 }}>
              plan {formatMm(draftW)} × {formatMm(draftH)}
            </span>
          )}
          {measureDist != null && measureDx != null && measureDy != null && (
            <span style={{ color: MEASURE }}>
              Δ {formatMm(measureDist)} · ΔX {formatMm(measureDx)} · ΔY{" "}
              {formatMm(measureDy)}
            </span>
          )}
          <span style={{ marginLeft: "auto" }}>
            {Math.round(camera.pxPerMm * 1000) / 10} px/cm · grid {SNAP_MM} mm
            {snap ? " · snap" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
