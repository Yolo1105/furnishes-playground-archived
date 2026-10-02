"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@studio/store";
import { ENV_PRESETS, type EnvPreset } from "@studio/store/ui-flags-slice";
import { SunIcon, ChevronDownIcon, CheckIcon } from "@studio/icons";
import { TopBarButton } from "./TopBarButton";

/**
 * Environment-lighting picker. The store holds the chosen preset
 * and the dropdown shows the ten options with a check on the
 * active one. Selecting a preset updates the store; the Scene's
 * `<Environment preset={envPreset} />` re-mounts with the new
 * HDRI, swapping image-based lighting + reflections instantly.
 *
 * The HDRI textures themselves are bundled by drei's loader and
 * cached after first use. The first switch to a new preset can
 * take a moment while the texture downloads; subsequent switches
 * are immediate.
 */
export function EnvLightingDropdown() {
  const envPreset = useStore((s) => s.envPreset);
  const setEnvPreset = useStore((s) => s.setEnvPreset);

  // Track open state locally — same pattern as ModeDropdown / project
  // dropdown elsewhere in the app.
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

  const pick = (preset: EnvPreset) => {
    setEnvPreset(preset);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <TopBarButton
        title={`Environment lighting (${envPreset})`}
        withChevron
        onClick={() => setOpen((v) => !v)}
        active={open}
      >
        <SunIcon size={14} />
        <ChevronDownIcon size={9} rotated={open} />
      </TopBarButton>

      {open && (
        <div
          className="glass"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: 160,
            padding: 6,
            borderRadius: 12,
            zIndex: 30,
            animation: "bubble-in 0.18s cubic-bezier(0.22, 1, 0.36, 1)",
            fontFamily: "var(--font-app), system-ui, sans-serif",
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(26, 26, 26, 0.45)",
              padding: "4px 10px 6px 10px",
            }}
          >
            Lighting
          </div>
          {ENV_PRESETS.map((p) => {
            const isActive = p.value === envPreset;
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => pick(p.value)}
                className="topbar-menu-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "6px 10px",
                  border: "none",
                  borderRadius: 6,
                  background: "transparent",
                  fontFamily: "var(--font-app), system-ui, sans-serif",
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "#FF5A1F" : "rgba(26, 26, 26, 0.78)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.12s ease",
                }}
              >
                <span>{p.label}</span>
                {isActive && <CheckIcon size={11} color="#FF5A1F" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
