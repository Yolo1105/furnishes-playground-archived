"use client";

/**
 * ConversationSwitcher — small title chip rendered above the chat
 * dock. Shows the active conversation's title (or "Conversation N",
 * the default). Clicking opens a dropdown listing every conversation
 * for the current project, plus a "+ New conversation" action and
 * per-row rename / delete affordances.
 *
 * Layout: positioned by the parent ChatDock as a flex-aligned
 * inline-block sitting just above the ConversationBubble. The
 * dropdown panel pops upward (since the dock is bottom-anchored)
 * and aligns left.
 *
 * Visual: tight chip — Inter (per the typography guide for non-chat
 * tool surfaces that label chat surfaces; the title text itself
 * stays Syne to match the conversation it labels). Active title in
 * the chip is Syne for continuity with the bubble below it.
 *
 * Self-gates: hidden in immersive mode. Always renders even with a
 * single conversation (so the user has the "+ New" affordance).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@studio/store";
import type { Conversation } from "@studio/store/types";
import { ChevronDownIcon, CloseIcon, PlusCircleIcon } from "@studio/icons";

export function ConversationSwitcher() {
  // Subscribe to PRIMITIVES + RAW arrays only. A selector that filters
  // + sorts inside the store subscription returns a fresh array each
  // render, which trips React 18's "getSnapshot should be cached"
  // error in Zustand v4. Read raw fields here, derive sorted list with
  // useMemo so the array reference stays stable across renders.
  const allConversations = useStore(
    (s) =>
      (s as unknown as { conversations?: Conversation[] }).conversations ?? [],
  );
  const currentProjectId = useStore(
    (s) =>
      (s as unknown as { currentProjectId?: string }).currentProjectId ?? null,
  );
  const activeConversationId = useStore((s) => s.activeConversationId);

  const conversations = useMemo(() => {
    if (!currentProjectId) return [] as Conversation[];
    return allConversations
      .filter((c): c is Conversation => !!c && c.projectId === currentProjectId)
      .map((c) => (Array.isArray(c.turns) ? c : { ...c, turns: [] }))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [allConversations, currentProjectId]);

  const active = useMemo(
    () =>
      activeConversationId
        ? (conversations.find((c) => c.id === activeConversationId) ?? null)
        : null,
    [conversations, activeConversationId],
  );

  const createConversation = useStore((s) => s.createConversation);
  const selectConversation = useStore((s) => s.selectConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const immersive = useStore((s) => s.immersive);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-away closes the dropdown — without this it would persist
  // on top of the canvas and feel sticky.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (immersive) return null;
  // Nothing to render before the seed conversation lands. Defensive
  // — the slice's init seeds one, but during rare hydrate races the
  // active can be null briefly.
  if (!active) return null;

  const handleNew = () => {
    createConversation();
    setOpen(false);
  };

  const startRename = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditingDraft(currentTitle);
  };

  const commitRename = () => {
    if (!editingId) return;
    const trimmed = editingDraft.trim();
    if (trimmed) {
      renameConversation(editingId, trimmed);
    }
    setEditingId(null);
    setEditingDraft("");
  };

  return (
    <div
      ref={rootRef}
      style={{
        position: "relative",
        alignSelf: "flex-start",
        // Nudges the chip slightly inset from the bubble's left edge
        // so it reads as "label for the bubble below" rather than
        // a standalone control.
        marginLeft: 4,
        marginBottom: 2,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${active.title} — ${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 10px 5px 12px",
          borderRadius: 999,
          border: "1px solid rgba(124, 80, 50, 0.18)",
          background: "rgba(255, 250, 244, 0.78)",
          backdropFilter: "blur(6px)",
          color: "#1a1a1a",
          fontFamily: "var(--font-syne), system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          maxWidth: 280,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 220,
          }}
        >
          {active.title}
        </span>
        <span style={{ color: "rgba(26,26,26,0.45)", fontWeight: 500 }}>
          {conversations.length > 1 ? `· ${conversations.length}` : ""}
        </span>
        <ChevronDownIcon size={11} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            // Pop UPWARD because the dock is anchored at the bottom
            // of the viewport. `bottom: calc(100% + 6px)` puts the
            // panel directly above the chip with a small gap.
            bottom: "calc(100% + 6px)",
            left: 0,
            minWidth: 280,
            maxWidth: 360,
            maxHeight: 360,
            overflow: "auto",
            padding: 6,
            background: "rgba(255, 251, 246, 0.96)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(26, 26, 26, 0.08)",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(26, 26, 26, 0.12)",
            zIndex: 6,
            fontFamily: "var(--font-app), system-ui, sans-serif",
          }}
        >
          <button
            type="button"
            onClick={handleNew}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: "#FF5A1F",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "rgba(255, 90, 31, 0.08)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "transparent")
            }
          >
            <PlusCircleIcon size={13} />
            New conversation
          </button>

          <div
            style={{
              height: 1,
              background: "rgba(26, 26, 26, 0.06)",
              margin: "4px 6px",
            }}
          />

          {conversations.map((c) => {
            const isActive = c.id === active.id;
            const isEditing = c.id === editingId;
            const turnCount = c.turns.length;
            return (
              <div
                key={c.id}
                role="menuitem"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: isActive
                    ? "rgba(255, 90, 31, 0.1)"
                    : "transparent",
                  border: isActive
                    ? "1px solid rgba(255, 90, 31, 0.2)"
                    : "1px solid transparent",
                }}
              >
                {isEditing ? (
                  <input
                    autoFocus
                    type="text"
                    value={editingDraft}
                    onChange={(e) => setEditingDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") {
                        setEditingId(null);
                        setEditingDraft("");
                      }
                    }}
                    onBlur={commitRename}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "1px solid rgba(255, 90, 31, 0.4)",
                      borderRadius: 5,
                      padding: "3px 7px",
                      fontSize: 12,
                      fontWeight: 600,
                      background: "rgba(255, 255, 255, 0.85)",
                      color: "#1a1a1a",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      selectConversation(c.id);
                      setOpen(false);
                    }}
                    onDoubleClick={() => startRename(c.id, c.title)}
                    title="Click to switch · double-click to rename"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 1,
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: isActive ? "#FF5A1F" : "#1a1a1a",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 240,
                      }}
                    >
                      {c.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "rgba(26, 26, 26, 0.5)",
                        fontWeight: 500,
                      }}
                    >
                      {turnCount} message{turnCount === 1 ? "" : "s"}
                    </span>
                  </button>
                )}

                {!isEditing && conversations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        typeof window !== "undefined" &&
                        window.confirm(
                          `Delete "${c.title}"? This can't be undone.`,
                        )
                      ) {
                        deleteConversation(c.id);
                      }
                    }}
                    title="Delete conversation"
                    aria-label={`Delete ${c.title}`}
                    style={{
                      width: 22,
                      height: 22,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      borderRadius: 999,
                      background: "transparent",
                      color: "rgba(26, 26, 26, 0.4)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "rgba(204, 34, 34, 0.1)";
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "#cc2222";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "transparent";
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "rgba(26, 26, 26, 0.4)";
                    }}
                  >
                    <CloseIcon size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
