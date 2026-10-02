"use client";

import { useEffect } from "react";
import type { AssetGeneration } from "@studio/store/generations-slice";

const ACCENT = "#FF5A1F";
const INK = "#1A1A1A";
const UI_FONT = "var(--font-app), system-ui, sans-serif";

interface DetailModalProps {
  asset: AssetGeneration;
  onClose: () => void;
  onApply: (asset: AssetGeneration) => void;
}

/**
 * v0.40.49 GenerationDetailModal — expanded view for a Generations
 * card tile. The user reported that tiles only showed a tiny
 * thumbnail and clicking just applied the scene; they wanted to
 * "see detailed information for what the furniture pieces are,
 * what's the room layout" before deciding to apply.
 *
 * What this surface shows:
 *   • Hero image at full width (when available)
 *   • Label + relative-time + kind badge
 *   • Style summary (name, mood, palette swatches)
 *   • Room dimensions (for room tiles)
 *   • Full piece list with per-piece thumbnail, name, dimensions
 *
 * Apply (load this scene) and Close are explicit buttons. Esc
 * closes without applying. Backdrop click closes without applying.
 *
 * Backdrop pattern matches CatalogModal + StarredModal v0.40.48 so
 * the studio's modal vocabulary is consistent.
 */
export function GenerationDetailModal({
  asset,
  onClose,
  onApply,
}: DetailModalProps) {
  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Pull style + room + pieces out of asset.scene for room tiles.
  // Same narrowing pattern GenerationsCard uses inline; here we
  // pull more fields for the detail view.
  // v0.40.50: corrected piece-dimensions key to match the actual
  // PlacedPiece schema — `dimensions: { length, width, height }`,
  // not `dimensions_m: { width, depth, height }`. Earlier draft
  // would have rendered every piece's dim text as null because
  // the read path was looking for fields that don't exist.
  const scene = asset.scene as
    | {
        style?: {
          name?: string;
          mood?: string;
          palette?: { name?: string; hex?: string }[];
        };
        room?: {
          width_m?: number;
          depth_m?: number;
          height_m?: number;
          shape?: string;
        };
        pieces?: Array<{
          id: string;
          description: string;
          image_url?: string;
          dimensions?: {
            length?: number;
            width?: number;
            height?: number;
          };
          category?: string;
        }>;
      }
    | undefined;

  const style = scene?.style;
  const room = scene?.room;
  const pieces = scene?.pieces ?? [];
  const isRoom = asset.kind === "room";

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Generation details"
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
        animation: "starred-modal-in 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-modal"
        style={{
          width: 640,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 96px)",
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── Hero image ───────────────────────────────────────── */}
        {asset.imageUrl && (
          <div
            style={{
              width: "100%",
              height: 220,
              background: "rgba(26, 26, 26, 0.06)",
              flexShrink: 0,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <img
              src={asset.imageUrl}
              alt={asset.label}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
            {/* Top-left kind badge */}
            <span
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                padding: "4px 10px",
                borderRadius: 999,
                background: "rgba(26, 26, 26, 0.7)",
                color: "#FFFFFF",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {isRoom ? "Room" : "Furniture"}
            </span>
          </div>
        )}

        {/* ── Header (title + close) ───────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 20px 8px 20px",
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: INK,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {asset.label}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "rgba(26, 26, 26, 0.5)",
                marginTop: 2,
              }}
            >
              {new Date(asset.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 18,
              color: "rgba(26, 26, 26, 0.6)",
            }}
          >
            ×
          </button>
        </div>

        {/* ── Body (scrollable) ───────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 20px 16px",
          }}
        >
          {/* Style summary */}
          {style && (
            <Section title="Style">
              {style.name && (
                <div style={{ fontSize: 13, color: INK, fontWeight: 500 }}>
                  {style.name}
                </div>
              )}
              {style.mood && (
                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(26, 26, 26, 0.65)",
                    marginTop: 4,
                    lineHeight: 1.45,
                  }}
                >
                  {style.mood}
                </div>
              )}
              {Array.isArray(style.palette) && style.palette.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginTop: 10,
                    flexWrap: "wrap",
                  }}
                >
                  {style.palette.slice(0, 8).map((p, i) => (
                    <div
                      key={i}
                      title={`${p.name ?? ""} ${p.hex ?? ""}`.trim()}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 8px 3px 4px",
                        borderRadius: 999,
                        background: "rgba(26, 26, 26, 0.04)",
                        fontSize: 11,
                        color: "rgba(26, 26, 26, 0.7)",
                      }}
                    >
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: p.hex || "#ccc",
                          border: "1px solid rgba(0,0,0,0.08)",
                        }}
                      />
                      {p.name ?? p.hex ?? "—"}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Room dims */}
          {isRoom && room && (
            <Section title="Room layout">
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                {room.width_m != null && room.depth_m != null && (
                  <Stat
                    label="Footprint"
                    value={`${room.width_m.toFixed(2)} × ${room.depth_m.toFixed(2)} m`}
                  />
                )}
                {room.width_m != null && room.depth_m != null && (
                  <Stat
                    label="Area"
                    value={`${(room.width_m * room.depth_m).toFixed(1)} m²`}
                  />
                )}
                {room.height_m != null && (
                  <Stat
                    label="Ceiling"
                    value={`${room.height_m.toFixed(2)} m`}
                  />
                )}
                {room.shape && <Stat label="Shape" value={room.shape} />}
              </div>
            </Section>
          )}

          {/* Piece list */}
          {pieces.length > 0 && (
            <Section
              title={`Furniture (${pieces.length} ${pieces.length === 1 ? "piece" : "pieces"})`}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 10,
                  marginTop: 4,
                }}
              >
                {pieces.map((p) => (
                  <PieceCard key={p.id} piece={p} />
                ))}
              </div>
            </Section>
          )}

          {/* Empty fallback for non-room or no-scene asset tiles */}
          {!style && !room && pieces.length === 0 && (
            <div
              style={{
                padding: "20px 0",
                color: "rgba(26, 26, 26, 0.5)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              No additional details available for this generation.
            </div>
          )}
        </div>

        {/* ── Footer (actions) ─────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "12px 20px 16px",
            borderTop: "1px solid rgba(26, 26, 26, 0.06)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid rgba(26, 26, 26, 0.12)",
              background: "transparent",
              color: INK,
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: UI_FONT,
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(asset);
              onClose();
            }}
            style={{
              flex: 2,
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              background: ACCENT,
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: UI_FONT,
            }}
          >
            {isRoom ? "Load this scene" : "Add to scene"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(26, 26, 26, 0.45)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "rgba(26, 26, 26, 0.4)",
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: INK, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function PieceCard({
  piece,
}: {
  piece: {
    id: string;
    description: string;
    image_url?: string;
    dimensions?: { length?: number; width?: number; height?: number };
    category?: string;
  };
}) {
  // v0.40.50: dimensions key matches the real PlacedPiece schema
  // (length × width × height in meters). Earlier draft used
  // `dimensions_m.width × depth × height` which doesn't exist.
  const dims = piece.dimensions;
  const dimText =
    dims && dims.length != null && dims.width != null && dims.height != null
      ? `${dims.length.toFixed(2)} × ${dims.width.toFixed(2)} × ${dims.height.toFixed(2)} m`
      : null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        borderRadius: 10,
        background: "rgba(26, 26, 26, 0.03)",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: 6,
          background: piece.image_url
            ? "rgba(26, 26, 26, 0.06)"
            : "linear-gradient(135deg, rgba(255, 90, 31, 0.08) 0%, rgba(255, 90, 31, 0.16) 100%)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {piece.image_url ? (
          <img
            src={piece.image_url}
            alt={piece.description}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          /* v0.40.49.1: chat-mode (skipPieceMeshes) generations don't
             produce per-piece image_urls because the orchestrator
             only attaches them after the fal.ai mesh-gen call lands.
             Without this fallback, every piece tile showed an
             identical gray box — useless visually. The new placeholder
             surfaces the category as a typographic chip plus a
             generic shape glyph, so the user sees WHAT the piece is
             at a glance even without a real render. */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              padding: 6,
            }}
          >
            <div
              style={{
                fontSize: 22,
                color: "rgba(255, 90, 31, 0.45)",
                lineHeight: 1,
              }}
              aria-hidden
            >
              {/* Crude shape token — squircle suggests "object" */}▢
            </div>
            {piece.category && (
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "rgba(140, 60, 30, 0.78)",
                  textAlign: "center",
                  lineHeight: 1.2,
                }}
              >
                {piece.category}
              </div>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: INK,
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {piece.description}
      </div>
      {dimText && (
        <div
          style={{
            fontSize: 9,
            color: "rgba(26, 26, 26, 0.5)",
            letterSpacing: "0.02em",
          }}
        >
          {dimText}
        </div>
      )}
    </div>
  );
}
