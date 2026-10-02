"use client";

import { useStore } from "@studio/store";
import { summarizeProfile } from "@studio/profiles/sg-hdb";

/**
 * ProfileDisclosure — a thin one-line banner shown above the input
 * box when an architectural profile is active. Tells the user, at a
 * glance, what context every generation is running against, and
 * gives them a one-click way to change it.
 *
 * Visual idiom: neutral background with a subtle left border in the
 * accent color. Reads "Profile · Singapore HDB 4-room master bedroom
 * (3.5 × 3.0 m, 12 m²)" with a "Change" button on the right.
 *
 * The "Change" button calls `setPickerOpen(true)` on the ProfileSlice
 * directly — earlier versions used a DOM custom-event bus, but slice
 * state is cleaner: no implicit cross-component coupling, no event-
 * listener leaks, and TypeScript can see the relationship.
 *
 * Hidden when no profile is set so the dock looks identical to its
 * pre-profile shape for users outside Singapore.
 */
export function ProfileDisclosure() {
  const profile = useStore((s) => s.currentProfile);
  const setPickerOpen = useStore((s) => s.setPickerOpen);
  const mode = useStore((s) => s.mode);
  // v0.40.41: session-scoped dismiss. The user can click × to hide
  // this banner for the rest of the session. Auto-resets on any
  // profile mutation (setProfile, setSgHdbFlatType, setSgHdbRoom)
  // so the user always sees the new context confirmation. The slice
  // owns the flag — same component idiom as `isPickerOpen`.
  const dismissed = useStore((s) => s.profileDisclosureDismissed);
  const dismiss = useStore((s) => s.dismissProfileDisclosure);

  // Hide in modes where the profile doesn't apply — same rule as
  // ProfilePill. The architectural profile only constrains room
  // generation (Room Layout, Interior Design). In Ask + Furniture
  // we'd be claiming "Designing for HDB 4-room master" while the
  // user is doing something unrelated. The saved profile stays in
  // state — it'll surface again when the user switches back.
  const profileAppliesInThisMode =
    mode === "Room Layout" || mode === "Interior Design";
  if (!profileAppliesInThisMode) return null;
  if (!profile) return null;
  if (dismissed) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 12px 7px 13px",
        margin: "0 4px",
        background: "rgba(255, 255, 255, 0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderLeft: "3px solid #FF5A1F",
        borderTop: "1px solid rgba(26, 26, 26, 0.06)",
        borderRight: "1px solid rgba(26, 26, 26, 0.06)",
        borderBottom: "1px solid rgba(26, 26, 26, 0.06)",
        borderRadius: 10,
        fontFamily: "var(--font-syne), sans-serif",
        fontSize: 11,
        lineHeight: 1.4,
        color: "rgba(26, 26, 26, 0.75)",
        letterSpacing: "-0.005em",
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "rgba(26, 26, 26, 0.45)",
          flex: "0 0 auto",
        }}
      >
        Profile
      </span>
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={summarizeProfile(profile)}
      >
        <strong style={{ fontWeight: 600, color: "#1A1A1A" }}>
          {summarizeProfile(profile)}
        </strong>
      </span>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        // Marked so the picker's document-level outside-click
        // handler can recognize this button as "still part of the
        // profile UI" and not close the picker when this is clicked.
        // (React synthetic-event stopPropagation doesn't reach
        // document-level native listeners — we need a marker the
        // handler can check on the target itself.)
        data-profile-picker-trigger="true"
        style={{
          flex: "0 0 auto",
          padding: "3px 8px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          fontFamily: "inherit",
          fontSize: 11,
          fontWeight: 600,
          color: "#FF5A1F",
          cursor: "pointer",
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255, 90, 31, 0.10)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        Change
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide profile banner"
        title="Hide for this session — banner returns when you change the profile"
        style={{
          flex: "0 0 auto",
          padding: "3px 6px",
          marginLeft: -2,
          borderRadius: 6,
          border: "none",
          background: "transparent",
          fontFamily: "inherit",
          fontSize: 14,
          lineHeight: 1,
          fontWeight: 400,
          color: "rgba(26, 26, 26, 0.4)",
          cursor: "pointer",
          transition: "background 0.15s ease, color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(26, 26, 26, 0.06)";
          e.currentTarget.style.color = "rgba(26, 26, 26, 0.7)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "rgba(26, 26, 26, 0.4)";
        }}
      >
        ×
      </button>
    </div>
  );
}
