# Dropped subsystems

This document logs eva subsystems that were considered for migration but
intentionally NOT ported to furnishes-studio. Each entry explains the
prerequisite that's missing and what would need to land first to revisit
the decision.

## `lib/eva/projects/project-events.ts`

**What it does in eva:** Event sourcing for project state changes. Records
every `preferred_direction_changed`, `shortlist_updated`, `comment_created`,
`approval_requested`, etc. into a `ProjectTimelineEvent` Postgres table,
with downstream fan-out to in-app notifications for project members.

**Why dropped:**
- We have no Prisma / Postgres event-sourcing infrastructure. Persistence
  is local-IDB + Supabase row-level (each row a snapshot, not an event log).
- We have no multi-user roles, no project membership, no approvals, no
  comments thread. The fan-out logic targets all of those.
- The function exports map to ProjectEventType / ProjectTimelineKind enums
  that come from Prisma's generated client. We don't generate Prisma types.

**What it would take to revisit:** Add a Supabase `project_events` table,
introduce membership + approvals data model (~8 new tables), and decide
whether real-time notifications need WebSocket fan-out (we have none today).
The combination is multiple weeks of work.

**Rollback path if we DO want it later:** Port the file to read/write
Supabase rows instead of Prisma; rewrite `fanOutInAppNotifications` to
post to a yet-unbuilt notifications table; collapse the legacy
`ProjectTimelineKind`→`ProjectEventType` mapping (no legacy data to
preserve).

## `lib/eva/intelligence/recommendation-ranking.ts`

**What it does in eva:** Deterministic scorer that ranks
`NormalizedRecommendationItem[]` (e-commerce SKU records) against a
`ProjectIntelligenceContext`. Uses constraint matching, preferred-path
overlap, decision-context hints, artifact title similarity, shortlist
diversity penalties.

**Why dropped:**
- We have no `NormalizedRecommendationItem` type — eva's recommendations
  come from a curated SKU catalog with categories, prices, vendor data.
  We don't have that catalog or any plans to build one.
- The `ProjectIntelligenceContext` we use is a stripped-down version
  (preferences + recent turns + scene summary). The fields the ranker
  reads (`comparisonPathCount`, `highlightedArtifacts`, etc.) don't
  exist in our context.

**What it would take to revisit:** Build a product catalog (data
collection + curation tooling + pricing pipeline). Roughly the work of
turning furnishes-studio into a marketplace.

**Note:** Turn 5's "Suggestions tab" is a *different* feature — it asks
the model to suggest design ideas, not to rank shoppable products. No
ranker needed.

## `lib/eva/intelligence/workflow-intelligence.ts`

**What it does in eva:** Refines a `WorkflowEvaluation` (output of the
design-workflow stages subsystem) by layering project-state hints onto
it: "Intent: compare → ground answers in saved comparison paths",
"Project state suggests you can progress: preferred direction is set",
etc.

**Why dropped:**
- We have no design-workflow stages subsystem. Eva ships an `intake`,
  `clarify`, `design`, `select`, `execute` workflow with stage
  transitions, evaluation, and gating. We have a chat dock and a
  generation pipeline — no formal stages.
- `WorkflowEvaluation` is a 30-field type produced by code we don't
  port (it depends on `evaluateProjectWorkflow`, which depends on
  `Project.workflowSatisfied`, `Project.workflowStage`, and a chain of
  helpers totaling ~1500 LOC).

**What it would take to revisit:** Decide whether furnishes-studio
benefits from formal workflow stages. If yes, port `design-workflow/`
(~1500 LOC) first; this file then drops in cleanly.

**Note:** The `WORKFLOW_INTELLIGENCE_LAYER_COPY` strings are imported
into `intelligence-constants.ts` for documentation purposes — if a
future Turn brings back lightweight intent-tagging without full
workflow stages, the copy is ready.

## Partial: `lib/eva/projects/build-project-summary.ts` (837 LOC)

**Status:** Partial port. We took the **shape** (a function that
assembles a project's full state into a summary object the prompt
reads) but built our own ~140-line version focused on what we
actually have: scene state + preferences + recent turns. Eva's
837-line version assembles 20+ fields including shortlist items,
artifacts, decision context, recommendations snapshot, workflow
evaluation, blockers, comments — all of which depend on subsystems we
don't have.

**The slim version lives in:** `intelligence/project-intelligence-context.ts`.

**What's missing vs eva (intentionally):**
- `briefLines` — eva's structured intake form. We don't have an intake
  form; preferences come from chat extraction instead.
- `decisionNotes`, `preferredDirectionLabel`, `comparisonPaths` — all
  decision-context state.
- `highlightedArtifacts`, `favoriteArtifactIds` — file management.
- `shortlistProductNames` — e-commerce.
- `workflowStage`, `workflowEvaluation` — workflow stages.
- `recommendationsSnapshotSummary` — recommendation system.

If any of these subsystems land later, extending the context type
+ formatter is straightforward (~5 LOC each).

## Turn 3 — eva pipeline orchestrator (partial)

**What it is in eva:** ~2000 LOC across `lib/eva/chat/streaming/`,
`lib/eva/chat/pipeline/`, `lib/eva/chat/grounding/`, plus model-fallback
logic that routes between primary/fallback Anthropic + OpenAI calls.
Handles RAG retrieval grounding, comparison-path workflow gates,
shortlist-aware ranking, and approval / handoff hooks.

**What we ported (~830 LOC):**
- `generation/anthropic-stream.ts` — direct fetch + SSE parser
- `generation/stream-pump.ts` — primary-then-recovery orchestration
- `generation/build-stream-response.ts` — Response builder with X-Chat-* headers
- `generation/wire-events.ts` — simplified 3-event protocol (delta/done/error)

**What we skipped (still dropped):**
- Multi-model fallback (we use Sonnet 4.6 only)
- RAG retrieval grounding (no retrieval layer)
- Comparison-path workflow gates (no workflows)
- Shortlist-aware ranking (no shortlist)
- Approval / handoff hooks (no multi-user features)

The slimmed pump retains the pieces that matter for our scope
(streaming with empty-output recovery + failure taxonomy) and drops
features tied to subsystems we don't have. If retrieval / multi-model
later land, the pump's strategy section grows two more tiers.

## Turn 4 — eva design-rules subsystem (partial)

**What it is in eva:** ~50 design rules across `lib/eva/design-rules/`
sub-modules: clearance, sight-lines, lighting, traffic-flow, ergonomics,
pet-friendly, accessibility, etc. Each rule has a selector that often
depends on geometric helpers (raycast for sight-lines, polygon
intersection for traffic-flow, anthropometric tables for ergonomics).

**What we ported (~200 LOC):**
- 6 hand-written rules covering high-leverage interior-design knowledge:
  walkway clearance, door swing, TV viewing distance, bed-against-wall,
  window sightlines, conversation grouping
- Simple keyword + scene-state selectors (no raycast / polygon math)
- Cap of 4 rules per turn

**What we skipped (still dropped):**
- Sight-line rules requiring raycast (we have no raycast helper)
- Traffic-flow rules requiring polygon intersection (no helper)
- Lighting analysis rules (no light-source classification in our scene)
- Ergonomics tables (anthropometric data not ported)
- Pet/accessibility rules (specialized; can add when users ask for them)

The selector philosophy is conservative — high precision, lower recall.
A user asking about a subtle layout issue might get 0 design rules and
fall back on the model's training-data knowledge. That's better than 4
rules that don't fit. Adding more rules later is appending objects to
`DESIGN_RULES`; the selector + formatter pick them up automatically.

## Turn 4 — eva intent-detection subsystem (deferred)

**What it is in eva:** A `classifyUserIntent` function that returns one
of `ask|compare|recommend|refine`, used to route prompts through different
voice tiers and to gate workflow stage transitions.

**Why deferred:**
- Eva's intent layer is most useful because eva has workflow stages that
  gate on intent. We don't.
- The model already adapts to "what is X" vs "compare X to Y" vs "recommend
  something" naturally without an explicit classifier.
- Our existing `appendCompareIntentGuidance` (Turn 1) covers the one
  intent that demonstrably benefits from explicit handling.

If a future Turn shows that ask/recommend/refine voice tiers give
measurable improvements, the eva function is ~30 LOC and ports cleanly.

## Turn 4 — structured action proposals (deferred)

**What it is:** A wire-event extension where the brain emits typed
move/rotate/replace commands the client renders as "Apply this change"
buttons. The user reviews and confirms before state mutation.

**Why deferred:**
- Requires a new wire event type alongside delta/done/error
- Requires a Zod schema for the action vocabulary
- Requires client UI to render buttons + apply state mutations + undo
- Requires confirmation patterns
- Half-shipping this would be worse than not shipping it

If we want this later, it's a self-contained feature with its own
schema bump (adding an `actions: ActionProposal[]` field to
`ConversationTurn`). Not blocked on any current Turn 4 work.

## Turn 5 — eva suggestions subsystem (partial)

**What it is in eva:** A multi-feature suggestions subsystem with
auto-trigger on scene change, persisted suggestion history per
project, per-user daily caps tied to user accounts, suggestion-to-
action conversion (clicking a suggestion opens an edit modal),
ranking based on user feedback (thumbs up/down), and a "scene
changed" badge that flags stale suggestions.

**What we ported (~880 LOC):**
- Manual-trigger suggestions endpoint reusing the chat-brain pump
- Server-side daily cap (in-memory, UTC midnight reset, soft fail)
- A modal UI with cards, regenerate button, "X / 50 today" counter,
  loading/empty/error states, streaming cursor
- Card-streaming parser that splits on `### Suggestion N:` boundaries
- Reused all of Turns 1-4: scene context, design rules (with new
  scene-only selector), preferences memory, prompt-stack assembly,
  SSE streaming pump, failure taxonomy

**What we skipped (still dropped):**
- **Auto-trigger on scene change** — every drag-drop costs a model
  call; manual trigger respects user intent and bounds spend
  predictably
- **Persisted suggestion history** — would require a schema bump and
  migration burden for marginal UX gain (re-generation is one click)
- **Per-user daily caps** — we don't have user accounts; the cap is
  per-server. When accounts land, swap the keying
- **Suggestion-to-action conversion** — needs the structured-actions
  feature deferred from Turn 4
- **Ranking based on user feedback** — needs a feedback ingestion
  pipeline + per-user history we don't have
- **Stale-scene badge / auto-invalidation** — auto-invalidating on
  every drag-drop would clear the list constantly; user-controlled
  regeneration with a "Last generated N minutes ago" timestamp
  is enough for v1

The suggestions feature represents the migration's "proactive brain"
half — Turns 1-4 built the reactive chat brain, Turn 5 turned it
proactive. Future enhancements (auto-trigger when the user dwells
on a scene, persisted history, per-suggestion apply buttons) are
self-contained features that build on this foundation rather than
extending the migration itself.

## Turn 5 — eva suggestions subsystem (partial)

**What it is in eva:** A multi-component suggestions feature with
auto-generation on scene change, persistent suggestion history,
per-user rate limiting via a database, structured action proposals
attached to each suggestion (apply buttons that trigger scene
mutations), and a sidebar tab with collapsible groups, expanded card
views, and stale-scene invalidation.

**What we ported (~890 LOC):**
- `suggestions/build-suggestions-system-prompt.ts` — proactive-observer
  voice tier, output-format directive (`### Suggestion N: Title`),
  empty-scene fallback
- `suggestions/daily-cap.ts` — in-memory daily cap with UTC midnight
  reset, soft-fail at cap, configurable via `BRAIN_SUGGESTIONS_DAILY_CAP`
- `app/api/suggestions/route.ts` — POST streams via the same SSE pump
  as chat; GET returns remaining count without consuming
- `lib/store/suggestions-slice.ts` — slice with parser that splits on
  `### Suggestion` boundaries; in-progress card stays marked while
  text is still streaming
- `lib/store/suggestions-payload.ts` — request body builder mirroring
  the chat brain payload
- `components/suggestions/SuggestionsModal.tsx` — modal UI with
  Generate button, "X / 50 today" counter, streaming cards with
  pulsing cursor, error/empty/fresh states
- TopBar SparkleIcon button + ui-flags-slice modal toggle

**What we skipped (still dropped):**
- **Auto-generation on scene change** — every drag-drop would cost a
  model call. Manual trigger is enough for v1.
- **Persistence across sessions** — adds a schema bump and migration
  burden for marginal UX gain. Refresh wipes the list; regenerate is
  one click.
- **Per-user rate limiting** — we don't have user accounts. Global
  per-server cap is sufficient at our deployment scale.
- **Structured action proposals on suggestions** — same blocker as
  Turn 4's deferral. When structured actions ship, suggestions can
  carry them; until then, suggestions are text only.
- **Sidebar tab with collapsible groups** — modal pattern is simpler
  and matches the existing UI vocabulary (HelpModal). Sidebar tab can
  replace the modal later without changing the underlying brain
  pipeline.
- **Stale-scene invalidation badge** — auto-invalidating after every
  drag would be obnoxious. The "Last generated N minutes ago"
  timestamp is enough cue for the user to regenerate.
- **Expanded card view** — cards are short enough to read inline.

The slimmed feature ships the high-leverage UX win (proactive design
observations, grounded in the user's scene, with bounded spend) and
defers everything that adds complexity without proportional value.
