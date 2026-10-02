"use client";

import { useEffect, useRef } from "react";
import { useStore } from "@studio/store";
import {
  type SgHdbFlatType,
  type SgHdbRoom,
  roomDisplayName,
  getRoomDimensions,
  getFlatTypeTotalArea,
} from "@studio/profiles/sg-hdb";
import { ChevronDownIcon } from "@studio/icons";

/**
 * ProfilePill — chat-input-row pill that selects an architectural
 * profile to constrain generation. Currently exposes Singapore HDB
 * (3-room / 4-room / 5-room × master bedroom / common bedroom /
 * living-dining / kitchen). When a profile is active, every Room
 * Layout and Interior Design generation runs against those exact
 * dimensions and conventions.
 *
 * UX shape (v0.40.39 refinement):
 *   - The pill's label is always the word "Profile" — it does NOT
 *     duplicate what the disclosure banner shows. Reasons:
 *     (a) keeps the input row uncluttered when ModeDropdown is at
 *     its full width, (b) avoids the "two pieces of UI showing the
 *     same thing" smell.
 *   - Active state is signalled by a subtle filled background +
 *     accent color. The disclosure banner above the input does the
 *     loud "you have a profile active" work.
 *   - Clearing the profile happens via a "No profile" row inside
 *     the popover, NOT a tiny × on the pill. Eliminates the mis-tap
 *     hazard and keeps the pill simple.
 *   - The disclosure banner's "Change" button sets `isPickerOpen`
 *     directly via the ProfileSlice, opening this popover. Earlier
 *     versions used a DOM custom-event bus for this; v0.40.39 moves
 *     the open state into the slice so cross-component coordination
 *     happens through typed state, not stringly-typed events.
 *
 * Visual idiom matches ModeDropdown — same padding, typography,
 * popover backdrop + radius. Sits to the right of ModeDropdown.
 */

const ACCENT = "#FF5A1F";

/** The room list shown in the picker depends on the flat type:
 *  - 3-room HDBs have ONE common bedroom (= common_bedroom_1).
 *  - 4-room and 5-room have TWO (common_bedroom_1 and _2).
 *  Hiding common_bedroom_2 for 3-room avoids the user picking an
 *  invalid combination (which the profile module's data lookup
 *  would silently fall through with empty guidance). */
function roomsForFlatType(flatType: SgHdbFlatType): SgHdbRoom[] {
  const base: SgHdbRoom[] = ["master_bedroom", "common_bedroom_1"];
  if (flatType !== "3-room") {
    base.push("common_bedroom_2");
  }
  base.push("living_dining", "kitchen");
  return base;
}

export function ProfilePill() {
  const profile = useStore((s) => s.currentProfile);
  const setProfile = useStore((s) => s.setProfile);
  const setSgHdbFlatType = useStore((s) => s.setSgHdbFlatType);
  const setSgHdbRoom = useStore((s) => s.setSgHdbRoom);
  const open = useStore((s) => s.isPickerOpen);
  const setOpen = useStore((s) => s.setPickerOpen);
  const mode = useStore((s) => s.mode);

  const wrapperRef = useRef<HTMLDivElement>(null);

  // The architectural profile only meaningfully constrains
  // generation in modes that produce rooms — Room Layout (full
  // layout) and Interior Design (full room with style). In Ask
  // mode the user is having a conversation; in Furniture mode
  // they're generating single pieces, not rooms. In both, the
  // profile would be irrelevant context. Hide the pill entirely in
  // those modes — the saved profile stays in state, it's just not
  // surfaced. When the user switches back to a generative mode,
  // the pill reappears with the same selection. Same logic in
  // ProfileDisclosure.
  const profileAppliesInThisMode =
    mode === "Room Layout" || mode === "Interior Design";

  // Close on outside click — same pattern as ModeDropdown. We
  // attach the listener only when open so we don't pay the cost
  // (and don't risk stale-closure issues) when closed.
  // Also exempts the disclosure banner's "Change" button (marked
  // with data-profile-picker-trigger) so users who click Change
  // while the picker is already open don't see a close-then-open
  // flicker.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (wrapperRef.current && target && wrapperRef.current.contains(target)) {
        return; // click landed inside the picker — keep it open
      }
      // Walk up from the target to see if any ancestor is the
      // disclosure's Change button. If so, treat this as "still
      // part of the profile UI" and don't close — the Change
      // button's own onClick will handle the (re)open.
      let el = target as HTMLElement | null;
      while (el) {
        if (
          el instanceof HTMLElement &&
          el.dataset?.profilePickerTrigger === "true"
        ) {
          return;
        }
        el = el.parentElement;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, setOpen]);

  // Close on Escape — common keyboard expectation for popovers.
  // Without this users have to either click outside or click the
  // pill again to dismiss, which is awkward when they've already
  // moved their hands to the keyboard.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!profileAppliesInThisMode) return null;

  const isActive = profile !== null;

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        type="button"
        aria-expanded={open}
        aria-label={
          isActive
            ? "Housing profile (active) — click to change"
            : "Housing profile (none) — click to set"
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderRadius: 8,
          border: "none",
          background: isActive ? "rgba(255, 90, 31, 0.08)" : "transparent",
          fontFamily: "var(--font-syne), sans-serif",
          fontSize: 12,
          fontWeight: 600,
          color: isActive ? ACCENT : "rgba(26, 26, 26, 0.55)",
          cursor: "pointer",
          transition: "background 0.15s ease, color 0.15s ease",
          letterSpacing: "-0.005em",
          whiteSpace: "nowrap",
        }}
      >
        <span>Profile</span>
        <span
          style={{
            color: isActive
              ? "rgba(255, 90, 31, 0.55)"
              : "rgba(26, 26, 26, 0.4)",
            display: "flex",
          }}
        >
          <ChevronDownIcon rotated={open} />
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Housing profile picker"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            background: "rgba(255, 255, 255, 0.7)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(124, 80, 50, 0.18)",
            borderRadius: 14,
            boxShadow: "0 16px 48px -8px rgba(0, 0, 0, 0.15)",
            padding: 12,
            minWidth: 320,
            zIndex: 10,
            fontFamily: "var(--font-syne), sans-serif",
            color: "#1A1A1A",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(26, 26, 26, 0.45)",
              marginBottom: 8,
            }}
          >
            Housing Profile
          </div>

          <p
            style={{
              fontSize: 11,
              lineHeight: 1.5,
              color: "rgba(26, 26, 26, 0.7)",
              margin: "0 0 12px",
            }}
          >
            Pin the exact room dimensions and architectural conventions for a
            specific housing market. Every generation will use these instead of
            inventing dimensions from your prompt.
          </p>

          {/* Free-form vs SG HDB radio */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <ProfileRadioRow
              label="Free-form"
              desc="No specific market — Claude picks dimensions from your prompt. Best when designing for a market we don't yet support, or for non-residential spaces."
              selected={profile === null}
              onClick={() => setProfile(null)}
            />
            <ProfileRadioRow
              label="Singapore HDB"
              desc="Post-2000 HDB build standard. Selecting this starts with a 4-room master bedroom (3.5 × 3.0 m, 12 m²) — adjust the flat type and room below."
              selected={profile?.kind === "sg-hdb"}
              onClick={() => {
                // Default to a sensible 4-room master if turning on
                // for the first time — 4-room is 42% of HDB stock
                // and master is the most-designed room. Users adjust
                // from there via the segmented controls below.
                if (profile?.kind !== "sg-hdb") {
                  setProfile({
                    kind: "sg-hdb",
                    flatType: "4-room",
                    room: "master_bedroom",
                  });
                }
              }}
            />
          </div>

          {/* Sub-options when SG HDB is active */}
          {profile?.kind === "sg-hdb" && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: "1px solid rgba(26, 26, 26, 0.08)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <SubField label="Flat type">
                <SegmentedControl<SgHdbFlatType>
                  options={FLAT_TYPES}
                  value={profile.flatType}
                  onChange={setSgHdbFlatType}
                  renderSubtitle={(ft) => `~${getFlatTypeTotalArea(ft)} m²`}
                />
              </SubField>
              <SubField label="Designing">
                <SegmentedControl<SgHdbRoom>
                  options={roomsForFlatType(profile.flatType)}
                  value={profile.room}
                  onChange={setSgHdbRoom}
                  renderLabel={(r) => {
                    // Compact labels for the segmented buttons so the
                    // row doesn't overflow the 320px popover width.
                    // Full names appear in the disclosure banner and
                    // dimension preview text below — these short codes
                    // are display-only inside this segmented control.
                    switch (r) {
                      case "master_bedroom":
                        return "Master";
                      case "common_bedroom_1":
                        return "Common 1";
                      case "common_bedroom_2":
                        return "Common 2";
                      case "living_dining":
                        return "L/D";
                      case "kitchen":
                        return "Kitchen";
                    }
                  }}
                />
              </SubField>

              {/* Live dimension preview so the user knows what
                  Claude will design against. */}
              {(() => {
                const dims = getRoomDimensions(profile.flatType, profile.room);
                if (!dims) return null;
                return (
                  <div
                    style={{
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: "rgba(26, 26, 26, 0.6)",
                      background: "rgba(255, 90, 31, 0.08)",
                      padding: "8px 10px",
                      borderRadius: 8,
                    }}
                  >
                    Designing{" "}
                    <strong style={{ color: ACCENT }}>
                      {roomDisplayName(profile.room)}
                    </strong>
                    , a{" "}
                    <strong style={{ color: ACCENT }}>
                      {dims.width_m.toFixed(1)} × {dims.depth_m.toFixed(1)} m
                    </strong>{" "}
                    space ({dims.area_sqm.toFixed(0)} m², 2.7 m ceiling)
                  </div>
                );
              })()}

              {/* Post-2000 build standard disclosure. HDB blocks built
                  before 2000 are typically 20–30% larger than the
                  values surfaced here. Users with older blocks should
                  treat the dimensions as a lower bound and the
                  layout patterns as roughly correct. */}
              <div
                style={{
                  fontSize: 10,
                  lineHeight: 1.5,
                  color: "rgba(26, 26, 26, 0.45)",
                  fontStyle: "italic",
                }}
              >
                Dimensions follow the post-2000 HDB build standard. Older blocks
                (pre-2000) are typically 20–30 % larger.
              </div>
            </div>
          )}

          {/* Done button — gives users an explicit "I'm finished
              picking" affordance. The popover already closes on
              click-outside, but providing a tappable close target
              inside the popover removes the discovery friction
              (especially important on mobile where click-outside
              feels like dismissing accidentally). */}
          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: "1px solid rgba(26, 26, 26, 0.06)",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "none",
                background: ACCENT,
                color: "#FFFFFF",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: "0.02em",
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Internal sub-components ───────────────────────────────────────

function ProfileRadioRow(props: {
  label: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        border: "none",
        background: props.selected ? "rgba(255, 90, 31, 0.10)" : "transparent",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "background 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!props.selected) {
          e.currentTarget.style.background = "rgba(26, 26, 26, 0.04)";
        }
      }}
      onMouseLeave={(e) => {
        if (!props.selected) {
          e.currentTarget.style.background = "transparent";
        }
      }}
    >
      <span
        style={{
          flex: "0 0 14px",
          marginTop: 3,
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: props.selected
            ? "4px solid #FF5A1F"
            : "1.5px solid rgba(26, 26, 26, 0.35)",
          background: "white",
          boxSizing: "border-box",
        }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "#1A1A1A",
            letterSpacing: "-0.005em",
          }}
        >
          {props.label}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "rgba(26, 26, 26, 0.55)",
            lineHeight: 1.4,
          }}
        >
          {props.desc}
        </span>
      </span>
    </button>
  );
}

function SubField(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(26, 26, 26, 0.45)",
        }}
      >
        {props.label}
      </span>
      {props.children}
    </div>
  );
}

function SegmentedControl<T extends string>(props: {
  options: T[];
  value: T;
  onChange: (next: T) => void;
  renderLabel?: (opt: T) => string;
  /** v0.40.40: optional secondary text shown below each option's
   *  primary label. Used by the flat-type picker to surface total
   *  area ("~62 m²", "~90 m²", "~115 m²") so users can compare
   *  before committing. When undefined, the segmented control
   *  renders single-line as before. */
  renderSubtitle?: (opt: T) => string | null;
}) {
  const hasSubtitles = props.options.some(
    (o) => props.renderSubtitle?.(o) != null,
  );
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 3,
        borderRadius: 8,
        background: "rgba(26, 26, 26, 0.04)",
      }}
    >
      {props.options.map((opt) => {
        const isActive = opt === props.value;
        const subtitle = props.renderSubtitle?.(opt) ?? null;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => props.onChange(opt)}
            style={{
              flex: 1,
              // When subtitles are present, give a bit more vertical
              // breathing room and stack label + subtitle.
              padding: hasSubtitles ? "7px 8px 6px" : "6px 8px",
              borderRadius: 6,
              border: "none",
              background: isActive ? "#FFFFFF" : "transparent",
              boxShadow: isActive ? "0 1px 4px rgba(0, 0, 0, 0.08)" : "none",
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? ACCENT : "rgba(26, 26, 26, 0.6)",
              }}
            >
              {props.renderLabel ? props.renderLabel(opt) : opt}
            </span>
            {subtitle && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: isActive
                    ? "rgba(26, 26, 26, 0.5)"
                    : "rgba(26, 26, 26, 0.4)",
                  letterSpacing: "0.01em",
                }}
              >
                {subtitle}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
