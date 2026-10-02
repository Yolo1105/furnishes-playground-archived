import { useEffect } from "react";
import { useStore } from "@studio/store";

/**
 * Global keyboard shortcuts for the Furnishes Studio shell. Registered
 * once at the Studio level. Shortcuts are ignored while the user is
 * typing in any input/textarea/contentEditable target so `h` doesn't
 * fire while the user is composing the word "hello".
 *
 * Currently bound:
 *   • H   — toggle immersive mode. Entering immersive hides every
 *           floating UI surface (project card, top bar, chat dock,
 *           hint card) so only the 3D scene remains; an
 *           `ImmersiveToast` briefly tells the user how to exit.
 *   • Esc — fired even while typing so a stuck dialog can always be
 *           dismissed mid-keystroke. Priority order:
 *             1. Exit immersive mode if it's on
 *             2. Close upload modal if it's open
 *             3. Close help modal if it's open
 *             4. Close Catalog modal if it's open
 *             5. Close any open Coming-soon card
 *           Only the highest-priority match handles the keystroke.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null): boolean => {
      if (!t || !(t instanceof HTMLElement)) return false;
      return (
        t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable
      );
    };

    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();

      // Esc — handled even while typing.
      if (e.key === "Escape") {
        if (s.immersive) {
          s.setImmersive(false);
          return;
        }
        if (s.uploadModalOpen) {
          s.setUploadModalOpen(false);
          return;
        }
        if (s.helpModalOpen) {
          s.setHelpModalOpen(false);
          return;
        }
        if (s.openTools.includes("catalog")) {
          s.closeTool("catalog");
          return;
        }
        if (s.comingSoonCard !== null) {
          s.setComingSoonCard(null);
          return;
        }
      }

      // Everything below is suppressed while typing.
      if (isTypingTarget(e.target)) return;

      // H — toggle immersive. On entry, close any open dialog so
      // nothing pops back into view when immersive is exited.
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        if (s.immersive) {
          s.setImmersive(false);
        } else {
          s.setUploadModalOpen(false);
          s.setHelpModalOpen(false);
          s.setComingSoonCard(null);
          s.closeTool("catalog");
          s.setImmersive(true);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
