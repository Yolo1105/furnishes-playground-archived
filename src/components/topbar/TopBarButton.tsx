"use client";

import type { ReactNode } from "react";

/**
 * Square icon button for the top bar. Three states drive the visual:
 *
 *   • base   — transparent, muted ink stroke
 *   • hover  — handled by the `.topbar-btn:hover` rule in globals.css;
 *              subtle neutral fill behind the icon
 *   • active — brand-accent fill + accent stroke; for toggle buttons
 *              that are currently "on"
 *   • disabled — opacity 0.4, cursor not-allowed, no hover; used for
 *                "coming soon" entries that are visible but inert
 *
 * `title` is mapped to the native HTML `title` so OS tooltips show on
 * hover. We keep this primitive for now; if we need richer tooltips
 * later we can replace this in one place.
 *
 * `aria-label` falls back to `title` so screen readers always have a
 * label even on icon-only buttons.
 */
interface TopBarButtonProps {
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  ariaLabel?: string;
  children: ReactNode;
  /** When true, the button is wider — used by the env-lighting and
   *  any future dropdown triggers that pair an icon with a chevron. */
  withChevron?: boolean;
}

export function TopBarButton({
  onClick,
  active = false,
  disabled = false,
  title,
  ariaLabel,
  children,
  withChevron = false,
}: TopBarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? title}
      data-active={active || undefined}
      className="topbar-btn"
      style={{
        height: 30,
        // Square unless the button has a chevron, in which case it
        // grows to fit icon + label + chevron.
        width: withChevron ? "auto" : 30,
        minWidth: withChevron ? 40 : 30,
        borderRadius: 7,
        border: "1px solid",
        borderColor: active ? "rgba(255, 90, 31, 0.5)" : "transparent",
        background: active ? "rgba(255, 90, 31, 0.08)" : "transparent",
        color: active ? "#FF5A1F" : "rgba(26, 26, 26, 0.7)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        padding: withChevron ? "0 8px" : 0,
        transition:
          "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/**
 * Thin vertical divider used to group buttons in the top bar.
 * Matches the zip's `<div className="w-px self-stretch" ...>`
 * pattern — purely a separator, not a control.
 */
export function TopBarDivider() {
  return (
    <div
      style={{
        width: 1,
        height: 22,
        background: "rgba(26, 26, 26, 0.1)",
        margin: "0 2px",
        flexShrink: 0,
      }}
    />
  );
}
