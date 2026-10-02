"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@studio/store";
import { ENV_PRESETS, type EnvPreset } from "@studio/store/ui-flags-slice";
import {
  EyeIcon,
  ChevronDownIcon,
  CheckIcon,
  MapPinIcon,
  CompassIcon,
  SunIcon,
  LayoutGridIcon,
} from "@studio/icons";
import { TopBarButton } from "./TopBarButton";

/**
 * v0.40.49 ViewSettingsDropdown — consolidates the visual / scene-
 * inspection toggles that previously lived as separate top-bar
 * buttons. The user reported the top bar felt overloaded and
 * confusing; collapsing related toggles into a single popover cuts
 * the visible button count from ~13 to ~9 without losing any
 * functionality.
 *
 * Toggles housed here:
 *   • Floor hotspots — show clickable disks on the floor
 *   • Mesh wireframe — selection / placeholder X-grid overlay
 *   • Cardinal lights — model-inspection lighting rig
 *   • Environment HDRI preset — image-based lighting cubemap
 *
 * Walk mode + camera reset stay in the main top bar because they're
 * navigation actions (not visual toggles), used frequently, and
 * benefit from a single click rather than a popover round-trip.
 */
export function ViewSettingsDropdown() {
  const showHotspots = useStore((s) => s.showHotspots);
  const setShowHotspots = useStore((s) => s.setShowHotspots);
  const showWireframe = useStore((s) => s.showWireframe);
  const setShowWireframe = useStore((s) => s.setShowWireframe);
  const cardinalLightsMode = useStore((s) => s.cardinalLightsMode);
  const toggleCardinalLightsMode = useStore((s) => s.toggleCardinalLightsMode);
  const envPreset = useStore((s) => s.envPreset);
  const setEnvPreset = useStore((s) => s.setEnvPreset);

  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Active highlight on the trigger reflects ANY of the contained
  // toggles being non-default — gives the user a visual cue that
  // they have customized view settings without having to open the
  // popover to check.
  const anyActive =
    showHotspots ||
    showWireframe ||
    cardinalLightsMode ||
    envPreset !== "apartment";

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <TopBarButton
        title="View settings — hotspots, wireframe, lighting, HDRI"
        withChevron
        onClick={() => setOpen((v) => !v)}
        active={open || anyActive}
      >
        <EyeIcon size={14} />
        <ChevronDownIcon size={9} rotated={open} />
      </TopBarButton>

      {open && (
        <div
          className="glass"
          role="menu"
          aria-label="View settings"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 240,
            padding: 8,
            borderRadius: 12,
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            fontFamily: "var(--font-app), system-ui, sans-serif",
          }}
        >
          {/* Section: scene toggles */}
          <button
            type="button"
            onClick={() => setShowHotspots(!showHotspots)}
            style={rowStyle(showHotspots)}
          >
            <span style={iconWrap}>
              <MapPinIcon size={13} />
            </span>
            <span style={labelStyle}>Floor hotspots</span>
            {showHotspots && <CheckIcon size={12} />}
          </button>
          <button
            type="button"
            onClick={() => setShowWireframe(!showWireframe)}
            style={rowStyle(showWireframe)}
          >
            <span style={iconWrap}>
              <LayoutGridIcon size={13} />
            </span>
            <span style={labelStyle}>Mesh wireframe (X-grid)</span>
            {showWireframe && <CheckIcon size={12} />}
          </button>
          <button
            type="button"
            onClick={() => toggleCardinalLightsMode()}
            style={rowStyle(cardinalLightsMode)}
          >
            <span style={iconWrap}>
              <CompassIcon size={13} />
            </span>
            <span style={labelStyle}>Cardinal lights (inspection)</span>
            {cardinalLightsMode && <CheckIcon size={12} />}
          </button>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: "rgba(26, 26, 26, 0.08)",
              margin: "6px 4px",
            }}
          />

          {/* Section: HDRI preset selector */}
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "rgba(26, 26, 26, 0.45)",
              padding: "4px 8px 6px",
            }}
          >
            <SunIcon
              size={11}
              style={{ marginRight: 6, verticalAlign: "-2px" }}
            />
            Environment
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 2,
            }}
          >
            {ENV_PRESETS.map((p) => {
              const isActive = p.value === envPreset;
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    setEnvPreset(p.value);
                  }}
                  style={{
                    ...rowStyle(isActive),
                    fontSize: 12,
                    padding: "5px 8px",
                  }}
                >
                  <span
                    style={{
                      ...labelStyle,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.label}
                  </span>
                  {isActive && <CheckIcon size={11} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    border: "none",
    borderRadius: 6,
    background: active ? "rgba(255, 90, 31, 0.08)" : "transparent",
    color: active ? "#FF5A1F" : "rgba(26, 26, 26, 0.78)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    width: "100%",
    textAlign: "left" as const,
    fontFamily: "var(--font-app), system-ui, sans-serif",
  };
}

const iconWrap: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 16,
};

const labelStyle: React.CSSProperties = {
  flex: 1,
};

// Re-export ENV_PRESETS-aware type just so consumers can verify
// what we expect. Type already imported from the slice.
export type { EnvPreset };
