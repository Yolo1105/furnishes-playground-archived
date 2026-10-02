# Phase 0 — `chat-brain/` Directory Layout

> Final structure once all 5 turns ship. Each entry shows the source eva file (if any) and the turn it lands in.

```
src/lib/chat-brain/
├── README.md                         (Turn 1, new)
├── DROPPED.md                        (Turn 2, new — running log of cut functions)
│
├── core/                             (Turn 1)
│   ├── chat-http-header-names.ts     (PORT from core/chat-http-header-names.ts)
│   ├── chat-copy.ts                  (PORT from core/chat-copy.ts)
│   ├── chat-conversation-prompt.ts   (PORT from core/chat-conversation-prompt.ts)
│   ├── chat-generation-failure.ts    (PORT from core/chat-generation-failure.ts)
│   ├── response-length.ts            (PORT from core/response-length.ts)
│   ├── output-sanitize.ts            (PORT from core/output-sanitize.ts)
│   ├── cost-tracker.ts               (ADAPT from core/cost-tracker.ts — Anthropic pricing)
│   ├── domain-config.ts              (NEW — replaces eva/domain/config.ts; furnishes-studio voice)
│   ├── context-builder.ts            (PORT from core/context-builder.ts)            [Turn 2]
│   ├── critical-turn-extraction.ts   (PORT from core/critical-turn-extraction.ts)   [Turn 2]
│   └── guardrails.ts                 (PORT from core/guardrails.ts)                 [Turn 2]
│
├── post/                             (Turn 1 + Turn 3)
│   ├── chat-route-headers.ts         (PORT from chat/post/chat-route-headers.ts)
│   ├── chat-post-types.ts            (PORT from chat/post/chat-post-types.ts)
│   ├── build-chat-stream-response-headers.ts  (PORT from chat/post/.)
│   ├── validate-chat-post-request-stage.ts    (PORT, adapted to our request shape)  [Turn 3]
│   ├── handle-chat-post.ts           (PORT from chat/post/handle-chat-post.ts)      [Turn 3]
│   └── run-chat-post-pipeline.ts     (ADAPT — see 01-orchestrator-annotation.md)    [Turn 3]
│
├── request/                          (Turn 1)
│   └── parse-chat-request.ts         (ADAPT for our body shape)
│
├── failure/                          (Turn 1)
│   └── map-chat-generation-failure-to-surface.ts (PORT)
│
├── generation/                       (Turn 3)
│   ├── chat-stream-recovery-constants.ts          (PORT from chat/generation/.)
│   ├── build-chat-anthropic-stream-options.ts     (REWRITE — Anthropic, not OpenAI)
│   ├── run-chat-primary-fallback-stream-text.ts   (ADAPT — Sonnet→Haiku)
│   └── finalize-chat-output.ts                    (PORT from chat/generation/.)
│
├── attachments/                      (Turn 3)
│   ├── attachment-types.ts                        (PORT)
│   ├── attachment-readiness.ts                    (PORT)
│   ├── attachment-grounding-prompt.ts             (PORT)
│   ├── build-attachment-context.ts                (PORT)
│   ├── enrich-attachments-with-server-vision.ts   (ADAPT — Anthropic vision)
│   ├── resolve-chat-attachments.ts                (ADAPT to our ReferenceImage flow)
│   └── summarize-chat-attachments.ts              (PORT)
│
├── grounding/                        (Turn 3)
│   ├── build-chat-grounding.ts                    (PORT)
│   ├── build-chat-grounding-layers.ts             (ADAPT — 4 layers, not 6)
│   └── retrieval-grounding-prompt.ts              (STUB — returns empty until corpus exists)
│
├── conversation/                     (Turn 3)
│   └── resolve-chat-conversation-for-post.ts      (ADAPT — Supabase REST + chat-slice)
│
├── persistence/                      (Turn 3)
│   └── persist-chat-assistant-message.ts          (ADAPT — uses pushTurn from 0.34.0)
│
├── prompt/                           (Turn 2)
│   └── build-chat-system-prompt-stack.ts          (ADAPT — drop assistant + workflow layers)
│
├── studio/                           (Turn 2)
│   ├── normalize-chat-studio-snapshot.ts          (PORT)
│   └── snapshot-to-prompt.ts                      (NEW — replaces eva/studio/studio-snapshot-to-prompt.ts)
│
├── intelligence/                     (Turn 2)
│   ├── intelligence-constants.ts                  (PORT)
│   ├── project-memory-prompt.ts                   (PORT)
│   ├── project-intelligence-context.ts            (ADAPT — Zustand+Supabase reads)
│   ├── workflow-intelligence.ts                   (ADAPT — lightweight project-progress tracker)
│   └── recommendation-ranking.ts                  (PORT)
│
├── projects/                         (Turn 2)
│   ├── brief-snapshot.ts                          (PORT)
│   ├── project-events.ts                          (ADAPT — our Zustand actions)
│   └── build-project-summary.ts                   (PARTIAL PORT — see 02-decisions.md)
│
├── policy/                           (Turn 4)
│   ├── enforcement.ts                             (PORT)
│   └── intent-detector.ts                         (PORT)
│
├── feedback/                         (Turn 4)
│   └── implicit-signals.ts                        (PORT)
│
├── design-rules/                     (Turn 4)
│   ├── index.ts                                   (PORT)
│   ├── clearances.ts                              (PORT)
│   ├── layout-planner.ts                          (PORT)
│   └── rug-sizing.ts                              (PORT)
│
├── quality/                          (Turn 4)
│   └── recommendation-rubric.ts                   (PORT)
│
└── suggestions/                      (Turn 5)
    ├── build-suggestions.ts                       (NEW — uses brain to generate suggestion strings)
    └── suggestions-cache.ts                       (NEW — in-memory cache by snapshot hash)
```

Plus 1 utility outside the brain dir:
```
src/components/chat/utility/
└── last-user-message-text.ts  (PORT from eva-dashboard/chat/last-user-message-text.ts)   [Turn 1]
```

Plus new files outside chat-brain:
```
src/lib/store/
└── preferences-slice.ts         [Turn 2]    (NEW)

src/components/tools/
├── SuggestionsTab.tsx           [Turn 5]    (NEW — right-rail tab)
└── SuggestionsTabIcon.tsx       [Turn 5]    (NEW — small icon)
```

Plus API routes:
```
src/app/api/chat/route.ts                  [Turn 2 onward — feature-flagged]
src/app/api/suggestions/route.ts           [Turn 5]    (NEW)
```

## Naming convention

- **Eva-style filenames preserved** wherever the file ports cleanly. Makes cross-referencing the source obvious.
- **Renames:**
  - `build-chat-openai-stream-options.ts` → `build-chat-anthropic-stream-options.ts` (provider in name)
  - `eva-dashboard/chat/*` → `src/components/chat/utility/*` (eva-dashboard isn't a dir we're recreating)

## Files NOT being created

These files exist in eva but are **explicitly out of scope** for this migration. Listed for clarity:

- `lib/eva/playbook/*` — playbook state machine
- `lib/eva/assistants/*` — assistant catalog
- `lib/eva/design-workflow/*` — workflow stages
- `lib/eva/server/chat-generation-log.ts` — DB-backed cost & generation logger
- `lib/eva/core/cost-logger.ts` — DB writes (in-memory tracker stays)
- `lib/eva/core/openai.ts` — replaced by Anthropic in our stack
- `lib/eva/core/db.ts` — Prisma client; we use Supabase REST
- `lib/eva/core/logger.ts` — Sentry-backed; we use console
- Most of `lib/eva/projects/*` (only `brief-snapshot`, `project-events`, `build-project-summary` come over)
- `lib/eva/feedback/implicit-signals.ts` (Turn 4) — wait, this IS in scope. Check next paragraph.

## Verification: cross-check against the master plan

The master plan (Turn 1-5) says ~6,400 LOC across ~54 files. Counting the layout above:

| Turn | File count | Notes |
|---|---|---|
| Turn 1 | 14 files | Foundation utilities |
| Turn 2 | 16 files | Brain core + intelligence + projects |
| Turn 3 | 17 files | Streaming + attachments + grounding + orchestrator |
| Turn 4 | 7 files | Design rules + policy + feedback + quality |
| Turn 5 | 4 files | Suggestions UI + logic |
| **TOTAL** | **58 files** | + 1 README + 1 DROPPED.md = **60** |

Slightly above the 54-file estimate. The extras are the 2 docs (README, DROPPED) plus 4 new files (`domain-config.ts`, `snapshot-to-prompt.ts`, `preferences-slice.ts`, the 2 suggestions logic files). All net-new not-from-eva.

## Open questions for sign-off

1. **Path naming:** `src/lib/chat-brain/` vs `src/lib/eva/` (preserves eva's name) vs `src/lib/assistant/`. I'm proposing `chat-brain` to make the purpose obvious without trademarking another company's name. Confirm.

2. **Store slice colocation:** `preferences-slice.ts` lives in `src/lib/store/` alongside the other slices, NOT inside `chat-brain/`. The brain reads it but it's a store concern. Confirm.

3. **API route location:** `/api/chat` keeps its current path (replaces the existing route). `/api/suggestions` is new. Confirm.
