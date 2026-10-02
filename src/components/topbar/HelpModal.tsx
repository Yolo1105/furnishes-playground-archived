"use client";

import { useEffect } from "react";
import { useStore } from "@studio/store";
import { CloseIcon } from "@studio/icons";

/**
 * Help / quick-start modal launched by the top bar's Help button.
 * Shows three sections:
 *
 *   1. Camera        — the four mouse-and-keyboard interactions for
 *                      navigating the 3D scene
 *   2. Shortcuts     — keyboard shortcuts (just H + Esc today)
 *   3. Quick start   — a sentence explaining how to use the chat
 *
 * Closes on backdrop click, the × button, or Esc. Esc is handled by
 * the global keyboard-shortcuts hook elsewhere; we also stop focus
 * trapping isn't strictly needed here because this is a low-stakes
 * informational modal.
 */

const CAMERA_ROWS = [
  { action: "Drag", desc: "Rotate the room around the focus point" },
  { action: "Right drag", desc: "Pan the focus point across the floor" },
  { action: "Scroll", desc: "Zoom in or out" },
  { action: "Pinch", desc: "Trackpad alternative for zoom" },
];

const SHORTCUT_ROWS = [
  { keys: ["H"], desc: "Hide all UI (immersive mode)" },
  { keys: ["Esc"], desc: "Exit immersive / close any open dialog" },
];

export function HelpModal() {
  const open = useStore((s) => s.helpModalOpen);
  const setOpen = useStore((s) => s.setHelpModalOpen);

  // Lock body scroll while open so the page doesn't drift behind the
  // modal on touch devices that try to scroll-pull-to-refresh.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Help"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26, 18, 10, 0.32)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        fontFamily: "var(--font-app), system-ui, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal"
        style={{
          width: 460,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 64px)",
          overflowY: "auto",
          borderRadius: 18,
          padding: "20px 22px 22px 22px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#1A1A1A",
            }}
          >
            Help
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close help"
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "none",
              background: "transparent",
              color: "rgba(26, 26, 26, 0.55)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CloseIcon size={13} />
          </button>
        </div>

        {/* Camera section */}
        <Section title="Camera">
          {CAMERA_ROWS.map((r) => (
            <Row key={r.action}>
              <ActionGlyph>{r.action}</ActionGlyph>
              <Desc>{r.desc}</Desc>
            </Row>
          ))}
        </Section>

        {/* Keyboard section */}
        <Section title="Keyboard">
          {SHORTCUT_ROWS.map((r) => (
            <Row key={r.keys.join("+")}>
              <span style={{ display: "inline-flex", gap: 4 }}>
                {r.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
              <Desc>{r.desc}</Desc>
            </Row>
          ))}
        </Section>

        {/* Quick start */}
        <Section title="Quick start">
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "rgba(26, 26, 26, 0.72)",
            }}
          >
            Describe your space in the chat at the bottom and the assistant
            responds with design ideas. Switch modes (Interior Design /
            Furniture / Room Layout) from the dropdown inside the input. Toggle{" "}
            <Kbd inline>H</Kbd> at any time to hide all UI and admire the room.
          </p>
        </Section>
      </div>
    </div>
  );
}

// ─── small primitives kept inline so the modal stays self-contained ──

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 500,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(26, 26, 26, 0.45)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 1fr",
        alignItems: "baseline",
        columnGap: 14,
      }}
    >
      {children}
    </div>
  );
}

function ActionGlyph({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 500,
        color: "rgba(26, 26, 26, 0.85)",
      }}
    >
      {children}
    </span>
  );
}

function Desc({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 400,
        color: "rgba(26, 26, 26, 0.65)",
      }}
    >
      {children}
    </span>
  );
}

function Kbd({
  children,
  inline = false,
}: {
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        fontFamily: "ui-monospace, 'SF Mono', monospace",
        fontSize: 10.5,
        fontWeight: 500,
        color: "#1A1A1A",
        background: "rgba(255, 255, 255, 0.7)",
        border: "1px solid rgba(124, 80, 50, 0.22)",
        borderRadius: 4,
        letterSpacing: "0.02em",
        margin: inline ? "0 2px" : 0,
      }}
    >
      {children}
    </kbd>
  );
}
