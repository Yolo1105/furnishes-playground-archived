"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * StaggeredMount — wrapper that fades its children in after a
 * configurable delay. Used at the studio root to give the first-load
 * experience a "real website" feel: instead of every card appearing
 * simultaneously the moment React mounts, the surfaces settle in
 * over ~1 second in a deliberate sequence.
 *
 * Behavior:
 *   - On mount, children render at opacity 0.
 *   - After `delayMs`, the children fade to opacity 1 over `durationMs`
 *     (default 360ms) using a soft ease-out curve.
 *   - During the fade window, `pointer-events: none` prevents
 *     accidental clicks on a half-faded card.
 *   - `prefers-reduced-motion: reduce` users see all children
 *     immediately at full opacity (skipped animation).
 *
 * Why opacity-only (no transform):
 *   Children of this wrapper use `position: fixed`. A non-zero
 *   `transform` on the wrapper would establish a containing block
 *   for those descendants, making them position relative to the
 *   wrapper instead of the viewport — which changes their layout
 *   while the animation runs. Sticking to opacity keeps the layout
 *   stable; the fade alone is enough for the staggered-entry feel.
 */

interface StaggeredMountProps {
  /** Milliseconds to wait before starting the fade-in. */
  delayMs: number;
  /** Total animation duration. Default 360ms. */
  durationMs?: number;
  /** Disable the wrapper for accessibility (already applied automatically
   *  for `prefers-reduced-motion: reduce`). */
  disabled?: boolean;
  children: ReactNode;
}

export function StaggeredMount({
  delayMs,
  durationMs = 360,
  disabled = false,
  children,
}: StaggeredMountProps) {
  const [visible, setVisible] = useState(disabled);

  useEffect(() => {
    if (disabled) {
      setVisible(true);
      return;
    }
    // Respect prefers-reduced-motion: snap to visible immediately.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(true);
      return;
    }

    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, disabled]);

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        pointerEvents: visible ? "auto" : "none",
        // The wrapper itself is layout-neutral — every wrapped card
        // has `position: fixed`, so the wrapper's box model doesn't
        // affect placement. The wrapper exists purely so opacity can
        // apply to the subtree. We deliberately DON'T use `transform`
        // here — a non-zero transform on the wrapper would establish
        // a containing block for fixed-positioned descendants, making
        // them position relative to the wrapper instead of the
        // viewport. The fade-in alone is enough for the staggered-
        // entry feel.
      }}
    >
      {children}
    </div>
  );
}
