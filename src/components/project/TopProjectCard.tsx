"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStore, selectCurrentProject } from "@studio/store";
import { useDraggable } from "@studio/hooks/useDraggable";
import { UserIcon, ChevronDownIcon } from "@studio/icons";
import { WORKFLOW_ROUTES } from "@/lib/site/workflow-routes";

/**
 * Top-LEFT project card.
 *
 * Brand row:
 *   • Furnishes + STUDIO — link home
 *   • / separator
 *   • project name — inline rename
 *   • caret — opens the All projects modal directly (no intermediate
 *     dropdown; switch / rename / create / delete live there)
 *
 * Workspace row: Personal · Interior Design
 */
export function TopProjectCard() {
  const setProjectsModalOpen = useStore((s) => s.setProjectsModalOpen);
  const setCurrentProjectName = useStore((s) => s.setCurrentProjectName);
  const currentProject = useStore(selectCurrentProject);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(currentProject.name);

  const projectInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraftName(currentProject.name);
  }, [currentProject.name, editing]);

  useEffect(() => {
    if (editing && projectInputRef.current) {
      projectInputRef.current.focus();
      projectInputRef.current.select();
    }
  }, [editing]);

  const commitName = () => {
    setCurrentProjectName(draftName);
    setEditing(false);
  };

  const openProjectsModal = () => {
    setEditing(false);
    setProjectsModalOpen(true);
  };

  const { onMouseDown, onPointerDownCapture, positionStyle, zIndex } = useDraggable("project");

  const ink = "#1A1A1A";
  const accent = "#FF5A1F";
  const uiFont = "var(--font-app), system-ui, sans-serif";

  return (
    <header
      className="glass"
      data-card-id="project"
      onMouseDown={onMouseDown}
      onPointerDownCapture={onPointerDownCapture}
      style={{
        position: "fixed",
        top: 14,
        left: 14,
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 14,
        padding: "8px 16px",
        gap: 10,
        zIndex: zIndex ?? 5,
        overflow: "visible",
        whiteSpace: "nowrap",
        cursor: "grab",
        ...positionStyle,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
          }}
        >
          <Link
            href={WORKFLOW_ROUTES.home}
            data-no-drag="true"
            aria-label="Furnishes home"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              textDecoration: "none",
              color: "inherit",
              cursor: "pointer",
              borderRadius: 8,
              margin: "-2px -4px",
              padding: "2px 4px",
            }}
          >
            <span style={{ fontWeight: 500, color: ink }}>Furnishes</span>
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: accent,
                padding: "2px 6px",
                borderRadius: 5,
                background: "rgba(255, 90, 31, 0.1)",
                border: "1px solid rgba(255, 90, 31, 0.25)",
              }}
            >
              Studio
            </span>
          </Link>

          <span style={{ color: "rgba(26,26,26,0.3)", fontWeight: 500 }}>
            /
          </span>

          <div
            data-no-drag="true"
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            {editing ? (
              <input
                ref={projectInputRef}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    e.currentTarget.blur();
                  }
                }}
                style={{
                  fontFamily: uiFont,
                  fontSize: 12,
                  fontWeight: 600,
                  color: ink,
                  background: "rgba(255,255,255,0.6)",
                  border: "1px solid rgba(255, 90, 31, 0.4)",
                  borderRadius: 5,
                  padding: "1px 5px",
                  outline: "none",
                  minWidth: 120,
                  maxWidth: 160,
                }}
              />
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
                className="project-name"
                title="Rename project"
                style={{
                  fontFamily: uiFont,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "rgba(26,26,26,0.75)",
                  background: "transparent",
                  border: "none",
                  padding: "1px 5px",
                  borderRadius: 5,
                  cursor: "text",
                  transition: "background 0.15s ease, color 0.15s ease",
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {currentProject.name}
              </button>
            )}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openProjectsModal();
              }}
              aria-label="All projects"
              title="All projects"
              className="project-caret"
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                border: "none",
                background: "transparent",
                color: "rgba(26,26,26,0.5)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              <ChevronDownIcon size={11} />
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 9.5,
            color: "rgba(26,26,26,0.55)",
            fontWeight: 500,
            marginTop: 3,
            whiteSpace: "nowrap",
          }}
        >
          <UserIcon size={9} />
          <span>Personal · Interior Design</span>
        </div>
      </div>
    </header>
  );
}
