"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@studio/store";
import type { Conversation } from "@studio/store/types";
import { MessageSquareIcon, PlusCircleIcon, CloseIcon } from "@studio/icons";

/**
 * Chat history — centered modal (same pattern as CatalogModal).
 * Lists every conversation in the current project: switch, rename,
 * delete, or start a new one. Opened from the Tools → Chat history
 * tile; Esc / backdrop click closes.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";
const MODAL_WIDTH = 520;
const MODAL_HEIGHT = 560;

export function ChatHistoryCard() {
  const allConversations = useStore(
    (s) =>
      (s as unknown as { conversations?: Conversation[] }).conversations ?? [],
  );
  const currentProjectId = useStore(
    (s) =>
      (s as unknown as { currentProjectId?: string }).currentProjectId ?? null,
  );
  const activeConversationId = useStore((s) => s.activeConversationId);
  const openTools = useStore((s) => s.openTools);
  const closeTool = useStore((s) => s.closeTool);
  const isOpen = openTools.includes("chat-history");

  const conversations = useMemo(() => {
    if (!currentProjectId) return [] as Conversation[];
    return allConversations
      .filter((c): c is Conversation => !!c && c.projectId === currentProjectId)
      .map((c) =>
        Array.isArray(c.turns) ? c : { ...c, turns: [] },
      )
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = () => closeTool("chat-history");

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (!isOpen) {
      setEditingId(null);
      setEditingDraft("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  const startRename = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditingDraft(currentTitle);
  };

  const commitRename = () => {
    if (!editingId) return;
    const trimmed = editingDraft.trim();
    if (trimmed) renameConversation(editingId, trimmed);
    setEditingId(null);
    setEditingDraft("");
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Chat history"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(26, 18, 10, 0.32)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        fontFamily: UI_FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal"
        style={{
          width: MODAL_WIDTH,
          maxWidth: "calc(100vw - 32px)",
          height: MODAL_HEIGHT,
          maxHeight: "calc(100vh - 64px)",
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "16px 20px 12px 20px",
            flexShrink: 0,
            color: INK,
          }}
        >
          <MessageSquareIcon size={15} />
          <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>
            Chat history
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "rgba(26, 26, 26, 0.5)",
            }}
          >
            {conversations.length} convo
            {conversations.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* + New conversation */}
        <div style={{ padding: "0 12px 8px", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => createConversation()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "none",
              background: "rgba(255, 90, 31, 0.08)",
              color: ACCENT,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: UI_FONT,
              cursor: "pointer",
              textAlign: "left",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "rgba(255, 90, 31, 0.14)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.background =
                "rgba(255, 90, 31, 0.08)")
            }
          >
            <PlusCircleIcon size={14} />
            New conversation
          </button>
        </div>

        <div
          style={{
            height: 1,
            background: "rgba(124, 80, 50, 0.12)",
            margin: "0 16px 8px",
            flexShrink: 0,
          }}
        />

        {/* Conversation list */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "0 12px 16px",
          }}
        >
          {conversations.length === 0 ? (
            <div
              style={{
                fontSize: 12,
                color: "rgba(26, 26, 26, 0.5)",
                padding: "24px 12px",
                textAlign: "center",
              }}
            >
              No conversations yet — start a new one above.
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = active?.id === c.id;
              const isEditing = c.id === editingId;
              const turnCount = c.turns.length;
              return (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: isActive
                      ? "rgba(255, 90, 31, 0.1)"
                      : "transparent",
                    border: isActive
                      ? "1px solid rgba(255, 90, 31, 0.2)"
                      : "1px solid transparent",
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLDivElement).style.background =
                        "rgba(26, 26, 26, 0.04)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLDivElement).style.background =
                        "transparent";
                    }
                  }}
                >
                  {isEditing ? (
                    <input
                      ref={inputRef}
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
                        borderRadius: 6,
                        padding: "5px 8px",
                        fontSize: 13,
                        fontWeight: 600,
                        background: "rgba(255, 255, 255, 0.95)",
                        color: INK,
                        outline: "none",
                        fontFamily: UI_FONT,
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => selectConversation(c.id)}
                      onDoubleClick={() => startRename(c.id, c.title)}
                      title="Click to switch · double-click to rename"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 2,
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: UI_FONT,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: isActive ? ACCENT : INK,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "100%",
                        }}
                      >
                        {c.title}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
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
                        width: 26,
                        height: 26,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "none",
                        borderRadius: 999,
                        background: "transparent",
                        color: "rgba(26, 26, 26, 0.4)",
                        cursor: "pointer",
                        flexShrink: 0,
                        transition: "background 0.15s ease, color 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "rgba(204, 34, 34, 0.1)";
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "#cc2222";
                      }}
                      onMouseLeave={(e) => {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "transparent";
                        (e.currentTarget as HTMLButtonElement).style.color =
                          "rgba(26, 26, 26, 0.4)";
                      }}
                    >
                      <CloseIcon size={12} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
