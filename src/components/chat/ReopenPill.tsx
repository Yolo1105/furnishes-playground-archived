"use client";

import { useStore } from "@studio/store";
import { selectActiveConversationTurns } from "@studio/store/chat-slice";

/**
 * Small pill that appears in place of the conversation bubble when the
 * user has hidden it (via the bubble's × or the H shortcut). Clicking
 * it restores the bubble — preserved as collapsed (preview) since
 * that's the most useful default state to return to.
 */
export function ReopenPill() {
  const conversation = useStore(selectActiveConversationTurns);
  const hidden = useStore((s) => s.bubbleHidden);
  const setHidden = useStore((s) => s.setBubbleHidden);

  if (!hidden || conversation.length === 0) return null;

  const count = conversation.length;
  const label = `${count} response${count === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={() => setHidden(false)}
      className="glass"
      style={{
        alignSelf: "center",
        padding: "6px 14px",
        borderRadius: 999,
        cursor: "pointer",
        fontFamily: "var(--font-syne), sans-serif",
        fontSize: 11,
        fontWeight: 600,
        color: "rgba(26, 26, 26, 0.75)",
        letterSpacing: "-0.005em",
        animation: "bubble-in 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      aria-label="Show responses"
    >
      {label}
    </button>
  );
}
