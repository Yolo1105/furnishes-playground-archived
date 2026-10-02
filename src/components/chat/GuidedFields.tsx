"use client";

import { useEffect, useRef } from "react";
import { useStore, selectAllKeywordsFilled } from "@studio/store";
import { MODE_CONFIG } from "@studio/chat/modeConfig";
import { useAutoGrowTextarea } from "@studio/hooks/useAutoGrowTextarea";

interface Props {
  onFocusInside: (focused: boolean) => void;
}

/**
 * The guided-mode body of the input box: one row per keyword field,
 * plus a free-form notes textarea below that stays disabled until
 * every keyword field is filled. Pressing Enter on a field advances
 * focus to the next field, or to the notes textarea when on the last.
 *
 * The "Locked" → "Free form" affordance is the JSX's progressive-
 * disclosure pattern preserved verbatim.
 */
export function GuidedFields({ onFocusInside }: Props) {
  const mode = useStore((s) => s.mode);
  const guidedValues = useStore((s) => s.guidedValues);
  const setGuidedValue = useStore((s) => s.setGuidedValue);
  const message = useStore((s) => s.message);
  const setMessage = useStore((s) => s.setMessage);
  const allFilled = useStore(selectAllKeywordsFilled);

  const fields = MODE_CONFIG[mode].keywords;

  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useAutoGrowTextarea(notesRef, [message]);

  // Reset stored field refs when the mode changes (different keys).
  useEffect(() => {
    fieldRefs.current = {};
  }, [mode]);

  const handleFieldKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number,
  ) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (index < fields.length - 1) {
      const nextKey = fields[index + 1].key;
      fieldRefs.current[nextKey]?.focus();
    } else if (allFilled) {
      notesRef.current?.focus();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Keyword rows */}
      {fields.map((kw, index) => {
        const value = guidedValues[kw.key] ?? "";
        const filled = value.trim().length > 0;
        return (
          <div
            key={kw.key}
            className="guided-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 4px",
              borderBottom: "1px dashed rgba(124, 80, 50, 0.14)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                minWidth: 82,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: filled ? "#FF5A1F" : "rgba(26, 26, 26, 0.15)",
                  transition: "background 0.2s ease",
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: filled ? "#1A1A1A" : "rgba(26, 26, 26, 0.6)",
                  letterSpacing: "-0.005em",
                }}
              >
                {kw.label}
              </span>
            </div>
            <input
              type="text"
              className="guided-input"
              ref={(el) => {
                fieldRefs.current[kw.key] = el;
              }}
              value={value}
              onChange={(e) => setGuidedValue(kw.key, e.target.value)}
              onKeyDown={(e) => handleFieldKeyDown(e, index)}
              onFocus={() => onFocusInside(true)}
              onBlur={() => onFocusInside(false)}
              placeholder={kw.placeholder}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: 13,
                fontWeight: 400,
                color: "#1A1A1A",
                padding: "2px 0",
                letterSpacing: "-0.005em",
              }}
            />
          </div>
        );
      })}

      {/* Free-form notes — locked until every keyword field is filled */}
      <div
        style={{
          padding: "8px 4px 4px 4px",
          opacity: allFilled ? 1 : 0.45,
          transition: "opacity 0.3s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            marginBottom: 5,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: allFilled ? "#1A1A1A" : "rgba(26, 26, 26, 0.4)",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            {allFilled ? "Free form" : "Locked"}
          </span>
          {!allFilled && (
            <span style={{ fontSize: 11, color: "rgba(26, 26, 26, 0.45)" }}>
              — fill the lines above to unlock
            </span>
          )}
        </div>
        <textarea
          ref={notesRef}
          className="notes-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => onFocusInside(true)}
          onBlur={() => onFocusInside(false)}
          placeholder={
            allFilled
              ? "Anything else you'd add? (optional)"
              : "Fill the lines above first…"
          }
          disabled={!allFilled}
          rows={1}
          style={{
            width: "100%",
            border: "none",
            resize: "none",
            background: "transparent",
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.5,
            color: "#1A1A1A",
            padding: "2px 0 6px 0",
            minHeight: 20,
            maxHeight: 160,
            letterSpacing: "-0.005em",
            cursor: allFilled ? "text" : "not-allowed",
          }}
        />
      </div>
    </div>
  );
}
