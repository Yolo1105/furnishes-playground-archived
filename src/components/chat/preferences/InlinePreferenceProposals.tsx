"use client";

import { useMemo } from "react";
import { useStore } from "@studio/store";
import { selectPendingPreferences } from "@studio/store/preferences-slice";
import { confidenceToLabel } from "./preference-types";
import {
  PreferenceProposalCard,
  PreferenceProposalSummary,
} from "./PreferenceProposalCard";

/**
 * Shows preference proposals tied to the latest turn — highest
 * confidence inline, remainder summarized with Review → Eva panel.
 */
export function InlinePreferenceProposals() {
  const projectId = useStore((s) => s.currentProjectId);
  const preferences = useStore((s) => s.preferences);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const isThinking = useStore((s) => s.isThinking);
  const isGenerating = useStore((s) => s.isGenerating);
  const setEvaPanelOpen = useStore((s) => s.setEvaPanelOpen);

  const latestTurnId = useMemo(() => {
    const convo = conversations.find((c) => c.id === activeId);
    if (!convo || convo.turns.length === 0) return null;
    return convo.turns[convo.turns.length - 1]!.id;
  }, [conversations, activeId]);

  const pendingForTurn = useMemo(() => {
    if (!projectId || latestTurnId == null) return [];
    return selectPendingPreferences({ preferences } as never, projectId)
      .filter((p) => p.sourceTurnId === latestTurnId)
      .sort((a, b) => b.confidence - a.confidence);
  }, [preferences, projectId, latestTurnId]);

  if (isThinking || isGenerating || pendingForTurn.length === 0) return null;

  // High confidence → full inline; medium too; low stays panel-only.
  const prominent = pendingForTurn.filter(
    (p) => confidenceToLabel(p.confidence) !== "low",
  );
  const lowOnly = pendingForTurn.filter(
    (p) => confidenceToLabel(p.confidence) === "low",
  );

  const primary = prominent[0] ?? null;
  const extras = prominent.slice(1);
  const summaryCount = extras.length + lowOnly.length;

  if (!primary && summaryCount === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "0 4px",
      }}
    >
      {primary ? <PreferenceProposalCard preference={primary} /> : null}
      {summaryCount > 0 ? (
        <PreferenceProposalSummary
          count={summaryCount}
          onReview={() => setEvaPanelOpen(true)}
        />
      ) : null}
    </div>
  );
}
