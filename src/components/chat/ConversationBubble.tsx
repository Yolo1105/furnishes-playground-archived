"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@studio/store";
import { selectActiveConversationTurns } from "@studio/store/chat-slice";
import { ChevronDownIcon } from "@studio/icons";
import { renderMarkdown } from "@studio/chat/render-markdown";

/** Strip markdown markers from a string for plain-text preview use.
 *  Keeps the visible characters (so "**Hello**" → "Hello") but loses
 *  the formatting. Used in the 2-line-clamp collapsed preview where
 *  inline tags don't read well in such a small space. */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/\*([\s\S]+?)\*/g, "$1")
    .replace(/`([^`]+?)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ");
}

/**
 * Conversation bubble shown above the input box after the first reply
 * lands. Has three states:
 *   • collapsed (default) — latest response with a 2-line clamp; click
 *                           anywhere to expand. A small × in the
 *                           top-right hides the bubble entirely.
 *   • expanded            — full scrollable history (max 60vh), each
 *                           turn shown as a user bubble + system
 *                           bubble with a centered timestamp.
 *   • hidden              — bubble itself is gone; the parent renders
 *                           a small reopen pill instead (see ReopenPill).
 *
 * State for these three modes lives in the store so other parts of the
 * app (the `H` keyboard shortcut, future tools that surface chat) can
 * drive them without prop drilling.
 */
export function ConversationBubble() {
  const conversation = useStore(selectActiveConversationTurns);
  const expanded = useStore((s) => s.bubbleExpanded);
  const hidden = useStore((s) => s.bubbleHidden);
  const setExpanded = useStore((s) => s.setBubbleExpanded);
  const setHidden = useStore((s) => s.setBubbleHidden);
  // v0.40.26: hide the bubble entirely while the model is thinking
  // or generating. The user wanted minimal chrome during processing —
  // the prior reply isn't useful right then, and the ThinkingLog
  // (which renders below) shows the live progress + a pinned echo of
  // their just-sent message. The bubble re-appears when isThinking +
  // isGenerating both flip false (i.e. the next response has landed).
  const isThinking = useStore((s) => s.isThinking);
  const isGenerating = useStore((s) => s.isGenerating);

  // Keyboard shortcut: Escape collapses the expanded view. The user
  // could not reach the chevron-down collapse button when the bubble
  // grew past viewport top (the bubble flows above a fixed-bottom
  // chat dock, so a tall expansion can push the header above the
  // visible area). Escape always works, regardless of where the
  // bubble's header lands.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, setExpanded]);

  if (conversation.length === 0 || hidden) return null;
  // Suppress while processing — ThinkingLog handles that window.
  if (isThinking || isGenerating) return null;

  const latest = conversation[conversation.length - 1];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        // 75vh (was 60vh) — gives users more room to read long
        // multi-paragraph responses without internal scrolling.
        maxHeight: expanded ? "75vh" : "auto",
        overflow: "visible",
        transition: "max-height 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {expanded ? (
        <ExpandedHistory onCollapse={() => setExpanded(false)} />
      ) : (
        <CollapsedPreview
          response={latest.response}
          onExpand={() => setExpanded(true)}
          onHide={() => {
            setHidden(true);
            setExpanded(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

interface CollapsedProps {
  response: string;
  onExpand: () => void;
  onHide: () => void;
}

function CollapsedPreview({ response, onExpand, onHide }: CollapsedProps) {
  return (
    <div
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onExpand();
      }}
      className="glass conversation-bubble"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 14px",
        paddingRight: 38,
        borderRadius: 16,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "var(--font-syne), sans-serif",
        animation: "bubble-in 0.35s cubic-bezier(0.22, 1, 0.36, 1)",
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      {/* Collapse button (top-right). v0.40.26: was a "×" Close icon
          but the action is semantically a COLLAPSE — clicking hides
          the bubble and replaces it with the small ReopenPill, so
          nothing is destroyed. The chevron-down icon matches that
          intent. */}
      <button
        type="button"
        className="bubble-hide"
        data-tooltip="Collapse"
        onClick={(e) => {
          e.stopPropagation();
          onHide();
        }}
        aria-label="Collapse bubble"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 22,
          height: 22,
          borderRadius: 6,
          border: "none",
          background: "transparent",
          color: "rgba(26, 26, 26, 0.45)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "color 0.15s ease, background 0.15s ease",
        }}
      >
        <ChevronDownIcon size={12} />
      </button>

      <div
        style={{
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "rgba(26, 26, 26, 0.85)",
          letterSpacing: "-0.005em",
          // 2-line clamp — the JSX's signature "preview" treatment.
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {stripMarkdown(response)}
      </div>
    </div>
  );
}

interface ExpandedProps {
  onCollapse: () => void;
}

function ExpandedHistory({ onCollapse }: ExpandedProps) {
  const conversation = useStore(selectActiveConversationTurns);
  const scrollRef = useRef<HTMLDivElement>(null);

  // On mount, scroll to the top so the user sees the first turn of
  // the conversation. Without this, browsers default to top:0 which
  // is fine for first-time expansion, but if the user collapses and
  // re-expands after appending new turns, the scroll position can
  // land mid-conversation. Explicit scrollTop = 0 makes "expand"
  // always start at the beginning.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, []);

  return (
    <div
      ref={scrollRef}
      className="glass glass-chat"
      style={{
        overflowY: "auto",
        // Match the outer wrapper's 75vh — leave 60px for the
        // header + padding so the content has clear scroll bounds.
        maxHeight: "calc(75vh - 60px)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "14px 16px",
        borderRadius: 16,
        animation: "bubble-expand-in 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
          // Sticky header so the collapse button stays reachable
          // even when the user scrolls down through a long
          // conversation. Without `position: sticky`, the chevron
          // could leave the visible scroll area and force the user
          // to scroll back up just to close the bubble.
          position: "sticky",
          top: -14, // counteract the parent's 14px top padding
          background: "rgba(255, 251, 246, 0.94)",
          backdropFilter: "blur(4px)",
          paddingTop: 10,
          paddingBottom: 8,
          margin: "-14px -16px 4px",
          padding: "10px 16px 8px",
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(26, 26, 26, 0.5)",
          }}
        >
          Conversation · {conversation.length}
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 9,
              color: "rgba(26, 26, 26, 0.4)",
              letterSpacing: "0.05em",
            }}
          >
            Esc to close
          </span>
          <button
            type="button"
            className="bubble-hide"
            onClick={onCollapse}
            aria-label="Collapse"
            data-tooltip="Collapse"
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              border: "1px solid rgba(124, 80, 50, 0.18)",
              background: "rgba(255, 255, 255, 0.7)",
              color: "rgba(26, 26, 26, 0.75)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition:
                "color 0.15s ease, background 0.15s ease, border-color 0.15s ease",
            }}
          >
            <ChevronDownIcon size={13} />
          </button>
        </div>
      </div>

      {conversation.map((turn) => (
        <div
          key={turn.id}
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          {/* User message — right-aligned, accent-tinted, asymmetric tail. */}
          <div
            style={{
              alignSelf: "flex-end",
              maxWidth: "80%",
              padding: "8px 12px",
              background: "rgba(255, 90, 31, 0.1)",
              border: "1px solid rgba(255, 90, 31, 0.2)",
              borderRadius: "14px 14px 4px 14px",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "#1A1A1A",
              letterSpacing: "-0.005em",
            }}
          >
            {turn.userText}
          </div>

          {/* System response — left-aligned, opposite asymmetric tail.
              Rendered as markdown so **bold**, *italic*, and `- ` bullets
              from Claude's output appear formatted instead of as raw
              source text. v0.40.49: when the response starts with
              "Error:", render with a subtle error treatment (red
              accent border + red text) so the user immediately sees
              the generation didn't succeed. The existing flow surfaces
              the friendlyError text inside the bubble; this just makes
              it visually distinguishable from a successful response.
              No emoji or alarm icons — keeps the studio's calm tone. */}
          {(() => {
            const isError = turn.response.startsWith("Error:");
            return (
              <div
                style={{
                  alignSelf: "flex-start",
                  maxWidth: "92%",
                  padding: "9px 13px",
                  background: isError
                    ? "rgba(217, 64, 64, 0.06)"
                    : "rgba(255, 255, 255, 0.7)",
                  border: isError
                    ? "1px solid rgba(217, 64, 64, 0.32)"
                    : "1px solid rgba(124, 80, 50, 0.2)",
                  borderRadius: "14px 14px 14px 4px",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: isError
                    ? "rgba(140, 30, 30, 0.92)"
                    : "rgba(26, 26, 26, 0.85)",
                  letterSpacing: "-0.005em",
                }}
              >
                {renderMarkdown(turn.response)}
              </div>
            );
          })()}

          <div
            style={{
              fontSize: 9.5,
              color: "rgba(26, 26, 26, 0.4)",
              alignSelf: "center",
              letterSpacing: "0.02em",
              marginTop: 2,
            }}
          >
            {turn.time}
          </div>
        </div>
      ))}
    </div>
  );
}
