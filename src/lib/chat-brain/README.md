# `src/lib/chat-brain/`

This directory contains the chat brain: prompt-stack assembly, intelligence
(preferences memory + studio context), streaming pipeline, attachments,
design rules, mode policy, and suggestions.

## Status

**Migration complete.** All 5 turns shipped; 462/462 cumulative sanity
checks passing.

| Turn | Version | Scope | Status |
|---|---|---|---|
| Turn 1 | v0.35.0 | Foundation utilities | ✅ shipped |
| Turn 2 | v0.36.0 | Brain core: prompt stack + intelligence + studio context | ✅ shipped |
| Turn 3 | v0.37.0 | Streaming + vision + pipeline | ✅ shipped |
| Turn 4 | v0.38.0 | Design rules + Ask-mode policy | ✅ shipped |
| Turn 5 | v0.39.0 | Suggestions feature | ✅ shipped |

See `docs/chat-brain-migration/TURN_PROGRESS.md` for the per-turn
ship notes.
See `docs/chat-brain-migration/DROPPED.md` for eva subsystems we
chose not to port.

## Final tree (v0.39.0)

```
core/
├── chat-http-header-names.ts      Header name constants
├── chat-copy.ts                    Failure copy + classifiers
├── chat-conversation-prompt.ts     Compare/options voice nudges
├── chat-generation-failure.ts      Failure taxonomy + telemetry
├── response-length.ts              Adaptive length hints
├── output-sanitize.ts              Strict + lenient sanitizer
├── cost-tracker.ts                 In-memory cost tracker
├── domain-config.ts                Designer voice + limits
├── guardrails.ts                   Injection patterns
├── critical-turn-extraction.ts     Same-turn fact regex
├── context-builder.ts              Token-aware history trim
└── mode-policy.ts                  Per-mode prompt directives

post/
├── chat-route-headers.ts           Re-exports + getMaxMessageLength
├── chat-post-types.ts              Pipeline-stage unions
└── build-chat-stream-response-headers.ts

request/
└── parse-chat-request.ts           POST body Zod schema

failure/
└── map-chat-generation-failure-to-surface.ts

generation/                         SSE streaming
├── chat-stream-recovery-constants.ts
├── wire-events.ts                  3-event protocol (delta/done/error)
├── anthropic-stream.ts             SSE parser + non-streaming recovery
├── stream-pump.ts                  Primary + recovery orchestrator
└── build-stream-response.ts        Streaming Response builder

attachments/                        Vision
└── chat-attachment.ts              URL + base64 attachments + prompt block

design-rules/                       Domain knowledge
├── design-rule-library.ts          6 curated rules with selectors
└── select-design-rules.ts          Selector + formatter + builder
                                     (chat + scene-only review modes)

suggestions/                        Proactive feature
├── build-suggestions-system-prompt.ts   Proactive voice + format
└── daily-cap.ts                          UTC-midnight reset, soft fail

studio/                             Studio context
├── studio-snapshot-schema.ts       Inbound snapshot Zod schema
├── snapshot-to-prompt.ts           Scene → designer-style block
└── normalize-chat-studio-snapshot.ts

intelligence/                       Preferences memory
├── intelligence-constants.ts       Cap sizes + thresholds
├── preference-extractor.ts         Rule-based extractor + contradictions
├── project-memory-prompt.ts        Preferences → prompt block
└── project-intelligence-context.ts Slim build-project-summary replacement

prompt/
└── build-chat-system-prompt-stack.ts   System prompt assembly with
                                         all layers
```

Plus elsewhere in the repo:
- `src/lib/store/preferences-slice.ts` — schema 3.4.0 slice
- `src/lib/store/suggestions-slice.ts` — in-memory suggestions state
- `src/lib/store/suggestions-payload.ts` — request body builder
- `src/app/api/chat/route.ts` — streaming brain path; opt out via
  `ENABLE_BRAIN_PIPELINE=false`
- `src/app/api/suggestions/route.ts` — POST streams + GET probes
- `src/lib/store/chat-slice.ts` — Content-Type-aware fetch with SSE consumer
- `src/lib/store/types.ts` — `Mode` union includes `"Ask"`
- `src/components/suggestions/SuggestionsModal.tsx` — modal UI
- `src/components/topbar/TopBar.tsx` — SparkleIcon button
- `src/components/icons.tsx` — `SparkleIcon` four-point star

## How to use it

The brain is **on by default**. Only set the flag to opt out:

```
ANTHROPIC_API_KEY=sk-ant-...
# ENABLE_BRAIN_PIPELINE=false   # opt out
BRAIN_SUGGESTIONS_DAILY_CAP=50    # optional; default 50
```

Then:
- **Chat**: replies stream into the dock. Mode dropdown drives behavior
  (Ask = read-only Q&A; Interior Design = full design conversation;
  Furniture / Room Layout = generation-aware framing). Reference images
  on the snapshot get vision-attached automatically. Design rules fire
  on relevant layout questions.
- **Suggestions**: click the SparkleIcon button in the top bar.
  Click Generate to see 3-5 streaming cards grounded in your scene.

When the flag is OFF (`false` / `0` / `no` / `off`), chat and
suggestions return 503. There is no legacy JSON chat path.

## Sanity checks

Each phase ships with its own sanity script. Cumulative across all 5
turns: **462/462 checks passed.**

Per-phase counts:
- Turn 1: 62/62 (foundation utilities)
- Phase 2a: 40/40 (studio snapshot)
- Phase 2b: 24/24 (preferences + migration through 3.4.0)
- Phase 2c: 37/37 (intelligence + extraction)
- Phase 2d: 35/35 (prompt stack assembly)
- Phase 2e: 17/17 (route wiring)
- Phase 3a: 13/13 (wire events + SSE)
- Phase 3b: 20/20 (vision + auto-promotion)
- Phase 3c: 9/9 (client SSE consumer)
- Phase 3d: 17/17 (pump end-to-end with mock Anthropic)
- Phase 4a: 24/24 (mode policy directives)
- Phase 4b: 24/24 (design-rule library + selector)
- Phase 4c: 18/18 (prompt-stack wiring with new layers)
- Phase 5a: 25/25 (suggestions prompt builder)
- Phase 5b: 22/22 (daily cap)
- Phase 5c: 24/24 (suggestions endpoint)
- Phase 5d: 27/27 (parser + payload builder)
- Phase 5e: 24/24 (UI wiring at data-flow level)

## What's next (post-migration)

Future feature work that builds on the brain but isn't part of the
migration (logged in `DROPPED.md`):

- **Structured action proposals** — the brain emits typed move/rotate
  commands the client renders as "Apply this change" buttons
- **Auto-trigger suggestions** on scene dwell or major edits
- **Persisted suggestion history** per project (requires schema bump)
- **Per-user daily caps** when user accounts land
- **Eva's full design-rule library** (~50 rules) including geometric
  ones (raycast for sight-lines, polygon intersection for traffic-flow)
- **Multi-model fallback** when a primary model is degraded
- **Eva's intent-detection layer** (ask/recommend/refine voice tiers)
  if measurement shows it improves output quality

These are self-contained features layered on top of the brain, not
extensions of the migration.
