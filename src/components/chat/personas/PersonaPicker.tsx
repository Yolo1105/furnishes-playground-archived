"use client";

import { useEffect, useId, useRef } from "react";
import { useStore } from "@studio/store";
import {
  getAssistantById,
  listAssistants,
  type EvaPersonaId,
} from "@/lib/eva/assistants/catalog";
import { CheckIcon, CloseIcon } from "@studio/icons";

/**
 * Compact Account-style persona picker — dialog on desktop, sheet-like
 * full-width on narrow viewports. Radio-group semantics for a11y.
 */
export function PersonaPicker() {
  const open = useStore((s) => s.personaPickerOpen);
  const setOpen = useStore((s) => s.setPersonaPickerOpen);
  const activeId = useStore((s) => s.activePersonaId);
  const saving = useStore((s) => s.personaSaveState === "saving");
  const setActive = useStore((s) => s.setActivePersonaId);
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const selected = dialogRef.current?.querySelector<HTMLElement>(
      '[aria-checked="true"]',
    );
    selected?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [open, setOpen]);

  if (!open) return null;

  const assistants = listAssistants();

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(26, 26, 26, 0.28)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="glass-modal"
        style={{
          width: "100%",
          maxWidth: 420,
          maxHeight: "min(80vh, 560px)",
          overflow: "auto",
          borderRadius: 16,
          padding: "18px 16px 14px",
          fontFamily: "var(--font-syne), system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <div>
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 600,
                color: "rgba(26,26,26,0.92)",
                letterSpacing: "-0.01em",
              }}
            >
              Choose how Eva should help
            </h2>
            <p
              id={descId}
              style={{
                margin: "6px 0 0",
                fontSize: 11,
                lineHeight: 1.45,
                color: "rgba(26,26,26,0.55)",
              }}
            >
              This changes future replies. Earlier messages stay unchanged.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            style={iconBtn}
          >
            <CloseIcon size={12} />
          </button>
        </div>

        <div
          role="radiogroup"
          aria-labelledby={titleId}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {assistants.map((a) => {
            const selected = a.id === activeId;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving}
                onClick={() => void setActive(a.id as EvaPersonaId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: selected
                    ? "1px solid rgba(255, 90, 31, 0.45)"
                    : "1px solid rgba(124, 80, 50, 0.18)",
                  background: selected
                    ? "rgba(255, 90, 31, 0.08)"
                    : "rgba(255,255,255,0.55)",
                  cursor: saving ? "wait" : "pointer",
                  opacity: saving && !selected ? 0.65 : 1,
                  fontFamily: "inherit",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: "#FF5A1F",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  E
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "rgba(26,26,26,0.9)",
                    }}
                  >
                    {a.name}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: "rgba(26,26,26,0.55)",
                      marginTop: 2,
                    }}
                  >
                    {a.tagline}
                  </span>
                </span>
                {selected ? (
                  <CheckIcon size={14} style={{ color: "#FF5A1F" }} />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 6,
  borderRadius: 8,
  cursor: "pointer",
  color: "rgba(26,26,26,0.55)",
  flexShrink: 0,
};

/** Tiny toast for persona switch feedback. */
export function PersonaToast() {
  const toast = useStore((s) => s.personaToast);
  const clear = useStore((s) => s.clearPersonaToast);
  if (!toast) return null;
  return (
    <div
      role="status"
      onClick={clear}
      style={{
        position: "fixed",
        bottom: 96,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 130,
        padding: "8px 14px",
        borderRadius: 999,
        background: "rgba(26,26,26,0.88)",
        color: "#fff",
        fontSize: 12,
        fontFamily: "var(--font-syne), system-ui, sans-serif",
        letterSpacing: "-0.01em",
        cursor: "pointer",
        maxWidth: "min(90vw, 360px)",
        textAlign: "center",
      }}
    >
      {toast}
    </div>
  );
}

export function useActivePersona() {
  const id = useStore((s) => s.activePersonaId);
  return getAssistantById(id);
}
