"use client";

import React from "react";

/**
 * Tool-card error boundary. Wraps a floating tool card (Reference,
 * Inventory, ChatHistory, Generations) so a runtime crash inside one
 * card doesn't take down the whole studio.
 *
 * The error gets logged to the console with a `[tool-card]` prefix +
 * the card's name, and the user sees a small recoverable message
 * inside a glass card matching the visual rhythm of a real tool card.
 *
 * Position-aware fallback: each card has a different "home" position
 * (Reference top-right, Inventory left, etc.). When a card crashes,
 * the fallback card mounts at the SAME position as the original so
 * the error appears where the user was looking. The position table
 * is keyed off cardName.
 *
 * Why a class component: error boundaries require lifecycle methods
 * (`getDerivedStateFromError` + `componentDidCatch`) that don't exist
 * in the hooks API. React still has no functional equivalent.
 *
 * Reset: clicking "Reload card" clears the error state. If the same
 * crash recurs immediately, the user sees the same message again —
 * no automatic retry loop.
 */

interface Props {
  cardName: string;
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

/** Fallback positions per card. Keys match the cardName values used
 *  in ToolFloatingCard's switch (Reference, Inventory, Generations,
 *  Chat history). When a card not in this table crashes, we fall
 *  back to the top-left default. */
const FALLBACK_POSITIONS: Record<string, React.CSSProperties> = {
  Reference: { top: 14, right: 14 },
  Generations: { top: 270, right: 14 },
  Inventory: { top: 290, left: 14 },
  "Chat history": { top: 76, left: 200 },
};

export class ToolCardErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[tool-card] ${this.props.cardName} crashed:`,
      error,
      info.componentStack,
    );
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const pos = FALLBACK_POSITIONS[this.props.cardName] ?? {
        top: 76,
        left: 200,
      };
      return (
        <aside
          className="glass"
          style={{
            position: "fixed",
            ...pos,
            width: 280,
            padding: 14,
            borderRadius: 14,
            zIndex: 4,
            fontFamily: "var(--font-app), system-ui, sans-serif",
            fontSize: 12,
            color: "#1A1A1A",
          }}
        >
          <div style={{ fontWeight: 500, marginBottom: 6 }}>
            {this.props.cardName} hit an error
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(26, 26, 26, 0.6)",
              marginBottom: 10,
              lineHeight: 1.4,
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message || "Unknown error."}
          </div>
          <button
            type="button"
            onClick={this.reset}
            style={{
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255, 90, 31, 0.4)",
              background: "transparent",
              color: "#FF5A1F",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Reload card
          </button>
        </aside>
      );
    }
    return this.props.children;
  }
}
