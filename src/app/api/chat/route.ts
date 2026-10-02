import { NextResponse } from "next/server";
import { buildChatSystemPromptStack } from "@/lib/chat-brain/prompt/build-chat-system-prompt-stack";
import { normalizeChatStudioSnapshotForPost } from "@/lib/chat-brain/studio/normalize-chat-studio-snapshot";
import { buildContext } from "@/lib/chat-brain/core/context-builder";
import { validateInput } from "@/lib/chat-brain/core/guardrails";
import { isBrainEnabled } from "@/lib/chat-brain/core/brain-flag";
import { BRAIN_ANTHROPIC_MODEL } from "@/lib/chat-brain/core/anthropic-model";
import {
  generateChatRequestId,
  generateUserMessageId,
} from "@/lib/chat-brain/core/request-ids";
import { runStreamPump } from "@/lib/chat-brain/generation/stream-pump";
import { buildStreamingChatResponse } from "@/lib/chat-brain/generation/build-stream-response";
import {
  validateChatAttachments,
  chatAttachmentToAnthropicContent,
  type ChatAttachment,
} from "@/lib/chat-brain/attachments/chat-attachment";
import { DEFAULT_PROJECT_ID } from "@/lib/projects/demoProjects";
import type { Preference } from "@/lib/store/preferences-slice";
import type { ConversationTurn } from "@/lib/store/types";

// ───────────────────────────────────────────────────────────────────────
// /api/chat — streaming brain pipeline (scene-grounded Anthropic chat).
//
// Reads `{message, studioSnapshot, preferences, recentTurns, ...}`,
// builds the layered system prompt, and returns SSE. Opt out with
// ENABLE_BRAIN_PIPELINE=false (no legacy JSON fallback).
// ───────────────────────────────────────────────────────────────────────

const requestLog = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;

function rateLimitOk(clientId: string): boolean {
  const now = Date.now();
  const hits = (requestLog.get(clientId) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (hits.length >= RATE_LIMIT_MAX) return false;
  hits.push(now);
  requestLog.set(clientId, hits);
  return true;
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI assistant is not configured on this server" },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");

  // Optional Supabase gating. If env vars are present, a valid bearer
  // token is required.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseAnon) {
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnon, Authorization: authHeader },
    });
    if (!verifyRes.ok) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
  }

  const body = await req.json();
  const { message } = body ?? {};
  if (typeof message !== "string") {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  // Rate-limit key.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rlKey = authHeader?.startsWith("Bearer ")
    ? `tok:${authHeader.slice(7, 47)}`
    : `ip:${ip}`;
  if (!rateLimitOk(rlKey)) {
    return NextResponse.json(
      { error: "Rate limit: 20 requests/hour" },
      { status: 429 },
    );
  }

  if (!isBrainEnabled()) {
    return NextResponse.json(
      {
        error:
          "Chat brain is disabled. Unset ENABLE_BRAIN_PIPELINE or set it to true.",
      },
      { status: 503 },
    );
  }

  return await handleBrainRequest(req, body, apiKey);
}

/**
 * Streaming brain path. Layered prompt stack + SSE pump.
 *
 * Returns text/event-stream with X-Chat-* headers. The client
 * (chat-slice) detects the content-type and appends deltas.
 */
async function handleBrainRequest(
  req: Request,
  body: {
    message?: string;
    studioSnapshot?: unknown;
    preferences?: Preference[];
    recentTurns?: ConversationTurn[];
    projectId?: string;
    projectTitle?: string | null;
    sceneSummary?: string | null;
    history?: unknown;
    clientAttemptId?: string;
    attachments?: unknown;
    mode?: string;
    assistantId?: string;
    personaId?: string;
  },
  apiKey: string,
): Promise<Response> {
  const message = body.message ?? "";

  // 1. Input guardrails (length + injection patterns).
  const validation = validateInput(message);
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.reason ?? "Invalid input" },
      { status: 400 },
    );
  }

  // 2. Studio snapshot validation. Optional — null is fine.
  const norm = normalizeChatStudioSnapshotForPost({
    rawStudioSnapshot: body.studioSnapshot,
  });
  if (!norm.ok) return norm.response;
  const studioSnapshot = norm.studioSnapshotPayload;

  // 2.5. Attachments validation. Optional — empty is fine.
  const attResult = validateChatAttachments(body.attachments);
  if (!attResult.ok) {
    return NextResponse.json(
      { error: `Attachments: ${attResult.reason}` },
      { status: 400 },
    );
  }
  const explicitAttachments = attResult.attachments;

  // 2.6. Auto-promote the studio snapshot's reference image into the
  //      attachments array when present. The model sees the scene
  //      reference image as visual context without the client having
  //      to dual-supply. Skipped when the URL scheme isn't HTTPS-fetchable
  //      (blob:, data:, file:) — Anthropic can't reach those.
  //
  //      We only auto-promote if the URL isn't already represented in
  //      the explicit attachments — the user's explicit attachment
  //      wins (e.g. they uploaded a NEW image they want compared to
  //      the existing scene reference).
  const refUrl = studioSnapshot?.referenceImageUrl ?? null;
  const refAlreadyAttached =
    refUrl !== null &&
    explicitAttachments.some(
      (a) => a.source.type === "url" && a.source.url === refUrl,
    );
  const shouldAutoPromote =
    refUrl !== null &&
    !refAlreadyAttached &&
    (refUrl.startsWith("https://") || refUrl.startsWith("http://"));
  const attachments: ChatAttachment[] = shouldAutoPromote
    ? [
        ...explicitAttachments,
        {
          kind: "image",
          source: { type: "url", url: refUrl },
          caption: "scene reference image",
        },
      ]
    : explicitAttachments;

  // 3. Build the trimmed conversation history.
  const historyMessages: Array<{ role: string; content: string }> = (
    Array.isArray(body.history) ? body.history : []
  ).map((m: { role?: string; content?: string }) => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    content: typeof m?.content === "string" ? m.content : "",
  }));
  // The current user message goes in last. We'll splice in attachments
  // for the LAST message (this turn's user message) when calling
  // Anthropic — the prompt stack uses text-only history.
  historyMessages.push({ role: "user", content: message });

  const ctx = buildContext(historyMessages, {}, { maxContextTokens: 4000 });

  // 4. Assemble the layered system prompt (now with attachments layer).
  // Validate mode against the known set; reject unknown values rather
  // than silently dropping them so misconfigured clients fail loudly.
  const ALLOWED_MODES = new Set([
    "Ask",
    "Interior Design",
    "Furniture",
    "Room Layout",
  ] as const);
  const mode =
    body.mode && ALLOWED_MODES.has(body.mode as never)
      ? (body.mode as "Ask" | "Interior Design" | "Furniture" | "Room Layout")
      : undefined;

  const stack = buildChatSystemPromptStack(
    {
      message,
      studioSnapshotPayload: studioSnapshot,
      preferences: Array.isArray(body.preferences) ? body.preferences : [],
      recentTurns: Array.isArray(body.recentTurns) ? body.recentTurns : [],
      projectId: body.projectId ?? DEFAULT_PROJECT_ID,
      projectTitle: body.projectTitle ?? null,
      sceneSummary: body.sceneSummary ?? null,
      preferencesFlatSuffix: ctx.systemSuffix,
      attachments,
      mode,
      assistantId:
        (typeof body.assistantId === "string" && body.assistantId) ||
        (typeof body.personaId === "string" && body.personaId) ||
        undefined,
    },
    ctx.messages,
  );

  // 5. Generate correlation IDs for the response.
  const chatRequestId = generateChatRequestId();
  const userMessageId = generateUserMessageId();

  // 6. Build the message content for the LAST message (this turn).
  //    When there are attachments, we use the multipart content array
  //    form; when there aren't, plain string for compactness.
  const modelMessages = stack.modelMessages.map((m, idx, arr) => {
    if (idx === arr.length - 1 && m.role === "user" && attachments.length > 0) {
      // Splice in image content blocks alongside the text. Anthropic's
      // documented order: image blocks first, then text.
      return {
        role: "user" as const,
        content: [
          ...attachments.map((a) => chatAttachmentToAnthropicContent(a)),
          { type: "text" as const, text: m.content },
        ],
      };
    }
    return {
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    };
  });

  // 7. Open the pump.
  const pump = runStreamPump({
    apiKey,
    model: BRAIN_ANTHROPIC_MODEL,
    systemPrompt: stack.systemPrompt,
    messages: modelMessages,
    maxTokens: 2048,
    abortSignal: req.signal,
  });

  // 8. Build attachment grounding summary for the response header.
  const attachmentGrounding = {
    responseHeaderValue: (attachments.length > 0
      ? "partial"
      : "none") as "partial" | "none",
    hasUsableGrounding: attachments.length > 0,
  };

  // 9. Wrap into a streaming Response with X-Chat-* headers.
  return buildStreamingChatResponse({
    pump,
    chatRequestId,
    clientAttemptId: body.clientAttemptId ?? null,
    conversationId: null,
    userMessageId,
    costWarning: false,
    retrievalQuality: "none",
    studioSnapshotAttached: studioSnapshot !== null,
    attachmentGrounding,
    onPumpComplete: (result) => {
      // Telemetry hook. Phase 3a console-only.
      if (result.failureCategory) {
        console.warn(
          `[chat-brain] generation failed: ${result.failureCategory} (path=${result.path})`,
        );
      } else {
        console.log(
          JSON.stringify({
            event: "chat_generation_complete",
            chatRequestId,
            path: result.path,
            finalLength: result.finalText.length,
            usedLenientFallback: result.usedLenientFallback,
            attachmentCount: attachments.length,
          }),
        );
      }
    },
  });
}
