"use client";

import { useEffect, useRef, useState } from "react";
import { useStore, selectCanSend } from "@studio/store";
import { cancelGeneration } from "@studio/store/chat-slice";
import { useAutoGrowTextarea } from "@studio/hooks/useAutoGrowTextarea";
import { ReferenceThumbnails } from "./ReferenceThumbnails";
import { GuidedFields } from "./GuidedFields";
import { ModeDropdown } from "./ModeDropdown";
import { ProfilePill } from "./ProfilePill";
import { EvaChip } from "./EvaContextPanel";
import {
  ImageIcon,
  LightbulbIcon,
  SendArrowIcon,
  MicIcon,
  StopIcon,
} from "@studio/icons";

const ICON_BUTTON_STYLE: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "rgba(26, 26, 26, 0.55)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 0.15s ease, color 0.15s ease",
};

/**
 * The frosted-glass input box at the very bottom of the chat dock.
 * Contains, top to bottom:
 *   • A strip of reference-image thumbnails (only when present).
 *   • Either the free-form textarea OR the guided-fields block,
 *     toggled by `guidedContext`.
 *   • A bottom toolbar with: image upload + suggestions toggle (left),
 *     mode dropdown + send/mic button (right).
 *
 * The accent border lights up while any descendant input/textarea has
 * focus — `isFocusedInside` is local state managed via focus/blur
 * handlers on every input the box owns.
 */
export function ChatInputBox() {
  const message = useStore((s) => s.message);
  const setMessage = useStore((s) => s.setMessage);
  const guidedContext = useStore((s) => s.guidedContext);
  const sendMessage = useStore((s) => s.sendMessage);
  const canSend = useStore(selectCanSend);
  const isGenerating = useStore((s) => s.isGenerating);

  const setUploadModalOpen = useStore((s) => s.setUploadModalOpen);
  const suggestionsOpen = useStore((s) => s.suggestionsOpen);
  const toggleSuggestions = useStore((s) => s.toggleSuggestions);

  const [isFocusedInside, setIsFocusedInside] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(textareaRef, [message, guidedContext]);

  // v0.40.27: blur the textarea the moment a turn starts processing.
  // The user reported a blinking cursor stayed visible in the empty
  // input after pressing Send — distracting since they can't type
  // again until the response lands anyway. Watching isThinking flip
  // true (set inside sendMessage) guarantees the blur fires for
  // EVERY send path (Enter key, send button click, programmatic).
  const isThinking = useStore((s) => s.isThinking);
  useEffect(() => {
    if (isThinking) {
      textareaRef.current?.blur();
    }
  }, [isThinking]);

  // v0.40.48: rotating placeholder. Cycle through inspiration prompts
  // every 4s while the textarea is empty + unfocused. The native
  // textarea `placeholder` attribute supports per-render strings; we
  // just swap them on a timer. Animation comes from the parent label
  // wrapper's CSS class (a fade between the OLD and NEW value via
  // a key-driven re-render of the textarea — too invasive). Instead
  // we use a simpler approach: re-render the placeholder string and
  // apply a brief CSS opacity dip to the textarea via inline transition
  // so the swap doesn't pop. The swap pauses while the user is
  // typing or focused — no point cycling text they can't see.
  const PLACEHOLDERS = [
    "Describe the space you're working on…",
    "What's the vibe? Mid-century, minimalist, biophilic…",
    "Try: a 4×5m bedroom with a reading nook by the window",
    "How should it feel — calm, social, focused, playful?",
    "Tell me about the light. North-facing? Sunset glow?",
    "What's the room used for, and who lives there?",
    "Sketch a dining room for six, walnut and warm linen",
    "Drop a photo of a piece you love and we'll riff from it",
    "An L-shaped studio with a daybed, plants, and oak floors",
  ];
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderDim, setPlaceholderDim] = useState(false);
  useEffect(() => {
    // Pause rotation if the user is focused (typing) or has any text.
    if (isFocusedInside || message.length > 0) {
      // v0.40.49.1: also reset the dim flag so that returning to the
      // empty + unfocused state doesn't briefly show the placeholder
      // mid-transition (stuck at 0.3 opacity).
      setPlaceholderDim(false);
      return;
    }
    const interval = setInterval(() => {
      setPlaceholderDim(true);
      setTimeout(() => {
        setPlaceholderIndex((i) => (i + 1) % PLACEHOLDERS.length);
        setPlaceholderDim(false);
      }, 200);
    }, 4000);
    return () => clearInterval(interval);
  }, [isFocusedInside, message.length, PLACEHOLDERS.length]);
  const currentPlaceholder = PLACEHOLDERS[placeholderIndex];

  return (
    <div
      className="glass glass-chat"
      style={{
        width: "100%",
        borderRadius: 18,
        borderColor: isFocusedInside ? "#FF5A1F" : undefined,
        boxShadow: isFocusedInside
          ? "0 1px 0 0 rgba(255,255,255,0.6) inset, 0 8px 28px -14px rgba(255, 90, 31, 0.22)"
          : undefined,
        padding: "12px 14px 10px 14px",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
      }}
    >
      <ReferenceThumbnails />

      {guidedContext ? (
        <GuidedFields onFocusInside={setIsFocusedInside} />
      ) : (
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => setIsFocusedInside(true)}
          onBlur={() => setIsFocusedInside(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              // Block submit while a generation is in progress —
              // overlapping runs would race on the store. The user
              // must explicitly stop first.
              if (canSend && !isGenerating) sendMessage();
            }
          }}
          placeholder={currentPlaceholder}
          rows={1}
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            resize: "none",
            background: "transparent",
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 1.5,
            color: "#1A1A1A",
            padding: "4px 0 8px 0",
            minHeight: 24,
            maxHeight: 160,
            letterSpacing: "-0.005em",
            // v0.40.48: smooth the placeholder swap with an opacity
            // transition. The :placeholder-shown pseudo state in CSS
            // would let us target the empty placeholder text alone,
            // but inline opacity on the textarea while empty achieves
            // the same effect with less plumbing — and the user only
            // sees the placeholder when the field is empty anyway.
            opacity:
              !isFocusedInside && message.length === 0 && placeholderDim
                ? 0.3
                : 1,
            transition: "opacity 0.2s ease",
          }}
        />
      )}

      {/* Bottom toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 6,
          paddingTop: guidedContext ? 8 : 0,
          borderTop: guidedContext
            ? "1px solid rgba(124, 80, 50, 0.12)"
            : "none",
        }}
      >
        {/* Left icons */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className="icon-btn"
            style={ICON_BUTTON_STYLE}
            aria-label="Upload image"
            type="button"
            onClick={() => setUploadModalOpen(true)}
          >
            <ImageIcon />
          </button>
          <button
            className="icon-btn"
            type="button"
            onClick={toggleSuggestions}
            aria-label={
              suggestionsOpen ? "Hide suggestions" : "Show suggestions"
            }
            style={{
              ...ICON_BUTTON_STYLE,
              color: suggestionsOpen ? "#FF5A1F" : "rgba(26, 26, 26, 0.55)",
              background: suggestionsOpen
                ? "rgba(255, 90, 31, 0.08)"
                : "transparent",
            }}
          >
            <LightbulbIcon />
          </button>
        </div>

        {/* Right: mode dropdown + Eva + profile pill + send */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ModeDropdown />
          <EvaChip />
          <ProfilePill />

          <button
            className={
              isGenerating
                ? "stop-btn send-button send-button-stop"
                : canSend
                  ? "send-btn-enabled send-button"
                  : "mic-btn send-button"
            }
            type="button"
            onClick={() => {
              if (isGenerating) {
                cancelGeneration();
              } else if (canSend) {
                sendMessage();
              }
            }}
            aria-label={
              isGenerating
                ? "Stop generation"
                : canSend
                  ? "Send"
                  : "Voice input"
            }
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "none",
              // Three states, three distinct visual languages:
              //   • Stop (isGenerating): ink-on-white with a slow
              //     pulsing ring. Calm but unambiguous — the filled
              //     square icon + the rhythmic outer pulse together
              //     communicate "I'm working, click to stop." We
              //     deliberately do NOT use red here. Red felt
              //     alarming for a routine 5–15s wait, like the app
              //     was in trouble.
              //   • Send (canSend): brand orange — the primary
              //     action color. Distinct from ink so the user can
              //     tell at a glance whether their next click sends
              //     or cancels.
              //   • Idle (no input, no generation): muted neutral
              //     so the button doesn't draw attention when there's
              //     nothing to do.
              background: isGenerating
                ? "#1A1A1A"
                : canSend
                  ? "#FF5A1F"
                  : "rgba(26, 26, 26, 0.06)",
              color: isGenerating
                ? "#FFF4EC"
                : canSend
                  ? "#FFF4EC"
                  : "rgba(26, 26, 26, 0.55)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition:
                "background 0.2s ease, color 0.2s ease, transform 0.15s ease",
              // Pulse animation when generating. The animation drives
              // box-shadow (a soft expanding ring of ink at low opacity)
              // so the button itself stays still — no layout thrash.
              // For non-generating states, a static drop shadow gives
              // the button a slight lift off the chat-input surface.
              animation: isGenerating
                ? "send-button-pulse 1.6s ease-in-out infinite"
                : undefined,
              boxShadow: isGenerating
                ? undefined
                : canSend
                  ? "0 4px 12px -3px rgba(255, 90, 31, 0.4)"
                  : "none",
            }}
          >
            {isGenerating ? (
              <StopIcon size={11} />
            ) : canSend ? (
              <SendArrowIcon />
            ) : (
              <MicIcon />
            )}
          </button>
          <style>{`
            @keyframes send-button-pulse {
              0%,
              100% {
                box-shadow: 0 0 0 0 rgba(26, 26, 26, 0.35);
              }
              50% {
                box-shadow: 0 0 0 6px rgba(26, 26, 26, 0);
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .send-button-stop {
                animation: none !important;
                box-shadow: 0 4px 12px -3px rgba(26, 26, 26, 0.3) !important;
              }
            }
          `}</style>
        </div>
      </div>
    </div>
  );
}
