"use client";

import { useStore } from "@studio/store";
import { CAD_EDGE_NUDGE_PX } from "@studio/layout/cadEdgeNudge";
import { ConversationBubble } from "./ConversationBubble";
import { ReopenPill } from "./ReopenPill";
import { ThinkingLog } from "./ThinkingLog";
import { QuickSuggestions } from "./QuickSuggestions";
import { ChatInputBox } from "./ChatInputBox";
import { ProfileDisclosure } from "./ProfileDisclosure";
import { ProfileSuggestionBanner } from "./ProfileSuggestionBanner";
import { EvaContextPanel } from "./EvaContextPanel";
import {
  PersonaPicker,
  PersonaToast,
} from "./personas/PersonaPicker";
import { InlinePreferenceProposals } from "./preferences/InlinePreferenceProposals";
import { PreferenceSourceInspector } from "./preferences/PreferenceProposalCard";

const CHAT_DOCK_BOTTOM_PX = 20;

/**
 * The bottom-center chat dock — a 600px-wide vertical stack that
 * contains, top to bottom:
 *
 *   • The conversation bubble (or a reopen pill, if hidden)
 *   • The thinking log (only while waiting on a response)
 *   • The quick-suggestions chip strip (only when toggled on)
 *   • The input box itself
 *
 * Conversation switching (multi-conversation per project) lives in
 * the Chat history tools-card, not in this dock — moved out so the
 * dock stays focused on the active thread, and the user has a more
 * spacious surface for managing 2+ conversations.
 *
 * The dock is `position: fixed` so it stays anchored regardless of
 * what the 3D scene is doing behind it. Width is fixed at 600px to
 * match the JSX; on narrow viewports it falls back to fill.
 *
 * In CAD/grid mode it lifts by the same edge nudge as other chrome
 * so the CAD status bar stays readable underneath.
 */
export function ChatDock() {
  const cadMode = useStore((s) => s.mainViewMode === "2d");

  return (
    <>
      <div
        data-chat-dock="true"
        style={{
          position: "fixed",
          bottom: cadMode
            ? CHAT_DOCK_BOTTOM_PX + CAD_EDGE_NUDGE_PX
            : CHAT_DOCK_BOTTOM_PX,
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          maxWidth: "calc(100vw - 32px)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 5,
          transition: "bottom 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
          // Chat dock opts into Syne — children inherit unless they
          // override (e.g. PropertiesCard's monospace number readouts).
          // The application default is Inter; Syne is reserved for the
          // chat conversation surfaces.
          fontFamily: "var(--font-syne), system-ui, sans-serif",
        }}
      >
        <ConversationBubble />
        <ReopenPill />
        <ThinkingLog />
        <InlinePreferenceProposals />
        <QuickSuggestions />
        <ProfileSuggestionBanner />
        <ProfileDisclosure />
        <ChatInputBox />
      </div>
      <EvaContextPanel />
      <PersonaPicker />
      <PreferenceSourceInspector />
      <PersonaToast />
    </>
  );
}
