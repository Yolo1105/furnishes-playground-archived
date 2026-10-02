"use client";

import { useEffect, useMemo } from "react";
import { useStore } from "@studio/store";
import {
  selectConfirmedPreferences,
  selectPendingPreferences,
} from "@studio/store/preferences-slice";
import { getAssistantById } from "@/lib/eva/assistants/catalog";
import { CloseIcon, SwapIcon, SparkleIcon } from "@studio/icons";
import {
  CHAT_PREFERENCE_CATEGORIES,
  preferenceKeyToCategory,
} from "./preferences/preference-types";
import { PreferenceProposalCard } from "./preferences/PreferenceProposalCard";

/**
 * Eva context panel — identity, persona switch, pending proposals,
 * and the five confirmed preference blocks. Opens as a right sheet
 * on desktop / bottom sheet on narrow viewports from the Eva chip.
 */
export function EvaContextPanel() {
  const open = useStore((s) => s.evaPanelOpen);
  const setOpen = useStore((s) => s.setEvaPanelOpen);
  const setPickerOpen = useStore((s) => s.setPersonaPickerOpen);
  const personaId = useStore((s) => s.activePersonaId);
  const projectId = useStore((s) => s.currentProjectId);
  const preferences = useStore((s) => s.preferences);
  const setSource = useStore((s) => s.setPreferenceSourceId);
  const updateValue = useStore((s) => s.updatePreferenceValue);
  const deletePreference = useStore((s) => s.deletePreference);
  const setMessage = useStore((s) => s.setMessage);

  const persona = getAssistantById(personaId);

  const pending = useMemo(
    () =>
      projectId
        ? selectPendingPreferences({ preferences } as never, projectId)
        : [],
    [preferences, projectId],
  );

  const confirmed = useMemo(
    () =>
      projectId
        ? selectConfirmedPreferences({ preferences } as never, projectId)
        : [],
    [preferences, projectId],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !useStore.getState().personaPickerOpen) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const byCategory = Object.fromEntries(
    CHAT_PREFERENCE_CATEGORIES.map((c) => [c.id, null as (typeof confirmed)[0] | null]),
  ) as Record<string, (typeof confirmed)[0] | null>;
  for (const p of confirmed) {
    const cat = preferenceKeyToCategory(p.key, p.value);
    // Keep most recently updated per category.
    const existing = byCategory[cat];
    if (!existing || p.updatedAt >= existing.updatedAt) {
      byCategory[cat] = p;
    }
  }

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
        background: "rgba(26, 26, 26, 0.22)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <aside
        role="dialog"
        aria-label="Eva preferences panel"
        aria-modal="true"
        className="glass-popover"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: "min(320px, 100vw)",
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid rgba(124, 80, 50, 0.18)",
          borderRadius: 0,
          fontFamily: "var(--font-syne), system-ui, sans-serif",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 14px 12px",
            borderBottom: "1px solid rgba(124, 80, 50, 0.12)",
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
              fontWeight: 700,
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            E
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(26,26,26,0.92)",
              }}
            >
              {persona.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(26,26,26,0.55)",
                marginTop: 2,
              }}
            >
              {persona.tagline}
            </div>
          </div>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={false}
            aria-label="Switch Eva assistant"
            onClick={() => setPickerOpen(true)}
            style={iconBtn}
          >
            <SwapIcon size={14} />
          </button>
          <button
            type="button"
            aria-label="Close Eva panel"
            onClick={() => setOpen(false)}
            style={iconBtn}
          >
            <CloseIcon size={12} />
          </button>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: "12px 14px 20px" }}>
          <button
            type="button"
            onClick={() => {
              setMessage(
                "Brainstorm three directions for this space based on my saved preferences.",
              );
              setOpen(false);
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "9px 12px",
              marginBottom: 14,
              borderRadius: 10,
              border: "1px solid rgba(124, 80, 50, 0.2)",
              background: "rgba(255,255,255,0.55)",
              color: "#FF5A1F",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <SparkleIcon size={13} />
            Brainstorm for me
          </button>

          {pending.length > 0 ? (
            <section style={{ marginBottom: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 8,
                }}
              >
                <h3 style={sectionLabel}>Suggestions to review</h3>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "rgba(26,26,26,0.45)",
                  }}
                >
                  {pending.length}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pending.map((p) => (
                  <PreferenceProposalCard
                    key={p.id}
                    preference={p}
                    compact
                    showAcceptedChrome={false}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h3 style={{ ...sectionLabel, marginBottom: 8 }}>Preferences</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {CHAT_PREFERENCE_CATEGORIES.map((cat) => {
                const pref = byCategory[cat.id];
                return (
                  <div
                    key={cat.id}
                    style={{
                      borderRadius: 10,
                      border: pref
                        ? "1px solid rgba(255, 90, 31, 0.28)"
                        : "1px solid rgba(124, 80, 50, 0.14)",
                      padding: "10px 11px",
                      background: "rgba(255,255,255,0.4)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "baseline",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "rgba(26,26,26,0.35)",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {cat.index}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "rgba(26,26,26,0.85)",
                        }}
                      >
                        {cat.label}
                      </span>
                    </div>
                    {pref ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setSource(pref.id)}
                          style={{
                            marginTop: 6,
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#FF5A1F",
                            fontFamily: "inherit",
                            textAlign: "left",
                          }}
                        >
                          {pref.value}
                        </button>
                        <p
                          style={{
                            margin: "4px 0 0",
                            fontSize: 10,
                            color: "rgba(26,26,26,0.45)",
                          }}
                        >
                          Confirmed from your message
                        </p>
                        <div
                          style={{
                            display: "flex",
                            gap: 10,
                            marginTop: 8,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              const next = window.prompt(
                                cat.label,
                                pref.value,
                              );
                              if (next != null && next.trim()) {
                                updateValue(pref.id, next.trim());
                              }
                            }}
                            style={linkBtn}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deletePreference(pref.id)}
                            style={linkBtn}
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    ) : (
                      <p
                        style={{
                          margin: "6px 0 0",
                          fontSize: 11,
                          color: "rgba(26,26,26,0.4)",
                        }}
                      >
                        Not set yet
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

/** Compact Eva control in the input toolbar — opens the context panel. */
export function EvaChip() {
  const open = useStore((s) => s.evaPanelOpen);
  const setOpen = useStore((s) => s.setEvaPanelOpen);
  const hydrate = useStore((s) => s.hydratePersona);
  const personaId = useStore((s) => s.activePersonaId);
  const projectId = useStore((s) => s.currentProjectId);
  const preferences = useStore((s) => s.preferences);
  const persona = getAssistantById(personaId);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const pendingCount = projectId
    ? selectPendingPreferences({ preferences } as never, projectId).length
    : 0;

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Open Eva panel — ${persona.name}`}
      onClick={() => setOpen(true)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px 4px 4px",
        borderRadius: 999,
        border: "1px solid rgba(124, 80, 50, 0.2)",
        background: open
          ? "rgba(255, 90, 31, 0.08)"
          : "rgba(255, 255, 255, 0.55)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 11,
        fontWeight: 600,
        color: "rgba(26,26,26,0.78)",
        letterSpacing: "-0.01em",
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#FF5A1F",
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: 9,
          fontWeight: 700,
        }}
      >
        E
      </span>
      <span>{persona.name}</span>
      {pendingCount > 0 ? (
        <span
          style={{
            minWidth: 15,
            height: 15,
            padding: "0 4px",
            borderRadius: 999,
            background: "rgba(255, 90, 31, 0.15)",
            color: "#FF5A1F",
            fontSize: 10,
            fontWeight: 700,
            display: "grid",
            placeItems: "center",
          }}
        >
          {pendingCount}
        </span>
      ) : null}
    </button>
  );
}

const sectionLabel: React.CSSProperties = {
  margin: 0,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(26,26,26,0.4)",
};

const iconBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 6,
  borderRadius: 8,
  cursor: "pointer",
  color: "rgba(26,26,26,0.55)",
  display: "grid",
  placeItems: "center",
};

const linkBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
  color: "rgba(26,26,26,0.5)",
  fontFamily: "inherit",
};
