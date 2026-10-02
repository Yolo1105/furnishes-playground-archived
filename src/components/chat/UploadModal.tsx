"use client";

import { useRef, useState } from "react";
import { useStore } from "@studio/store";
import type { ReferenceImage } from "@studio/store/types";
import { CloseIcon, ImageIcon, UploadCloudIcon } from "@studio/icons";

/**
 * Centered upload modal triggered by the image button in the input
 * toolbar. Accepts files via picker or drag-and-drop, filters to
 * `image/*`, reads each as a data URL, and pushes the new images onto
 * the chat slice's reference-images array. Closes on success, on
 * outside click, on the × button, or via Esc (handled at the
 * keyboard-shortcuts layer).
 */
export function UploadModal() {
  const open = useStore((s) => s.uploadModalOpen);
  const setOpen = useStore((s) => s.setUploadModalOpen);
  const addImages = useStore((s) => s.addReferenceImages);

  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return;

    const readers = files.map(
      (file) =>
        new Promise<ReferenceImage>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve({
              id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              url: String(e.target?.result ?? ""),
              name: file.name,
            });
          };
          reader.readAsDataURL(file);
        }),
    );

    Promise.all(readers).then((images) => {
      addImages(images);
      setOpen(false);
    });
  };

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(26, 18, 10, 0.32)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal"
        style={{
          width: 440,
          maxWidth: "calc(100vw - 32px)",
          borderRadius: 18,
          padding: 22,
          fontFamily: "var(--font-syne), sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <ImageIcon size={15} style={{ color: "rgba(26, 26, 26, 0.7)" }} />
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#1A1A1A",
                letterSpacing: "-0.01em",
              }}
            >
              Reference
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "none",
              background: "transparent",
              color: "rgba(26, 26, 26, 0.55)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CloseIcon size={13} />
          </button>
        </div>

        {/* Dropzone */}
        <div
          className="ref-dropzone"
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: "1.5px dashed rgba(124, 80, 50, 0.28)",
            borderRadius: 14,
            padding: "32px 20px",
            background: "rgba(255, 255, 255, 0.5)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            cursor: "pointer",
            textAlign: "center",
            transition: "background 0.15s ease, border-color 0.15s ease",
          }}
        >
          <UploadCloudIcon
            size={28}
            style={{ color: "rgba(26, 26, 26, 0.55)" }}
          />
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#1A1A1A",
              letterSpacing: "-0.005em",
            }}
          >
            Drop images here, or click to browse
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(26, 26, 26, 0.5)",
              letterSpacing: "-0.005em",
            }}
          >
            Multiple images supported · JPG, PNG, WebP, GIF
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            style={{ display: "none" }}
          />
        </div>

        {/* Subtle dismiss hint */}
        <div
          style={{
            marginTop: 14,
            textAlign: "center",
            fontSize: 10.5,
            color: "rgba(26, 26, 26, 0.4)",
            letterSpacing: "-0.005em",
          }}
        >
          Press <kbd style={kbdStyle}>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 5px",
  fontFamily: "ui-monospace, 'SF Mono', monospace",
  fontSize: 9.5,
  fontWeight: 700,
  color: "#1A1A1A",
  background: "rgba(255, 255, 255, 0.7)",
  border: "1px solid rgba(124, 80, 50, 0.2)",
  borderRadius: 4,
  letterSpacing: "0.02em",
  margin: "0 2px",
};
