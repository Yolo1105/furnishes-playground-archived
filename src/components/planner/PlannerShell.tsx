"use client";

import { useState } from "react";
import { useStore } from "@studio/store";
import { CloseIcon } from "@studio/icons";
import { RequirementsTab } from "./tabs/RequirementsTab";
import { OptionsTab } from "./tabs/OptionsTab";
import { InspectTab } from "./tabs/InspectTab";
import { HealthTab } from "./tabs/HealthTab";
import { ExplainTab } from "./tabs/ExplainTab";
import { PlaceholderTab } from "./tabs/PlaceholderTab";

/**
 * Planner workspace modal. Opens from the Tools card's Planner tile
 * or the top-bar Planner button (both call setPlannerOpen(true)).
 *
 * Layout:
 *   • Centered modal, ~960px wide × ~560px tall, on a darkened
 *     backdrop. Click backdrop or close button to dismiss.
 *   • Left rail: vertical list of tabs (Requirements / Options /
 *     Inspect / Placed / Health / Explain). Selected tab gets
 *     accent treatment.
 *   • Right pane: the active tab's body. Scrollable when content
 *     exceeds height.
 *   • Footer pinned bottom: thin row that the active tab can
 *     populate with primary actions (e.g. Generate, Apply).
 *
 * Phase F1 ships the Requirements tab as a real form backed by
 * the requirements-slice. The other tabs (Options, Inspect, Placed,
 * Health, Explain) render the PlaceholderTab — a styled "coming
 * soon, lands in Phase X" message rather than a generic stub —
 * so the user understands what's planned and when. As later
 * phases ship those flows, replace the PlaceholderTab references
 * with real tab components.
 *
 * Why a modal rather than a docked panel: the Planner is a
 * sit-down workflow, not a peek. Modal framing focuses attention,
 * matches the Catalog modal pattern users have already learned,
 * and avoids fighting for screen real estate with the floating
 * tool cards. When you're done planning, you close it and the
 * studio is unobstructed again.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";
const UI_DISPLAY_FONT = "var(--font-app), system-ui, sans-serif";

type TabId =
  | "requirements"
  | "options"
  | "inspect"
  | "placed"
  | "health"
  | "explain";

interface TabDef {
  id: TabId;
  label: string;
  /** Set on tabs that ship as real bodies. The rest carry a
   *  `comingInPhase` string the placeholder UI displays. */
  realPhase?: "F1" | "E1" | "F2" | "F4" | "F5";
  comingInPhase?: string;
}

const TABS: TabDef[] = [
  { id: "requirements", label: "Requirements", realPhase: "F1" },
  { id: "options", label: "Options", realPhase: "F1" },
  { id: "inspect", label: "Inspect", realPhase: "F2" },
  {
    id: "placed",
    label: "Placed",
    comingInPhase: "out of scope (Inventory tab covers this)",
  },
  { id: "health", label: "Health", realPhase: "F4" },
  { id: "explain", label: "Explain", realPhase: "F5" },
];

export function PlannerShell() {
  const open = useStore((s) => s.plannerOpen);
  const setOpen = useStore((s) => s.setPlannerOpen);
  const [activeTab, setActiveTab] = useState<TabId>("requirements");

  if (!open) return null;

  const activeTabDef = TABS.find((t) => t.id === activeTab) ?? TABS[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Planner workspace"
      onClick={(e) => {
        // Backdrop click closes (matches Catalog modal behavior).
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(26, 18, 10, 0.32)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        animation: "planner-fade-in 0.2s ease-out",
      }}
    >
      <div
        className="glass-modal"
        style={{
          width: "min(960px, 100%)",
          height: "min(620px, 100%)",
          display: "flex",
          flexDirection: "column",
          borderRadius: 18,
          overflow: "hidden",
          fontFamily: UI_DISPLAY_FONT,
        }}
      >
        {/* Header: title + close. Sits above both rail and body. */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(26, 26, 26, 0.08)",
            background: "transparent",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <h2
              style={{
                margin: 0,
                fontFamily: UI_FONT,
                fontSize: 18,
                fontWeight: 500,
                color: INK,
              }}
            >
              Planner
            </h2>
            <span
              style={{
                fontSize: 12,
                color: "rgba(26, 26, 26, 0.5)",
                fontWeight: 500,
              }}
            >
              {activeTabDef.label}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close planner"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "rgba(26, 26, 26, 0.55)",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(26, 26, 26, 0.06)";
              e.currentTarget.style.color = INK;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(26, 26, 26, 0.55)";
            }}
          >
            <CloseIcon size={16} />
          </button>
        </header>

        {/* Body: left rail + right pane. */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Left rail: vertical tab list. */}
          <nav
            style={{
              width: 168,
              flexShrink: 0,
              padding: "12px 8px",
              borderRight: "1px solid rgba(26, 26, 26, 0.08)",
              background: "#FFF8F1",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              overflowY: "auto",
            }}
          >
            {TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              const isReal = tab.realPhase != null;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "none",
                    background: isActive
                      ? "rgba(255, 90, 31, 0.1)"
                      : "transparent",
                    color: isActive
                      ? ACCENT
                      : isReal
                        ? "rgba(26, 26, 26, 0.85)"
                        : "rgba(26, 26, 26, 0.5)",
                    fontFamily: UI_DISPLAY_FONT,
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 500,
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "background 0.15s ease, color 0.15s ease",
                  }}
                >
                  <span>{tab.label}</span>
                  {!isReal && (
                    <span
                      title={`Coming in Phase ${tab.comingInPhase}`}
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: 999,
                        background: "rgba(26, 26, 26, 0.06)",
                        color: "rgba(26, 26, 26, 0.5)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      SOON
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right pane: active tab body. */}
          <main
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {activeTab === "requirements" ? (
              <RequirementsTab />
            ) : activeTab === "options" ? (
              <OptionsTab />
            ) : activeTab === "inspect" ? (
              <InspectTab />
            ) : activeTab === "health" ? (
              <HealthTab />
            ) : activeTab === "explain" ? (
              <ExplainTab />
            ) : (
              <PlaceholderTab
                tabLabel={activeTabDef.label}
                comingInPhase={activeTabDef.comingInPhase ?? "a future phase"}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
