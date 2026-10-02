import { NextResponse } from "next/server";
import { normalizeChatStudioSnapshotForPost } from "@/lib/chat-brain/studio/normalize-chat-studio-snapshot";
import { isBrainEnabled } from "@/lib/chat-brain/core/brain-flag";
import { BRAIN_ANTHROPIC_MODEL } from "@/lib/chat-brain/core/anthropic-model";
import {
  generateSuggestionsRequestId,
  generateUserMessageId,
} from "@/lib/chat-brain/core/request-ids";
import { runStreamPump } from "@/lib/chat-brain/generation/stream-pump";
import { buildStreamingChatResponse } from "@/lib/chat-brain/generation/build-stream-response";
import { buildSuggestionsSystemPrompt } from "@/lib/chat-brain/suggestions/build-suggestions-system-prompt";
import { DEFAULT_PROJECT_ID } from "@/lib/projects/demoProjects";
import {
  tryConsumeSuggestionSlot,
  getSuggestionRemaining,
} from "@/lib/chat-brain/suggestions/daily-cap";
import type { Preference } from "@/lib/store/preferences-slice";
import type { ConversationTurn } from "@/lib/store/types";

// ───────────────────────────────────────────────────────────────────────
// /api/suggestions — proactive design observations.
//
// Same shape as /api/chat's brain branch but:
//
//   1. No user message — the trigger is hard-coded ("Review this
//      space..."). The model produces a list of cards rather than a
//      conversational response.
//
//   2. Daily cap consulted before opening the model call. When the
//      cap is hit, the endpoint returns an SSE stream containing a
//      single error-style event with a friendly explanation, rather
//      than a 429 — easier UX, easier debugging.
//
//   3. Suggestions can be opted out with ENABLE_BRAIN_PIPELINE=false.
//      Default is on. When off, the endpoint returns a 503.
//
// The response Content-Type is text/event-stream (same wire shape
// as chat — delta/done/error events). The client (suggestions-slice)
// parses on the same event protocol; only the body content differs
// (it's structured `### Suggestion N` headings instead of
// conversational prose).
// ───────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Anthropic API key not configured." },
      { status: 503 },
    );
  }

  if (!isBrainEnabled()) {
    return NextResponse.json(
      {
        error:
          "Suggestions require the brain pipeline. Unset ENABLE_BRAIN_PIPELINE or set it to true.",
      },
      { status: 503 },
    );
  }

  let body: {
    studioSnapshot?: unknown;
    preferences?: Preference[];
    recentTurns?: ConversationTurn[];
    projectId?: string;
    projectTitle?: string | null;
    sceneSummary?: string | null;
    clientAttemptId?: string;
  } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  // Studio snapshot validation — null is fine; we'll use the empty-
  // scene fallback inside the prompt builder.
  const norm = normalizeChatStudioSnapshotForPost({
    rawStudioSnapshot: body.studioSnapshot,
  });
  if (!norm.ok) return norm.response;
  const studioSnapshot = norm.studioSnapshotPayload;

  // Daily cap. We use the global key — there's no per-user keying
  // in this deployment. When user accounts land, swap to a stable
  // user id.
  const slot = tryConsumeSuggestionSlot("global");
  if (!slot.allowed) {
    return NextResponse.json(
      {
        error:
          "You've used today's suggestions budget. The counter resets at midnight UTC.",
        remainingToday: 0,
        capPerDay: slot.cap,
      },
      { status: 200 }, // soft fail — easier UI handling
    );
  }

  // Build the system prompt for suggestions.
  const promptResult = buildSuggestionsSystemPrompt({
    studioSnapshotPayload: studioSnapshot,
    preferences: Array.isArray(body.preferences) ? body.preferences : [],
    recentTurns: Array.isArray(body.recentTurns) ? body.recentTurns : [],
    projectId: body.projectId ?? DEFAULT_PROJECT_ID,
    projectTitle: body.projectTitle ?? null,
    sceneSummary: body.sceneSummary ?? null,
  });

  // Correlation IDs (mirroring chat).
  const chatRequestId = generateSuggestionsRequestId();
  const userMessageId = generateUserMessageId();

  // Open the pump. The synthetic user message is the trigger — the
  // model never sees a real user prompt; it sees only the system
  // prompt + the prompt builder's hard-coded trigger.
  const pump = runStreamPump({
    apiKey,
    model: BRAIN_ANTHROPIC_MODEL,
    systemPrompt: promptResult.systemPrompt,
    messages: [
      {
        role: "user",
        content: promptResult.triggerMessage,
      },
    ],
    // Suggestions can be longer than a single chat reply — 5 cards
    // at 3 sentences each plus headings. Bump the cap.
    maxTokens: 3000,
    abortSignal: req.signal,
  });

  // Stream back via the same builder used for chat. The response
  // headers include X-Chat-Request-Id, grounding signals, and the
  // remaining-today counter.
  const response = buildStreamingChatResponse({
    pump,
    chatRequestId,
    clientAttemptId: body.clientAttemptId ?? null,
    conversationId: null,
    userMessageId,
    costWarning: false,
    retrievalQuality: "none",
    studioSnapshotAttached: studioSnapshot !== null,
    attachmentGrounding: {
      responseHeaderValue: "none",
      hasUsableGrounding: false,
    },
    onPumpComplete: (result) => {
      if (result.failureCategory) {
        console.warn(
          `[suggestions] generation failed: ${result.failureCategory} (path=${result.path})`,
        );
      } else {
        console.log(
          JSON.stringify({
            event: "suggestions_generation_complete",
            chatRequestId,
            path: result.path,
            finalLength: result.finalText.length,
            usedLenientFallback: result.usedLenientFallback,
            remainingAfter: getSuggestionRemaining("global").remaining,
          }),
        );
      }
    },
  });

  // Surface the remaining count to the client. Append to the existing
  // headers without breaking the streaming response.
  // (We can't mutate response.headers on Edge runtime — but on Node
  // runtime the Response wraps a fresh Headers object that's
  // mutable.)
  try {
    response.headers.set(
      "X-Suggestions-Remaining-Today",
      String(slot.remaining),
    );
    response.headers.set(
      "X-Suggestions-Cap-Per-Day",
      String(slot.cap),
    );
  } catch {
    // Headers immutable — the client can call /api/suggestions/remaining
    // separately if needed. (Not implemented; nice-to-have.)
  }

  return response;
}

/**
 * GET /api/suggestions — returns the current remaining count without
 * consuming a slot. Used by the UI on mount to populate the
 * "X / 50 today" counter without burning quota.
 */
export async function GET(): Promise<Response> {
  if (!isBrainEnabled()) {
    return NextResponse.json(
      { remainingToday: 0, capPerDay: 0, brainEnabled: false },
      { status: 200 },
    );
  }
  const r = getSuggestionRemaining("global");
  return NextResponse.json(
    {
      remainingToday:
        r.remaining === Number.POSITIVE_INFINITY ? null : r.remaining,
      capPerDay: r.cap === 0 ? null : r.cap,
      brainEnabled: true,
    },
    { status: 200 },
  );
}
