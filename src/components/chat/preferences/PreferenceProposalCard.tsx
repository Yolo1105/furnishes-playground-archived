"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useStore } from "@studio/store";
import type { Preference } from "@studio/store/preferences-slice";
import {
  categoryLabel,
  confidenceLabelText,
  confidenceToLabel,
  preferenceKeyToCategory,
} from "./preference-types";
import { CloseIcon } from "@studio/icons";

type ProposalCardProps = {
  preference: Preference;
  /** Compact mode for the side panel review list. */
  compact?: boolean;
  /** After accept, briefly show Saved + Undo. */
  showAcceptedChrome?: boolean;
};

/**
 * Inline / panel preference proposal. Accept persists confirmation;
 * Dismiss rejects without deleting the audit row.
 */
export function PreferenceProposalCard({
  preference: p,
  compact = false,
  showAcceptedChrome = true,
}: ProposalCardProps) {
  const setStatus = useStore((s) => s.setPreferenceStatus);
  const setEditing = useStore((s) => s.setPreferenceEditingId);
  const setSource = useStore((s) => s.setPreferenceSourceId);
  const editingId = useStore((s) => s.preferenceEditingId);
  const updateValue = useStore((s) => s.updatePreferenceValue);
  const [justAccepted, setJustAccepted] = useState(false);
  const undoTimer = useRef<number | null>(null);

  const category = preferenceKeyToCategory(p.key, p.value);
  const conf = confidenceToLabel(p.confidence);
  const isEditing = editingId === p.id;

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  if (p.status === "rejected") return null;

  if (p.status === "confirmed" && justAccepted && showAcceptedChrome) {
    return (
      <div
        role="status"
        style={{
          ...cardBase,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "rgba(26,26,26,0.72)" }}>
          Saved to Eva’s memory
        </span>
        <button
          type="button"
          onClick={() => {
            setStatus(p.id, "provisional");
            setJustAccepted(false);
            if (undoTimer.current) window.clearTimeout(undoTimer.current);
          }}
          style={textBtn}
        >
          Undo
        </button>
      </div>
    );
  }

  if (p.status === "confirmed") return null;

  const accept = () => {
    setStatus(p.id, "confirmed");
    setJustAccepted(true);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => {
      setJustAccepted(false);
    }, 6000);
  };

  return (
    <div
      style={{
        ...cardBase,
        padding: compact ? "10px 11px" : "12px 13px",
      }}
      aria-label={`Eva noticed a preference: ${categoryLabel(category)} ${p.value}`}
    >
      {!compact ? (
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(26,26,26,0.55)",
            letterSpacing: "0.02em",
          }}
        >
          Eva noticed a preference
        </p>
      ) : null}

      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(26,26,26,0.45)",
        }}
      >
        {categoryLabel(category)}
      </p>

      {isEditing ? (
        <PreferenceEditorInline
          initial={p.value}
          onSave={(v) => {
            updateValue(p.id, v);
            setStatus(p.id, "confirmed");
            setEditing(null);
            setJustAccepted(true);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <p
          style={{
            margin: "4px 0 0",
            fontSize: compact ? 12 : 13,
            fontWeight: 600,
            color: "rgba(26,26,26,0.9)",
            letterSpacing: "-0.01em",
          }}
        >
          {p.value}
        </p>
      )}

      <p
        style={{
          margin: "6px 0 0",
          fontSize: 11,
          color: "rgba(26,26,26,0.5)",
        }}
      >
        {confidenceLabelText(conf)}
      </p>

      {!isEditing ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            marginTop: 10,
          }}
        >
          <button type="button" onClick={accept} style={primaryBtn}>
            Accept
          </button>
          <button
            type="button"
            onClick={() => setEditing(p.id)}
            style={ghostBtn}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setStatus(p.id, "rejected")}
            style={ghostBtn}
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => setSource(p.id)}
            style={{ ...textBtn, marginLeft: "auto" }}
          >
            View source
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PreferenceEditorInline({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ marginTop: 8 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(value);
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "7px 9px",
          borderRadius: 8,
          border: "1px solid rgba(124, 80, 50, 0.25)",
          background: "rgba(255,255,255,0.8)",
          fontFamily: "inherit",
          fontSize: 12,
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onSave(value)}
          disabled={!value.trim()}
          style={primaryBtn}
        >
          Save preference
        </button>
        <button type="button" onClick={onCancel} style={ghostBtn}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PreferenceProposalSummary({
  count,
  onReview,
}: {
  count: number;
  onReview: () => void;
}) {
  if (count <= 0) return null;
  return (
    <div style={cardBase}>
      <p style={{ margin: 0, fontSize: 12, color: "rgba(26,26,26,0.75)" }}>
        Eva found {count} more possible preference{count === 1 ? "" : "s"}
      </p>
      <button
        type="button"
        onClick={onReview}
        style={{ ...textBtn, marginTop: 8 }}
      >
        Review
      </button>
    </div>
  );
}

export function PreferenceSourceInspector() {
  const id = useStore((s) => s.preferenceSourceId);
  const setId = useStore((s) => s.setPreferenceSourceId);
  const preferences = useStore((s) => s.preferences);
  const conversations = useStore((s) => s.conversations);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const pref = preferences.find((p) => p.id === id) ?? null;

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setId(null);
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [id, setId]);

  if (!pref) return null;

  const category = preferenceKeyToCategory(pref.key, pref.value);
  let turnStamp: string | null = null;
  for (const c of conversations) {
    const turn = c.turns.find((t) => t.id === pref.sourceTurnId);
    if (turn) {
      turnStamp = turn.time;
      break;
    }
  }

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 125,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(26, 26, 26, 0.28)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setId(null);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="glass-modal"
        style={{
          width: "100%",
          maxWidth: 400,
          borderRadius: 16,
          padding: 18,
          fontFamily: "var(--font-syne), system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <h2
            id={titleId}
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "rgba(26,26,26,0.9)",
            }}
          >
            {categoryLabel(category)}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setId(null)}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "rgba(26,26,26,0.55)",
            }}
          >
            <CloseIcon size={12} />
          </button>
        </div>
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            fontWeight: 600,
            color: "rgba(26,26,26,0.88)",
          }}
        >
          {pref.value}
        </p>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            color: "rgba(26,26,26,0.5)",
          }}
        >
          From your message
          {turnStamp ? ` · ${turnStamp}` : ""}
        </p>
        <blockquote
          style={{
            margin: 0,
            padding: "10px 12px",
            borderLeft: "2px solid rgba(255, 90, 31, 0.45)",
            background: "rgba(255,255,255,0.45)",
            borderRadius: "0 10px 10px 0",
            fontSize: 12,
            lineHeight: 1.5,
            color: "rgba(26,26,26,0.78)",
            userSelect: "text",
          }}
        >
          “{pref.sourceText}”
        </blockquote>
      </div>
    </div>
  );
}

const cardBase: React.CSSProperties = {
  borderRadius: 12,
  border: "1px solid rgba(124, 80, 50, 0.18)",
  background: "rgba(255, 248, 240, 0.85)",
  padding: "11px 12px",
  fontFamily: "var(--font-syne), system-ui, sans-serif",
};

const primaryBtn: React.CSSProperties = {
  border: "1px solid rgba(46, 125, 70, 0.35)",
  background: "rgba(46, 125, 70, 0.12)",
  color: "rgba(28, 90, 48, 0.95)",
  borderRadius: 8,
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

const ghostBtn: React.CSSProperties = {
  border: "1px solid rgba(124, 80, 50, 0.2)",
  background: "rgba(255,255,255,0.55)",
  color: "rgba(26,26,26,0.7)",
  borderRadius: 8,
  padding: "5px 10px",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
};

const textBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#FF5A1F",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
  fontFamily: "inherit",
};
