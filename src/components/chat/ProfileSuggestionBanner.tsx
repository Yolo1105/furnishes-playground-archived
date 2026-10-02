"use client";

import { useStore } from "@studio/store";
import {
  detectHdbIntent,
  evaluateProfileMismatch,
  roomDisplayName,
  type SgHdbProfile,
  type SgHdbRoom,
} from "@studio/profiles/sg-hdb";

/**
 * ProfileSuggestionBanner — v0.40.41 Fix 2.
 *
 * A small, quiet banner that catches three kinds of profile/prompt
 * mismatch BEFORE the user spends a generation on the wrong context:
 *
 *   1. **Profile null + HDB-intent prompt.** User typed "design my
 *      4-room HDB master bedroom" with no profile set. We suggest
 *      enabling Singapore HDB with the detected (flat type, room).
 *      One click sets the profile correctly.
 *
 *   2. **SG HDB active + room mismatch.** Profile is set to
 *      "4-room kitchen" but the user typed "design my master
 *      bedroom." We suggest switching the room to master_bedroom.
 *      One click swaps the room within the active profile.
 *
 *   3. **SG HDB active + non-HDB context.** Profile is HDB but the
 *      prompt mentions "hotel lobby," "warehouse," "suburban house,"
 *      etc. We suggest disabling the profile for this generation.
 *      One click clears the profile.
 *
 * Visibility predicate (all variants):
 *   - Mode is generative (Room Layout or Interior Design),
 *   - User has not dismissed the suggestion this session,
 *   - The relevant detector returns a non-"none" signal.
 *
 * Dismissal is session-scoped via the slice flag — auto-resets on
 * every profile mutation so the user can't permanently silence it.
 *
 * Visual idiom mirrors ProfileDisclosure (translucent white background,
 * blur, thin colored left border) but with a slightly muted accent
 * color so it reads as "tentative suggestion" rather than "active
 * context." Three cases share the same visual shell with different
 * label + action button so the user sees a consistent affordance.
 *
 * Rationale: profile mismatches produce wrong outputs that look
 * plausible — a user might not realize the HDB profile clamped their
 * "design my bedroom" into a 3.0×2.4m kitchen. Catching this before
 * generation runs (a) saves $0.20+ of API spend, (b) saves the user
 * from blaming the model for a prompt-context mismatch they didn't
 * intend.
 */
export function ProfileSuggestionBanner() {
  const profile = useStore((s) => s.currentProfile);
  const mode = useStore((s) => s.mode);
  const message = useStore((s) => s.message);
  const dismissed = useStore((s) => s.profileSuggestionDismissed);
  const setProfile = useStore((s) => s.setProfile);
  const setSgHdbRoom = useStore((s) => s.setSgHdbRoom);
  const dismiss = useStore((s) => s.dismissProfileSuggestion);

  // Visibility predicate — same generative-modes rule as the
  // disclosure banner; banner only matters where the profile would
  // actually constrain generation.
  const profileAppliesInThisMode =
    mode === "Room Layout" || mode === "Interior Design";
  if (!profileAppliesInThisMode) return null;
  if (dismissed) return null;

  // Two evaluation paths: one when profile is null (suggest enabling),
  // one when profile is active (suggest fixing mismatches). The two
  // can never simultaneously fire — profile is either null or set.
  if (!profile) {
    const suggestion = detectHdbIntent(message);
    if (!suggestion) return null;
    const label = formatSuggestionLabel(suggestion);
    return (
      <Banner
        kind="suggest-enable"
        message={
          <>
            Looks like an HDB design — enable{" "}
            <strong style={{ fontWeight: 600, color: "#1A1A1A" }}>
              {label}
            </strong>
            ?
          </>
        }
        title={label}
        actionLabel="Enable"
        actionAriaLabel={`Enable ${label} profile`}
        onAction={() => setProfile(suggestion)}
        onDismiss={dismiss}
      />
    );
  }

  // Profile is active — check for room mismatch or non-HDB context.
  if (profile.kind === "sg-hdb") {
    const signal = evaluateProfileMismatch(message, profile);
    if (signal.kind === "none") return null;

    if (signal.kind === "switch-room") {
      const currentRoomName = roomDisplayName(profile.room);
      const suggestedRoomName = roomDisplayName(
        signal.suggestedRoom as SgHdbRoom,
      );
      return (
        <Banner
          kind="switch-room"
          message={
            <>
              Active room is{" "}
              <strong style={{ fontWeight: 600, color: "#1A1A1A" }}>
                {currentRoomName}
              </strong>{" "}
              but the prompt mentions &ldquo;{signal.matched}&rdquo; — switch to{" "}
              <strong style={{ fontWeight: 600, color: "#1A1A1A" }}>
                {suggestedRoomName}
              </strong>
              ?
            </>
          }
          title={`Switch active room to ${suggestedRoomName}`}
          actionLabel={`Switch to ${suggestedRoomName}`}
          actionAriaLabel={`Switch active room to ${suggestedRoomName}`}
          onAction={() => setSgHdbRoom(signal.suggestedRoom)}
          onDismiss={dismiss}
        />
      );
    }

    // signal.kind === "disable-profile"
    return (
      <Banner
        kind="disable-profile"
        message={
          <>
            Active profile is Singapore HDB but the prompt mentions &ldquo;
            {signal.matched}&rdquo; — disable the profile for this generation?
          </>
        }
        title={`Disable Singapore HDB profile`}
        actionLabel="Disable profile"
        actionAriaLabel="Disable the Singapore HDB profile"
        onAction={() => setProfile(null)}
        onDismiss={dismiss}
      />
    );
  }

  return null;
}

// ─── Internal banner shell ────────────────────────────────────────
//
// All three variants share styling — the only differences are the
// label text, the action button copy, and the onAction callback.
// Pulling the shell into a reusable component keeps each branch
// above readable.

function Banner(props: {
  kind: "suggest-enable" | "switch-room" | "disable-profile";
  message: React.ReactNode;
  title: string;
  actionLabel: string;
  actionAriaLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}) {
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
        // Muted accent — same hue as the disclosure but lower opacity
        // (0.32 vs 0.55) signals "tentative suggestion" vs "active".
        borderLeft: "3px solid rgba(255, 90, 31, 0.45)",
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
      role="status"
      aria-live="polite"
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
        Suggestion
      </span>
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          // Allow wrapping — mismatch messages can run 80–100 chars
          // ("Active room is Common Bedroom 2 but the prompt mentions
          // 'kitchen' — switch to Kitchen?") which would truncate
          // unhelpfully on narrow viewports.
          whiteSpace: "normal",
        }}
        title={props.title}
      >
        {props.message}
      </span>
      <button
        type="button"
        onClick={props.onAction}
        style={{
          flex: "0 0 auto",
          padding: "3px 10px",
          borderRadius: 6,
          border: "none",
          background: "rgba(255, 90, 31, 0.10)",
          fontFamily: "inherit",
          fontSize: 11,
          fontWeight: 600,
          color: "#FF5A1F",
          cursor: "pointer",
          transition: "background 0.15s ease",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255, 90, 31, 0.18)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "rgba(255, 90, 31, 0.10)")
        }
        aria-label={props.actionAriaLabel}
      >
        {props.actionLabel}
      </button>
      <button
        type="button"
        onClick={props.onDismiss}
        style={{
          flex: "0 0 auto",
          padding: "3px 8px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          fontFamily: "inherit",
          fontSize: 11,
          fontWeight: 500,
          color: "rgba(26, 26, 26, 0.55)",
          cursor: "pointer",
          transition: "background 0.15s ease, color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(26, 26, 26, 0.05)";
          e.currentTarget.style.color = "rgba(26, 26, 26, 0.75)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "rgba(26, 26, 26, 0.55)";
        }}
        aria-label="Dismiss profile suggestion"
      >
        Dismiss
      </button>
    </div>
  );
}

/** Human-readable label for the suggested profile — used both as the
 *  visible string in the banner and in the aria-label of the Enable
 *  button. Mirrors the format of summarizeProfile() but trimmed:
 *  "Singapore HDB 4-room master bedroom" rather than including
 *  dimensions (the banner is meant to be quick and scannable; full
 *  dimensions appear in the disclosure once they accept). */
function formatSuggestionLabel(p: SgHdbProfile): string {
  return `Singapore HDB ${p.flatType} ${roomDisplayName(p.room).toLowerCase()}`;
}
