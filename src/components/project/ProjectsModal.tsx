"use client";

import { useState, useEffect, useRef } from "react";
import { useStore } from "@studio/store";
import {
  CloseIcon,
  PlusIcon,
  TrashIcon,
  EditIcon,
  CheckIcon,
} from "@studio/icons";

/**
 * Projects modal — centered CRUD surface for all projects in this
 * browser. Opened from TopProjectCard's "See all projects" row.
 *
 * Mirrors the visual scaffold of CatalogModal: full-page backdrop,
 * centered card with title + close button, scrollable list body.
 *
 * Per-row affordances:
 *   - Click anywhere on the row (or the row's name) → switch to it,
 *     close the modal, hydrate via persistence.
 *   - Edit pencil → inline rename in place. Enter to save, Esc to
 *     cancel. Empty/whitespace name falls back to "Untitled Space".
 *   - Trash → confirm then delete. Last-project guard prevents
 *     deleting the only project. Deleting current re-points to
 *     the first remaining.
 *
 * Footer:
 *   - "+ New project" button creates a fresh project, switches to
 *     it, and closes the modal so the user lands in their new
 *     workspace immediately.
 */

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";
const MODAL_WIDTH = 640;
const MODAL_HEIGHT = 540;

export function ProjectsModal() {
  const isOpen = useStore((s) => s.projectsModalOpen);
  const setOpen = useStore((s) => s.setProjectsModalOpen);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const setCurrentProject = useStore((s) => s.setCurrentProject);
  const addProject = useStore((s) => s.addProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Esc closes modal (or cancels rename)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingId) {
          setEditingId(null);
          setDraft("");
        } else {
          setOpen(false);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, editingId, setOpen]);

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Reset edit state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setEditingId(null);
      setDraft("");
    }
  }, [isOpen]);

  // Auto-focus the rename input when entering edit mode
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  if (!isOpen) return null;

  const beginRename = (id: string, currentName: string) => {
    setEditingId(id);
    setDraft(currentName);
  };

  const commitRename = () => {
    if (!editingId) return;
    const finalName = draft.trim() || "Untitled Space";
    // Use the slice's setCurrentProjectName, but we need to rename
    // any project (not just the current). Switch + rename + switch
    // back is awkward; instead, drive the projects array directly
    // through the store's setState to keep this simple.
    const s = useStore.getState();
    useStore.setState({
      projects: s.projects.map((p) =>
        p.id === editingId ? { ...p, name: finalName } : p,
      ),
    } as never);
    setEditingId(null);
    setDraft("");
  };

  const switchTo = (id: string) => {
    if (id !== currentProjectId) setCurrentProject(id);
    setOpen(false);
  };

  const onDelete = (id: string, name: string) => {
    if (projects.length <= 1) return;
    if (
      confirm(
        `Delete "${name}"? This removes the project and its saved layout from this browser. This cannot be undone.`,
      )
    ) {
      deleteProject(id);
    }
  };

  const onCreate = () => {
    addProject();
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Projects"
      onClick={() => setOpen(false)}
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
        {/* Title row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            padding: "16px 20px 12px 20px",
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: INK,
              }}
            >
              All projects
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(26, 26, 26, 0.55)",
                marginTop: 2,
              }}
            >
              {projects.length} project{projects.length === 1 ? "" : "s"} in
              this browser. Click a project to switch.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: "none",
              background: "rgba(26, 26, 26, 0.06)",
              color: "rgba(26, 26, 26, 0.65)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CloseIcon size={12} />
          </button>
        </div>

        {/* Project list */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "4px 16px 4px 16px",
          }}
        >
          {projects.map((p) => {
            const isCurrent = p.id === currentProjectId;
            const isEditing = editingId === p.id;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  marginBottom: 4,
                  background: isCurrent
                    ? "rgba(255, 90, 31, 0.06)"
                    : "transparent",
                  border: isCurrent
                    ? "1px solid rgba(255, 90, 31, 0.2)"
                    : "1px solid rgba(26, 26, 26, 0.06)",
                  transition: "background 0.15s ease",
                }}
              >
                {/* Status dot */}
                {isCurrent && (
                  <span
                    aria-label="Current project"
                    title="Current project"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: ACCENT,
                      flexShrink: 0,
                    }}
                  />
                )}

                {/* Name (editable or display) */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") {
                          setEditingId(null);
                          setDraft("");
                        }
                      }}
                      style={{
                        width: "100%",
                        padding: "4px 8px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: INK,
                        fontFamily: UI_FONT,
                        background: "white",
                        border: `1px solid ${ACCENT}`,
                        borderRadius: 6,
                        outline: "none",
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => switchTo(p.id)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        textAlign: "left",
                        cursor: "pointer",
                        fontFamily: UI_FONT,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: INK,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {p.name}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "rgba(26, 26, 26, 0.5)",
                          marginTop: 1,
                          fontWeight: 500,
                        }}
                      >
                        {p.updated}
                        {isCurrent && " · current"}
                      </div>
                    </button>
                  )}
                </div>

                {/* Actions */}
                {!isEditing && (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => beginRename(p.id, p.name)}
                      aria-label={`Rename "${p.name}"`}
                      title="Rename"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        border: "none",
                        background: "rgba(26, 26, 26, 0.05)",
                        color: "rgba(26, 26, 26, 0.6)",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <EditIcon size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(p.id, p.name)}
                      disabled={projects.length <= 1}
                      aria-label={`Delete "${p.name}"`}
                      title={
                        projects.length <= 1
                          ? "Can't delete the only project"
                          : "Delete project"
                      }
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        border: "none",
                        background:
                          projects.length <= 1
                            ? "rgba(26, 26, 26, 0.03)"
                            : "rgba(220, 38, 38, 0.08)",
                        color:
                          projects.length <= 1
                            ? "rgba(26, 26, 26, 0.25)"
                            : "#dc2626",
                        cursor:
                          projects.length <= 1 ? "not-allowed" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                )}
                {isEditing && (
                  <button
                    type="button"
                    onClick={commitRename}
                    aria-label="Save name"
                    title="Save"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      border: "none",
                      background: ACCENT,
                      color: "white",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <CheckIcon size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer — Create new project */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid rgba(26, 26, 26, 0.08)",
            background: "rgba(255, 248, 241, 0.6)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCreate}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: "none",
              background: ACCENT,
              color: "white",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: UI_FONT,
            }}
          >
            <PlusIcon size={11} />
            <span>New project</span>
          </button>
        </div>
      </div>
    </div>
  );
}
