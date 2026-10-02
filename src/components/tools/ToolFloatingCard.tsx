"use client";

import { useStore } from "@studio/store";
import { ReferenceCard } from "./ReferenceCard";
import { InventoryCard } from "./InventoryCard";
import { CatalogCard } from "./CatalogCard";
import { ChatHistoryCard } from "./ChatHistoryCard";
import { GenerationsCard } from "./GenerationsCard";
import { StarredCard } from "./StarredCard";
import { RoomGridCard } from "./RoomGridCard";
import { ToolCardErrorBoundary } from "./ToolCardErrorBoundary";

/**
 * Dispatcher: mounts one floating card per tool currently in
 * `openTools` *that uses the floating-card pattern*. Each card is
 * wrapped in a ToolCardErrorBoundary so a crash in one card surfaces
 * a recoverable inline message instead of taking down the whole
 * studio.
 *
 * Catalog docks as a floating card to the right of Tools (square /
 * rectangle pieces only). Chat history and Starred still render as
 * centered modals but stay dispatched from here so `openTools`
 * membership still drives them.
 *
 * Health was removed in v0.40.4 along with the Planner workspace —
 * Health was a stub that never graduated to a real implementation.
 *
 * Multiple floating cards may be open simultaneously. Each owns a
 * stable `tool-<n>` id for its drag-position store. Centered modals
 * ignore drag placement.
 */
export function ToolFloatingCards() {
  const openTools = useStore((s) => s.openTools);

  return (
    <>
      {openTools.map((tool) => {
        switch (tool) {
          case "reference":
            return (
              <ToolCardErrorBoundary key={tool} cardName="Reference">
                <ReferenceCard />
              </ToolCardErrorBoundary>
            );
          case "inventory":
            return (
              <ToolCardErrorBoundary key={tool} cardName="Inventory">
                <InventoryCard />
              </ToolCardErrorBoundary>
            );
          case "generations":
            return (
              <ToolCardErrorBoundary key={tool} cardName="Generations">
                <GenerationsCard />
              </ToolCardErrorBoundary>
            );
          case "chat-history":
            return (
              <ToolCardErrorBoundary key={tool} cardName="Chat history">
                <ChatHistoryCard />
              </ToolCardErrorBoundary>
            );
          case "starred":
            return (
              <ToolCardErrorBoundary key={tool} cardName="Starred">
                <StarredCard />
              </ToolCardErrorBoundary>
            );
          case "room-grid":
            return (
              <ToolCardErrorBoundary key={tool} cardName="Room grid">
                <RoomGridCard />
              </ToolCardErrorBoundary>
            );
          case "catalog":
            return (
              <ToolCardErrorBoundary key={tool} cardName="Catalog">
                <CatalogCard />
              </ToolCardErrorBoundary>
            );
        }
        // Exhaustiveness check — TypeScript narrows `tool` to never
        // here; if a new tool is added we get a build error until
        // the switch covers it.
        const _exhaustive: never = tool;
        return _exhaustive;
      })}
    </>
  );
}
