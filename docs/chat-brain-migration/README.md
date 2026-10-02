# Chat-Brain Migration — Phase 0 Artifacts

This directory contains the 4 sign-off documents produced before any porting starts. They're the contract for what gets built across Turns 1–5.

## Read in this order

1. **[01-orchestrator-annotation.md](./01-orchestrator-annotation.md)** — The 737-line orchestrator (`run-chat-post-pipeline.ts`), broken into 15 stages with PORT/ADAPT/DROP decision per stage. **Risk 1 mitigation.**

2. **[02-build-project-summary-decisions.md](./02-build-project-summary-decisions.md)** — The 837-line project summary builder, with field-by-field KEEP/DROP table. **Risk 2 mitigation.**

3. **[03-directory-layout.md](./03-directory-layout.md)** — Final structure of `src/lib/chat-brain/` once all 5 turns ship. 60 files mapped to source locations + which turn introduces each.

4. **[04-feature-flags.md](./04-feature-flags.md)** — Every env var introduced across the migration. **Risk 1, 4, 5 rollback mitigations.**

## Sign-off questions

Each document ends with a small "Open questions for sign-off" section. There are **13 questions total** across all 4 docs. Most have a strong default; you can say "use the defaults" and move on.

If you want to override any default:
- Tell me which question and which option you want.
- I'll update the doc and re-confirm before starting Turn 1.

If you accept all defaults:
- Say "go." I start Turn 1 (foundation utilities, ~750 LOC, no behavior change).

## Recap of mitigations baked into the plan

| Risk | Mitigation in this Phase 0 / future turns |
|---|---|
| **R1 — Orchestrator port** | Annotation in 01-*.md done. Sub-phased delivery (3a–3e) in master plan. Feature flag `ENABLE_BRAIN_PIPELINE` for instant rollback. |
| **R2 — `build-project-summary` partial** | Field-by-field decision log in 02-*.md done. `DROPPED.md` companion file logs every cut for reversibility. |
| **R3 — SSE streaming change** | Reuses existing `parseSSE` infrastructure from Room Layout flow. Token accumulator pattern keeps ConversationBubble unchanged. Backward-compat fallback on stream errors. |
| **R4 — Preferences hallucination** | Source attribution per preference (`sourceText`, `sourceTurnId`, `confidence`). Threshold-based persistence. UI surface for user review. Two-strikes deletion on contradiction. `BRAIN_PREFERENCES_ENABLED` kill switch. |
| **R5 — Suggestions cost** | Hard rate limit (1 refresh / 30s). Server-side cache by snapshot hash. Per-user daily cap. `BRAIN_SUGGESTIONS_ENABLED` kill switch. |
| **R6 — No catalog** | Disclosed; suggestion strings are action-oriented design coaching, not products. |
| **R7 — No tests carry over** | Per-turn sanity checks (like 0.34.0's 11/11 migration check). TS clean is mandatory gate. |
| **R8 — Schema migrations stack** | One bump per turn, max. Migration sanity check per bump. Forward-only + idempotent + downgrade emergency flag. |
| **R9 — Mode misconfiguration** | Per-mode sanity check in Turn 4 verifies all 4 modes have correct config. |
| **R10 — Stop mid-migration** | Each turn ships green. Foundation is no-op safe. Feature flags off by default until proven. `TURN_PROGRESS.md` records exact state across turns. |

## What changes in the repo right now (Phase 0)

Just these 5 files in `docs/chat-brain-migration/`:
- `README.md` (this file)
- `01-orchestrator-annotation.md`
- `02-build-project-summary-decisions.md`
- `03-directory-layout.md`
- `04-feature-flags.md`

**No source code changes. No version bump.** Phase 0 is pure planning. v0.34.0 is still what's shipped.
