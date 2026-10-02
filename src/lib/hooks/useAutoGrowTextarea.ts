import { useEffect, type RefObject } from "react";

/**
 * Auto-grow a textarea up to a max height. The DOM-measurement approach
 * (set height to auto, then to scrollHeight) is the same one the JSX
 * uses; it works reliably across browsers and avoids a hidden mirror
 * element. Pass the value(s) that should trigger a re-measure as deps.
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  deps: React.DependencyList,
  maxHeight = 180,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, deps);
}
