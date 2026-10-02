# Brain Migration — Turn Progress

Single source of truth for "what turn shipped, what comes next."

## v0.35.0 — Turn 1 — Foundation utilities (SHIPPED)

**Scope:** 14 leaf-level utility files copied from eva into `src/lib/chat-brain/`.

**Files added:**
- `core/chat-http-header-names.ts`
- `core/chat-copy.ts`
- `core/chat-conversation-prompt.ts`
- `core/chat-generation-failure.ts`
- `core/response-length.ts`
- `core/output-sanitize.ts`
- `core/cost-tracker.ts`
- `post/chat-route-headers.ts`
- `post/chat-post-types.ts`
- `post/build-chat-stream-response-headers.ts`
- `request/parse-chat-request.ts`
- `failure/map-chat-generation-failure-to-surface.ts`
- `generation/chat-stream-recovery-constants.ts`
- `src/components/chat/utility/last-user-message-text.ts`

**Behavior change:** None. None of these files are imported by anything yet.
Existing `/api/chat` flow unchanged.

**Sanity check:** Turn 1 sanity script passed (see TURN_PROGRESS_TURN_1_CHECK
section below).

**Adaptations from eva:**
- `cost-tracker.ts`: Prisma-backed `recordCost()` replaced with in-memory
  Map + global daily counter. Phase 0 doc 01 question 2 noted this trade-off.
- `parse-chat-request.ts`: dropped `assistantId` (no assistant catalog),
  loosened `attachments` and `studioSnapshot` types pending Turn 3 / Turn 2.
  Added `mode` and `actionsAllowed` fields for Turn 4's Ask mode.
- `chat-post-types.ts`: dropped `AssistantDefinition`, defined
  `ChatGenerationLogContext` inline (eva had it in a server-only module).
- `build-chat-stream-response-headers.ts`: defined `RetrievalQualityLevel`
  and `AttachmentGroundingSummary` inline rather than importing from eva
  modules that don't exist in our tree.
- `chat-route-headers.ts`: `getMaxMessageLength()` reads env var or default
  10000 instead of from a domain config (Turn 2 will swap to domain config).
- `last-user-message-text.ts`: walks our `ConversationTurn[]` shape instead
  of eva-dashboard's flat `ChatMessage[]`.

**Identical ports (no adaptation):**
- `chat-http-header-names.ts`, `chat-copy.ts`, `response-length.ts`,
  `output-sanitize.ts`, `chat-conversation-prompt.ts`,
  `chat-generation-failure.ts`, `chat-stream-recovery-constants.ts`,
  `map-chat-generation-failure-to-surface.ts`.

**Feature flags introduced:** None yet (Turn 1 has no behaviour to gate).

**Schema bumps:** None.

**Rollback:** Delete `src/lib/chat-brain/` and
`src/components/chat/utility/last-user-message-text.ts`. Nothing imports
them; the rest of the app is unchanged.
## v0.36.0 — Turn 2 — Brain core (SHIPPED)

**Scope:** brain core wired behind `ENABLE_BRAIN_PIPELINE` flag.

**Phases shipped:**
- 2a — Studio snapshot serializer (40/40 sanity)
- 2b — Preferences slice + schema 3.2.0 → 3.3.0 migration (20/20)
- 2c — Intelligence + extraction (37/37) — Risk 4 mitigation: every
  preference carries verbatim sourceText + confidence + thresholded
  status
- 2d — Prompt stack assembled (35/35) — 9-layer system prompt
- 2e — `/api/chat` brain branch (17/17)

**149/149 cumulative sanity checks passed.**

**Files added:**
- `core/domain-config.ts` — pinned designer voice (replaces eva's
  runtime-loaded JSON)
- `core/guardrails.ts` — injection patterns + buildSafeSystemPrompt
- `core/critical-turn-extraction.ts` — same-turn fact regex
- `core/context-builder.ts` — token-aware history trim
- `studio/studio-snapshot-schema.ts` — Zod schema for the snapshot
- `studio/snapshot-to-prompt.ts` — designer-style block
- `studio/normalize-chat-studio-snapshot.ts` — request validator
- `intelligence/intelligence-constants.ts`
- `intelligence/preference-extractor.ts` — rule-based extractor with
  source attribution + confidence scaling + contradiction detection
- `intelligence/project-memory-prompt.ts` — preferences→prompt block
- `intelligence/project-intelligence-context.ts` — slim 140-LOC
  replacement for eva's 837-LOC build-project-summary
- `prompt/build-chat-system-prompt-stack.ts` — central assembly
- `src/lib/store/preferences-slice.ts` — schema 3.3.0 slice
- `src/app/api/chat/route.ts` — branched on `ENABLE_BRAIN_PIPELINE`

**Adaptations from eva (logged in DROPPED.md):**
- Dropped: project-events.ts (no event sourcing infra)
- Dropped: recommendation-ranking.ts (no product catalog)
- Dropped: workflow-intelligence.ts (no workflow stages)
- Partial: build-project-summary.ts → 140 LOC trimmed version

**Feature flags introduced:** `ENABLE_BRAIN_PIPELINE` (default: off).

**Schema bumps:** 3.2.0 → 3.3.0. Migration covers 3.3.0→3.3.0,
3.2.0→3.3.0, 3.1.0→3.3.0, legacy→3.3.0 paths.

**Rollback:** Set `ENABLE_BRAIN_PIPELINE` unset (or `0`/`false`) in
the env. Brain branch dormant; legacy chat path runs as before.

## v0.37.0 — Turn 3 — Streaming + vision + pipeline (SHIPPED)

**Scope:** SSE streaming end-to-end, vision pass via reference image,
attachment system (URL + base64), failure-taxonomy wiring, schema bump.

**Phases shipped:**
- 3a — Server SSE streaming pump (13/13 sanity)
- 3b — Vision attachments + reference-image auto-promotion (20/20)
- 3c — Client SSE consumer (9/9)
- 3d — Pump end-to-end with mock Anthropic — exercises 5 branches:
  clean stream, empty→recovery, HTTP error→recovery, both-fail→final
  failure, malformed SSE tolerance (17/17)

**274/274 cumulative sanity checks across Turns 1–3.**

**Files added:**
- `generation/wire-events.ts` — simplified 3-event protocol (delta/done/error)
- `generation/anthropic-stream.ts` — direct fetch + SSE parser + non-streaming
  recovery call
- `generation/stream-pump.ts` — orchestrator: primary streaming, recovery on
  empty/throw, classified failures
- `generation/build-stream-response.ts` — assembles streaming Response with
  X-Chat-* headers
- `attachments/chat-attachment.ts` — Zod schema for URL + base64 image
  attachments, prompt-block formatter, Anthropic content-block converter

**Files modified:**
- `src/app/api/chat/route.ts` — brain branch streams; auto-promotes
  `studioSnapshot.referenceImageUrl` into the attachments array when
  HTTPS-fetchable
- `src/lib/chat-brain/prompt/build-chat-system-prompt-stack.ts` — added
  attachments layer (4.5) between studio context and project memory
- `src/lib/store/chat-slice.ts` — Content-Type-aware fetch handler;
  reads SSE stream when `text/event-stream`, falls back to JSON otherwise
- `src/lib/persistence/snapshot.ts` — schema 3.3.0 → 3.4.0 with
  `attachmentGrounding` optional field; defensive default for missing
  `preferences` on 3.3.0 → 3.4.0 path

**Adaptations from eva (logged in DROPPED.md):**
- Streaming pump slimmed to ~830 LOC from eva's ~2000 LOC orchestrator
- Multi-model fallback dropped (Sonnet 4.6 only)
- RAG retrieval grounding dropped (no retrieval layer)

**Feature flags introduced:** none new — existing `ENABLE_BRAIN_PIPELINE`
gates streaming + vision together.

**Schema bumps:** 3.3.0 → 3.4.0 (adds optional `attachmentGrounding` to
`ConversationTurn`). Migration covers 3.4.0→3.4.0 passthrough,
3.3.0→3.4.0 (with defensive `preferences:[]` default), 3.2.0→3.4.0
chained, 3.1.0→3.4.0 chained, legacy→3.4.0.

**Behaviour change when flag is on:**
- Replies stream word-by-word into the dock instead of arriving at once
- No more 500-char reply cap (the JSON envelope is gone)
- Reference images on the snapshot get attached to vision automatically
- Failure modes properly classified (X-Chat-Generation-Failure header)
- X-Chat-* observability headers populated for the first time

**Rollback:** Set `ENABLE_BRAIN_PIPELINE` unset (or `0`/`false`).
Brain branch dormant; legacy JSON path runs as before, byte-identical
to 0.34.1+.

## v0.38.0 — Turn 4 — Design rules + Ask-mode policy (SHIPPED)

**Scope:** Per-mode policy enforcement + curated design-rules layer.

**Phases shipped:**
- 4a — Mode policy module (24/24 sanity)
- 4b — Design-rule library + selector (24/24)
- 4c — Prompt stack wiring with new layers 4.7 + 8.5 (18/18)

**340/340 cumulative sanity checks across Turns 1–4. Zero regressions.**

**Files added:**
- `core/mode-policy.ts` — per-mode prompt directives (Ask vs Interior
  Design vs Furniture vs Room Layout); `modeAllowsActions()` predicate
  for future structured-action gating
- `design-rules/design-rule-library.ts` — 6 hand-written rules with
  scene+message selectors:
  - Walkway clearance (75-90cm minimum between major furniture)
  - Door swing zones (90cm clear arc)
  - TV viewing distance (2-3x screen diagonal)
  - Bed-against-wall preference
  - Window sightlines (don't block tall furniture)
  - Conversational seating grouping (~2.5m, angled toward each other)
- `design-rules/select-design-rules.ts` — selector + formatter +
  convenience builder; cap at 4 rules per turn

**Files modified:**
- `src/lib/store/types.ts` — `Mode` union extended to include `"Ask"`
- `src/lib/chat-brain/prompt/build-chat-system-prompt-stack.ts` —
  Layer 4.7 (design rules between attachments and project memory),
  Layer 8.5 (mode policy between recommendation voice and scope footer)
- `src/app/api/chat/route.ts` — reads `mode` from request body with
  validation against the allowed set; passes through to prompt stack
- `src/lib/store/chat-slice.ts` — `mode` surfaced at top level of
  brain payload (also retained in studioSnapshot for compatibility)

**Adaptations from eva (logged in DROPPED.md):**
- Design rules slimmed to 6 hand-written from eva's ~50; selectors are
  keyword + scene-state only (no raycast / polygon math)
- Intent detection beyond compare deferred (model handles it naturally)
- Structured action proposals deferred (own feature with own schema bump)

**Feature flags introduced:** none. All Turn 4 layers are gated by the
existing `ENABLE_BRAIN_PIPELINE` flag and slot into the prompt stack
which only fires on the brain branch.

**Schema bumps:** none. The `mode` field already existed in the request
schema (added prophylactically in Turn 1); Turn 4 just consumes it. No
persistent fields added.

**Behaviour change when flag is on:**
- Selecting "Ask" mode produces a visibly different system prompt:
  the model describes trade-offs and reasoning rather than proposing
  specific changes
- Layout questions in scenes with multiple pieces get walkway-clearance
  grounding ("75-90cm between major pieces")
- Door-related questions in scenes with doors get the 90cm clearance arc
- TV-related questions in scenes with a TV get the 2-3x viewing-distance
  guidance
- Other modes (Interior Design, Furniture, Room Layout) get permissive
  framing matching their intent

**Rollback:** Same as prior turns — `ENABLE_BRAIN_PIPELINE` unset
reverts to the legacy JSON path which is byte-identical to 0.34.1+.

## v0.39.0 — Turn 5 — Suggestions tab (SHIPPED) — MIGRATION COMPLETE

**Scope:** Proactive design suggestions feature. Manual trigger,
modal UI, server-side daily cap, streaming card layout.

**Phases shipped:**
- 5a — Suggestions system prompt builder + scene-only design-rule
  selector for review contexts (25/25 sanity)
- 5b — Server-side daily cap with UTC-midnight reset (22/22)
- 5c — `/api/suggestions` endpoint reusing chat-brain pump (24/24)
- 5d — Suggestions store slice + parser + payload builder (27/27)
- 5e — Modal UI + topbar button + Ask mode config + SparkleIcon

**438/438 cumulative sanity checks across Turns 1–5. Zero regressions.**

**Files added:**
- `src/lib/chat-brain/suggestions/build-suggestions-system-prompt.ts`
  — proactive-observer voice + `### Suggestion N:` output format
- `src/lib/chat-brain/suggestions/daily-cap.ts` — in-memory counter
  with UTC midnight reset; configurable via `BRAIN_SUGGESTIONS_DAILY_CAP`
- `src/app/api/suggestions/route.ts` — POST streams via the same
  builder used for chat; GET returns remaining-today without consuming
- `src/lib/store/suggestions-slice.ts` — slice with state, actions,
  parser, SSE consumer
- `src/lib/store/suggestions-payload.ts` — request body builder
- `src/components/suggestions/SuggestionsModal.tsx` — full modal with
  cards, regenerate button, counter, all states

**Files modified:**
- `src/lib/chat-brain/design-rules/select-design-rules.ts` — added
  `selectAllApplicableDesignRules` + `buildSceneReviewDesignRulesBlock`
  for scene-only rule selection (used by suggestions)
- `src/lib/store/index.ts` — registered `SuggestionsSlice`
- `src/lib/store/ui-flags-slice.ts` — `suggestionsModalOpen` state +
  `setSuggestionsModalOpen` setter
- `src/lib/chat/modeConfig.ts` — added `Ask` mode entry to
  `Record<Mode, ModeConfig>` (was missing since Turn 4's union update)
- `src/components/icons.tsx` — added `SparkleIcon` for the topbar button
- `src/components/topbar/TopBar.tsx` — added Suggestions button before Help
- `src/components/studio/Studio.tsx` — mounted `SuggestionsModal`

**Adaptations from eva (logged in DROPPED.md):**
- Manual trigger only — auto-trigger on scene change deferred (every
  drag-drop would cost a model call)
- No persistence — refreshing the page wipes suggestions; re-generation
  is one click; persistence would mean a schema bump for marginal gain
- Per-server cap — we don't have user accounts; when they land,
  swap the keying
- No suggestion-to-action conversion — needs structured-actions feature
  deferred from Turn 4
- No ranking / feedback — needs ingestion pipeline we don't have
- No stale-scene badge — user controls regeneration with a "last
  generated N minutes ago" timestamp

**Feature flags introduced:** `BRAIN_SUGGESTIONS_DAILY_CAP` env var
(default 50; set to 0 to disable the cap). The endpoint itself is
gated by the existing `ENABLE_BRAIN_PIPELINE` flag.

**Schema bumps:** none. Suggestions are in-memory only.

**Behaviour change when flag is on:**
- A new SparkleIcon button appears in the top bar before the Help button
- Clicking it opens a modal with a "Generate" button + counter
- Clicking Generate streams 3-5 design observations as cards; each
  card shows a streaming cursor while its body arrives
- Cards are anchored in scene specifics — walkway widths, door swing
  zones, viewing distances, conversational seating, etc. (the same
  design rules from Turn 4, but selected via scene state alone)
- When the daily cap is hit, the modal shows a friendly message
  ("you've used today's suggestions budget") instead of failing hard
- Counter ("X / 50 today") updates live from response headers

**Rollback:** Same as prior turns — `ENABLE_BRAIN_PIPELINE` unset
reverts to the legacy JSON path. The Suggestions modal still opens
but Generate produces a "brain pipeline disabled" error message.

---

# 🎉 Migration complete

After 5 turns spanning 17 phases and 438 sanity checks, the chat
brain migration is complete. The eva chatbot is now a furnishes-
studio chat brain with:

- **Layered prompt assembly** (Turns 1-2): 11 conditional layers
  composing a system prompt grounded in studio context, preferences,
  recent conversation, design rules, and mode discipline
- **Streaming generation** (Turn 3): primary SSE stream + non-streaming
  recovery; vision via auto-promoted reference image; full failure
  taxonomy with X-Chat-* observability headers
- **Mode discipline + design rules** (Turn 4): Ask mode is read-only
  Q&A; 6 curated design principles fire conditionally on scene state
- **Proactive suggestions** (Turn 5): a tab where the brain reviews
  the user's space and surfaces 3-5 prioritized observations

Everything is gated by `ENABLE_BRAIN_PIPELINE`. Setting it unset
reverts to the legacy JSON path which is byte-identical to 0.34.1.

Future work that builds on this foundation but isn't part of the
migration (logged in DROPPED.md):
- **Structured action proposals** — the brain emits typed move/rotate
  commands the client renders as "Apply this change" buttons
- **Auto-trigger suggestions** on scene dwell or major edits
- **Persisted suggestion history** per project (requires schema bump)
- **Per-user daily caps** when user accounts land
- **Eva's full design-rule library** (~50 rules) including those
  needing geometric helpers (raycast for sight-lines, polygon
  intersection for traffic-flow)
- **Multi-model fallback** when a primary model is degraded
- **Eva's intent-detection layer** (ask/recommend/refine voice tiers)
  if measurement shows it improves output quality

These are self-contained features layered on top of the brain, not
extensions of the migration. The migration is done.

## v0.39.1 — Post-migration audit cleanup (SHIPPED)

After the 5-turn migration completed, a full audit pass examined every
added/modified file for redundancy, duplicates, hardcoded values, and
overlap. **11 distinct issues found**, including one real bug.

### The real bug (issue #6)

`isBrainEnabled()` had drifted across the two routes:
- `chat/route.ts` accepted `"1"`, `"true"`, `"yes"` (case-sensitive)
- `suggestions/route.ts` accepted `"1"`, `"true"` / `"True"` / `"TRUE"`
  (case-insensitive on `true`), but **didn't accept `"yes"`**

A single env value could enable one path but not the other. Now both
go through one canonical helper accepting `1`/`true`/`yes`
case-insensitively (with whitespace tolerance).

### What got consolidated

5 new shared helpers in `src/lib/chat-brain/`:
- `core/brain-flag.ts` — canonical `isBrainEnabled()`
- `core/anthropic-model.ts` — `BRAIN_ANTHROPIC_MODEL` constant
- `core/request-ids.ts` — `generateChatRequestId()`,
  `generateSuggestionsRequestId()`, `generateUserMessageId()`,
  parameterized `generateRequestId(prefix)`
- `core/scene-summary.ts` — `buildSceneSummary()` shared by both
  payload builders so the model can't see inconsistent summaries
- `generation/wire-stream-consumer.ts` — `decodeWireRecord()` and
  `consumeChatBrainStream()` for client-side SSE consumption

### What got removed

- `src/lib/chat-brain/DROPPED.md` — stale 3.3KB duplicate of the
  canonical 14KB version at `docs/chat-brain-migration/DROPPED.md`
- `src/lib/chat-brain/telemetry/` — orphan 81-LOC `buildEarlyFailureResponse`
  + `newChatRequestId` that were never imported anywhere
- ~100 LOC of inline SSE consumer + decoder in `chat-slice.ts`
- ~60 LOC of duplicated SSE plumbing in `suggestions-slice.ts`
- Local `isBrainEnabled` in chat/route.ts and suggestions/route.ts
- Local `generateChatRequestId` / `generateUserMessageId` in chat/route.ts
- Inline ID generation strings in suggestions/route.ts
- Dead defensive `?? SUGGESTIONS_TRIGGER_MESSAGE` fallback (the
  fallback was unreachable — `triggerMessage` is always set)

### Net effect

| Metric | Before audit | After audit |
|---|---|---|
| Duplicated functions across files | 5 | 0 |
| Hardcoded model strings in brain code | 2 | 1 (canonical constant) |
| Divergent `isBrainEnabled` impls | 2 | 1 (canonical) |
| Dead code in chat-brain dir | ~85 LOC | 0 |
| Stale doc files in source tree | 1 | 0 |
| Sanity checks across all surfaces | 462 | 501 |

The new shared helpers carry their own sanity script
(`audit_consolidation_sanity.ts` — 39 checks) covering: every accepted
+ rejected `isBrainEnabled` value, ID-gen prefix correctness +
uniqueness, scene-summary formatting edge cases (singular vs. plural,
missing roomMeta), SSE decoder edge cases (empty / comment / malformed
/ unknown event type), and `consumeChatBrainStream` partial-chunk
reassembly + abort-signal propagation.

**501/501 cumulative sanity checks. Zero regressions on any prior
turn's tests.**
