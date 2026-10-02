# Phase 0 — Orchestrator Annotation

> Source: `lib/eva/chat/post/run-chat-post-pipeline.ts` (737 LOC)
> Target: `src/lib/chat-brain/post/run-chat-post-pipeline.ts` (estimated ~480 LOC)

This document is the line-by-line plan for porting eva's chat orchestrator. **No code is written until you sign off on this.** Disagreements caught here cost minutes; disagreements caught after the port costs hours of rework.

## Reading guide

Each stage has three labels:
- **PORT** — copy with minor structural cleanup, keep the logic
- **ADAPT** — same idea, rewritten against our stack (Anthropic instead of OpenAI, Zustand+Supabase instead of Prisma, our schema)
- **DROP** — explicitly excluded; logic doesn't fit our app or depends on infra we don't have

---

## Pipeline structure (15 stages)

### Stage 1 — Request entry & client identity
**Eva (lines 65–69):** reads `clientIdentityFromRequest(req)` for IP-based logging.
**Decision: ADAPT.** We use Supabase auth (Bearer JWT) where possible, fall back to IP. The existing `/api/chat` already does this auth dance; we'll lift that pattern.
**Output type:** `{ clientId: string, signedIn: boolean, userId: string | null }`

### Stage 2 — Request validation
**Eva (lines 70–82):** `validateChatPostRequestStage(req)` — Zod-validates body, extracts `parsed`, `studioSnapshotPayload`, `attachmentList`, `chatRequestId`, `traceId`, `requestedAssistantId`. Returns `{ outcome: "ok" | "error", payload | response }`.
**Decision: PORT** with a single field drop: `requestedAssistantId` (no assistant catalog → not used).
**Adaptation:** our request schema differs slightly. We accept `{ message, mode, history, context, attachments?, conversationId?, projectId? }`. Output keeps the same `{ outcome: "ok", payload: {...} } | { outcome: "error", response: NextResponse }` shape so the caller's branch is unchanged.

### Stage 3 — Conversation resolution
**Eva (lines 84–106):** `resolveChatConversationForPost` — looks up or creates conversation, sets cookie, persists user message, derives `assistantForPrompt`, returns `{ convoId, setCookieHeader, userMessage, assistantForPrompt, costWarning, chatGenLogCtx }`.
**Decision: ADAPT.** Three changes:
1. Replace Prisma reads with Supabase REST (we have `pgSelect` / `pgInsert` from 0.34.0).
2. Drop `assistantForPrompt` (no assistant catalog).
3. Drop the cookie return — we don't use cookie-based session continuity (Supabase JWT does that).
**Output:** `{ convoId, userMessage, costWarning, chatGenLogCtx }` (4 fields instead of 6).

### Stage 4 — Domain config & history fetch
**Eva (lines 110–128):** `getDomainConfig()` reads brand-specific config (system prompt, conversation limits). Then fetches last N messages from Prisma.
**Decision: PORT (config) + ADAPT (history).**
- **Config:** I'll author a `furnishes-studio` domain config (designer voice, 3D-context-aware system prompt). Replaces eva's brand-specific copy. Same shape, different text.
- **History:** Read from our Supabase `messages` table via REST, or from the chat-slice when we already have it client-side. The pipeline takes history as a parameter — caller decides which source.

### Stage 5 — Preferences
**Eva (lines 130–133):** `getPreferencesAsRecord(prisma, convoId)` — pulls preferences from Prisma `Preference` table.
**Decision: ADAPT.** Read from our `preferences-slice` (introduced in Turn 2) + the per-project Supabase preferences table (introduced in Turn 2 schema bump).
**Output:** `Record<string, string>` — same shape as eva.

### Stage 6 — Workflow auto-advance + project intelligence
**Eva (lines 135–159):** `maybeAutoAdvanceProjectWorkflow` (depends on workflow stages — DROPPED subsystem) + `buildProjectIntelligenceContext` (PORT-able).
**Decision: SPLIT.**
- **`maybeAutoAdvanceProjectWorkflow`: DROP.** Depends on `design-workflow/stages.ts` and the playbook (both confirmed out of scope).
- **`buildProjectIntelligenceContext`: ADAPT.** Reads from our store + Supabase. Builds the studio-specific intelligence object. Workflow-related fields default to `null`.
**Output:** `projectIntel: ProjectIntelligenceContext | null` (no `designWorkflowStage` field — drops to null permanently).

### Stage 7 — Debug trace logging
**Eva (lines 161–166):** `DEBUG_CHAT_TRACE` env-gated trace log.
**Decision: PORT** as-is. Cheap diagnostic.

### Stage 8 — Playbook node resolution & first-message transition
**Eva (lines 168–204):** `getActiveNode`, `evaluateTransitions`, `transitionTo` — playbook state machine.
**Decision: DROP entirely.** The playbook is a confirmed out-of-scope subsystem. There's no `nodeConfig` after this stage.
**Replacement:** a hardcoded `nodeConfig = { systemPromptSuffix: "", responseLength: "auto" }` so the rest of the pipeline doesn't crash on missing config. The system prompt stack reads `nodeConfig` defensively.

### Stage 9 — Policy enforcement
**Eva (lines 206–232):** `checkPolicy(message, prefRecord, nodeConfig.requiredFields)` — if blocked, returns clarification message as a one-shot stream.
**Decision: PORT.** This is in our scope (Turn 4). For Turn 3 the function is stubbed `() => ({ blocked: false })` so the orchestrator never blocks. Turn 4 wires the real `checkPolicy` in.
**Output unchanged.** Stage stays in the pipeline structure now; behavior turns on in Turn 4.

### Stage 10 — Context builder
**Eva (lines 234–241):** `buildContext(messagesForContext, prefRecord, opts)` — builds the prompt suffix + filtered messages for the model. Handles token budget + summarization.
**Decision: PORT.** Pure logic. No external deps.

### Stage 11 — Grounding layers
**Eva (lines 243–250):** `buildChatGroundingLayers({ attachmentList, message, prefRecord, nodeConfig, ... })` — assembles 6 grounding layers: domain, retrieval (RAG), studio, attachments, assistants, playbook.
**Decision: ADAPT.** 4 layers instead of 6:
- **Domain:** PORT
- **Studio:** PORT (uses our snapshot serializer from Turn 2)
- **Preferences (replaces "assistants"):** ADAPT — reads our preferences slice
- **Attachments:** PORT
- **Retrieval:** STUB (returns empty `{ retrievalQuality: "unavailable", layers: "" }`) until you have a corpus
- **Playbook:** DROP

### Stage 12 — System prompt stack assembly
**Eva (lines 252–265):** `buildChatSystemPromptStack({...})`.
**Decision: ADAPT.** Drop two parameters that don't exist in our stack: `assistantForPrompt`, `designWorkflowStage`. Resulting stack still has 4 layers (domain → studio+preferences → critical facts → user).

### Stage 13 — Streaming primary/fallback
**Eva (lines 276–294):** `runChatPrimaryFallbackStreamText` — tries primary OpenAI model, falls back on rate-limit/quota.
**Decision: ADAPT.** Sonnet → Haiku fallback (Anthropic). Same shape: `{ outcome: "ok" | "error", result, primaryStreamAttempted, fallbackStreamAttempted, streamModelUsed }`.

### Stage 14 — Stream pump + recovery loop
**Eva (lines 310–629):** the giant streaming controller — pump tokens, detect empty-stream, run `generateText` recovery on a queue of fallback models, multiple sanity checks.
**Decision: PORT structurally + ADAPT model layer.**
- The control flow (pump → detect empty → run recovery → finalize) ports as-is.
- Replace `generateText` from `ai` SDK with Anthropic's non-streaming `messages.create`.
- Drop `recordCost` calls that write to Prisma (Risk 5 mitigation: cost-tracker stays in-memory only for now).
- Keep all sanity checks + telemetry-shaped logs (logged to console, not Sentry).
**Estimated reduction: 320 LOC → ~220 LOC** (the 100 LOC reduction comes from removing Prisma cost writes + telemetry-to-DB + queue manipulation we don't need).

### Stage 15 — Persist + post-response transition
**Eva (lines 631–716):** `finalizeChatModelOutput` (sanitize) → `persistChatAssistantMessage` (write to Prisma) → `runPlaybookPostResponseTransition`.
**Decision: SPLIT.**
- **`finalizeChatModelOutput`: PORT.**
- **`persistChatAssistantMessage`: ADAPT** — writes to our Supabase via the `pushTurn` helper from 0.34.0.
- **`runPlaybookPostResponseTransition`: DROP** (playbook).

---

## Summary

| Stage | Decision | New LOC est. |
|---|---|---|
| 1. Client identity | ADAPT | 25 |
| 2. Validation | PORT | 110 |
| 3. Conversation resolution | ADAPT | 90 |
| 4. Domain + history | PORT (config) + ADAPT (history) | 60 |
| 5. Preferences | ADAPT | 20 |
| 6. Project intelligence | ADAPT (drop workflow) | 40 |
| 7. Debug trace | PORT | 8 |
| 8. Playbook resolution | **DROP entirely** | 0 |
| 9. Policy | PORT (stubbed Turn 3, live Turn 4) | 25 |
| 10. Context builder | PORT | 25 |
| 11. Grounding layers | ADAPT (4 not 6) | 60 |
| 12. Prompt stack | ADAPT (drop assistant + workflow) | 30 |
| 13. Stream primary/fallback | ADAPT (Anthropic) | 50 |
| 14. Stream pump + recovery | PORT structurally + ADAPT model | 220 |
| 15. Persist + transition | SPLIT: PORT finalize, ADAPT persist, DROP transition | 30 |
| **TOTAL** | | **~793 LOC budgeted, ~480 expected after dedupe** |

## Net code-shrink reasons

The new orchestrator is meaningfully smaller than 737 LOC because:
- Drop playbook (~80 LOC of resolve + first-message transition + post-response transition)
- Drop workflow auto-advance (~25 LOC)
- Drop assistant catalog usage (~15 LOC)
- Drop Prisma cost-logger writes (~30 LOC across multiple sites)
- Drop telemetry-to-DB (~40 LOC of structured logs)

That's ~190 LOC of subtraction, offset by ~30 LOC of Anthropic streaming setup and ~20 LOC of Supabase REST adapter glue.

## Sub-phase plan (as committed in master plan Turn 3)

Phase 3a writes Stages 13 + 14a (streaming foundation) — replaces only the model call with Anthropic streaming. Other stages still go through existing `/api/chat` simple flow (feature-flag-gated).

Phase 3b adds Stage 14b (token accumulator) on chat-slice. No server change.

Phase 3c verifies streaming render in ConversationBubble. No new code, just confirmation.

Phase 3d adds Stages 11+12 (grounding, prompt stack), now wired to streaming. **At this point our brain stack composes the system prompt** for the new path.

Phase 3e adds remaining stages (1–10, 15) to complete the pipeline. **At this point the new path is full eva pipeline.**

Each sub-phase has a sanity check that runs on `npx tsx` before merging.

## Open questions for sign-off

1. **Intelligence in Stage 6:** I'm proposing we drop `maybeAutoAdvanceProjectWorkflow` and keep `buildProjectIntelligenceContext`. The intelligence context is what surfaces preference history into the system prompt. The auto-advance is what moves a conversation between workflow stages. Confirm both decisions.

2. **Cost tracking in Stage 14:** Eva writes per-request cost to Postgres (`recordCost`). I'm proposing in-memory tracking only for the foreseeable future. If you want cost data, we'd need a Supabase `chat_costs` table later. Confirm in-memory-only is OK.

3. **Recovery loop scope in Stage 14:** Eva tries 3 fallback models in sequence (`buildChatRecoveryGenerateTextModelQueue`). I'm proposing 1 fallback (Haiku) for v0.37.0 and we add a second tier later if needed. Saves ~50 LOC.

4. **Telemetry in Stage 14:** Eva logs structured events with shape `{ level, event, conversationId, ... }` to a `log()` helper that hits a logger service. Mine logs to `console.log` with the same shape. Same data, no service. Confirm.
