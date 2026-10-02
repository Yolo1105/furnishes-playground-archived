"use client";

import { useStore } from "@studio/store";
import { CloseIcon, PlusIcon } from "@studio/icons";

/**
 * Horizontal strip of attached reference-image thumbnails inside the
 * input box. Each thumbnail has a hover-revealed × to remove it; an
 * "add more" tile at the end opens the upload modal.
 *
 * Renders nothing when there are no images attached.
 */
export function ReferenceThumbnails() {
  const images = useStore((s) => s.referenceImages);
  const removeImage = useStore((s) => s.removeReferenceImage);
  const setUploadModalOpen = useStore((s) => s.setUploadModalOpen);

  if (images.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        paddingBottom: 10,
        marginBottom: 6,
        borderBottom: "1px solid rgba(124, 80, 50, 0.12)",
      }}
    >
      {images.map((img) => (
        <div
          key={img.id}
          className="ref-thumb"
          style={{
            position: "relative",
            width: 56,
            height: 56,
            borderRadius: 8,
            overflow: "hidden",
            background: "rgba(255,255,255,0.6)",
            border: "1px solid rgba(124, 80, 50, 0.18)",
          }}
        >
          {}
          <img
            src={img.url}
            alt={img.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
          <button
            type="button"
            className="ref-thumb-remove"
            onClick={() => removeImage(img.id)}
            aria-label={`Remove ${img.name}`}
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: "none",
              background: "rgba(26, 26, 26, 0.78)",
              color: "#FFF4EC",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              opacity: 0,
              transition: "opacity 0.15s ease",
            }}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ref-thumb-add"
        onClick={() => setUploadModalOpen(true)}
        aria-label="Add more reference images"
        style={{
          width: 56,
          height: 56,
          borderRadius: 8,
          border: "1px dashed rgba(124, 80, 50, 0.3)",
          background: "transparent",
          color: "rgba(26, 26, 26, 0.5)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition:
            "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
        }}
      >
        <PlusIcon size={14} />
      </button>
    </div>
  );
}
