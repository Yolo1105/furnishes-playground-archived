"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@studio/store";
import type { Mode } from "@studio/store/types";
import { ChevronDownIcon, CheckIcon } from "@studio/icons";

/**
 * Two-pane chat picker (v0.40.17 redesign). Replaces the old
 * single-list dropdown that mixed mode + guided-context toggle. The
 * user reported the previous shape was confusing because:
 *
 *   • "Ask everything" / "Interior Design" / "Furniture" / "Room
 *     Layout" all looked like the same kind of choice but they
 *     weren't — Ask was a meta-mode that disabled generation, while
 *     the other three were intent buckets.
 *
 *   • "Guided context" was a fourth row that flipped a different
 *     concept entirely (input format).
 *
 * The new picker separates the two axes:
 *
 *   ┌──────────────────────────────┬──────────────────────────────┐
 *   │  WHAT (intent)               │  HOW (interaction style)     │
 *   │                              │                              │
 *   │  • Furniture                 │  • Inspiration Talk          │
 *   │  • Room Layout               │  • Creative Mode             │
 *   │  • Interior Design (default) │  • Guided                    │
 *   └──────────────────────────────┴──────────────────────────────┘
 *
 * Mapping to runtime:
 *
 *   • Mode (left)   → routes to the matching pipeline. Interior
 *                     Design uses the intent classifier from
 *                     v0.40.16 to pick room vs furniture. Furniture
 *                     and Room Layout pin the dispatch directly.
 *
 *   • Style (right) → orthogonal. "Talk" forces chat (no
 *                     generation), "Create" forces generation
 *                     (no chat). "Guided" enables the keyword
 *                     fields in the input box. All combinations
 *                     are sensible — e.g., Furniture + Creative
 *                     means "I want a piece, generate it"; Room
 *                     Layout + Talk means "I want to discuss the
 *                     layout, don't generate."
 *
 * Trigger label compact form: "Interior Design · Talk" so users
 * can see both selections at a glance from a single line of text
 * without opening the picker.
 */

type IntentMode = "Furniture" | "Room Layout" | "Interior Design";
type InteractionStyle = "talk" | "create" | "guided";

const INTENT_OPTIONS: Array<{ id: IntentMode; title: string; desc: string }> = [
  {
    id: "Furniture",
    title: "Furniture",
    desc: "Single piece — sofa, bed, lamp",
  },
  {
    id: "Room Layout",
    title: "Room Layout",
    desc: "Whole room — flow, scale, pieces",
  },
  {
    id: "Interior Design",
    title: "Interior Design",
    desc: "Holistic — picks furniture vs layout from intent",
  },
];

const STYLE_OPTIONS: Array<{
  id: InteractionStyle;
  title: string;
  desc: string;
}> = [
  {
    id: "talk",
    title: "Inspiration Talk",
    desc: "Discuss, ask, brainstorm — no scene changes",
  },
  {
    id: "create",
    title: "Creative Mode",
    desc: "Always generate; edit current scene where possible",
  },
  {
    id: "guided",
    title: "Guided",
    desc: "Keyword fields instead of free-form text",
  },
];

export function ModeDropdown() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const interactionStyle = useStore(
    (s) =>
      ((s as unknown as { interactionStyle?: InteractionStyle })
        .interactionStyle ?? "talk") as InteractionStyle,
  );
  const setInteractionStyle = useStore(
    (s) =>
      (
        s as unknown as {
          setInteractionStyle: (style: InteractionStyle) => void;
        }
      ).setInteractionStyle,
  );

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

  // The current Mode could legacy-include "Ask" (pre-v0.40.17 stored
  // value). Show "Interior Design" as the visible label in that case
  // — the user never sees Ask now, and behavior gracefully falls
  // through to the intent classifier.
  const visibleIntent: IntentMode =
    mode === "Furniture" || mode === "Room Layout" || mode === "Interior Design"
      ? mode
      : "Interior Design";
  const styleLabel =
    STYLE_OPTIONS.find((s) => s.id === interactionStyle)?.title ??
    "Inspiration Talk";

  const pickIntent = (m: IntentMode) => {
    setMode(m as Mode);
    // Don't close — user may want to also pick a style. Closing is
    // explicit (click outside or press the trigger again).
  };
  const pickStyle = (style: InteractionStyle) => {
    setInteractionStyle(style);
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        className="mode-btn"
        onClick={() => setOpen((v) => !v)}
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderRadius: 8,
          border: "none",
          background: "transparent",
          fontFamily: "var(--font-syne), sans-serif",
          fontSize: 12,
          fontWeight: 600,
          color: "#1A1A1A",
          cursor: "pointer",
          transition: "background 0.15s ease",
          letterSpacing: "-0.005em",
        }}
      >
        <span>{visibleIntent}</span>
        <span
          style={{
            color: "rgba(26, 26, 26, 0.45)",
            fontWeight: 500,
            fontSize: 12,
            letterSpacing: "-0.005em",
          }}
        >
          · {styleLabel}
        </span>
        <span style={{ color: "rgba(26, 26, 26, 0.5)", display: "flex" }}>
          <ChevronDownIcon rotated={open} />
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            background: "rgba(255, 255, 255, 0.6)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(124, 80, 50, 0.18)",
            borderRadius: 14,
            boxShadow: "0 16px 48px -8px rgba(0, 0, 0, 0.15)",
            padding: 6,
            minWidth: 540,
            zIndex: 10,
            display: "flex",
            gap: 4,
          }}
        >
          {/* LEFT — Intent column */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "rgba(26, 26, 26, 0.45)",
                padding: "8px 14px 4px",
              }}
            >
              What
            </div>
            {INTENT_OPTIONS.map((opt) => {
              const isActive = opt.id === visibleIntent;
              return (
                <button
                  key={opt.id}
                  className="menu-row"
                  onClick={() => pickIntent(opt.id)}
                  type="button"
                  style={menuRowStyle}
                >
                  <div style={menuRowTextWrap}>
                    <span style={menuRowTitle}>{opt.title}</span>
                    <span style={menuRowDesc}>{opt.desc}</span>
                  </div>
                  {isActive && (
                    <div style={{ marginTop: 3 }}>
                      <CheckIcon color="#FF5A1F" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Vertical divider */}
          <div
            style={{
              width: 1,
              background: "rgba(26, 26, 26, 0.08)",
              margin: "8px 0",
            }}
          />

          {/* RIGHT — Style column */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "rgba(26, 26, 26, 0.45)",
                padding: "8px 14px 4px",
              }}
            >
              How
            </div>
            {STYLE_OPTIONS.map((opt) => {
              const isActive = opt.id === interactionStyle;
              return (
                <button
                  key={opt.id}
                  className="menu-row"
                  onClick={() => pickStyle(opt.id)}
                  type="button"
                  style={menuRowStyle}
                >
                  <div style={menuRowTextWrap}>
                    <span style={menuRowTitle}>{opt.title}</span>
                    <span style={menuRowDesc}>{opt.desc}</span>
                  </div>
                  {isActive && (
                    <div style={{ marginTop: 3 }}>
                      <CheckIcon color="#FF5A1F" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Shared row styles — both columns use identical visual treatment.
const menuRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  width: "100%",
  padding: "10px 14px",
  border: "none",
  borderRadius: 10,
  background: "transparent",
  fontFamily: "var(--font-syne), sans-serif",
  textAlign: "left",
  cursor: "pointer",
  transition: "background 0.12s ease",
  gap: 12,
};

const menuRowTextWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};

const menuRowTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#1A1A1A",
  letterSpacing: "-0.005em",
};

const menuRowDesc: React.CSSProperties = {
  fontSize: 11,
  color: "rgba(26, 26, 26, 0.55)",
  letterSpacing: "-0.005em",
  lineHeight: 1.4,
};
