# Phase 0 — `build-project-summary.ts` Decision Log

> Source: `lib/eva/projects/build-project-summary.ts` (837 LOC)
> Target: `src/lib/chat-brain/projects/build-project-summary.ts` (estimated ~250 LOC)

This file is the heaviest in the migration. It builds a `ProjectSummaryDto` — a fat object that the chat brain reads to know "what's going on in this project right now." Eva's version mixes design context (KEEP) with e-commerce context (DROP) freely. This document walks every section and assigns each one a decision.

## Reading guide

For each section:
- **Field/section name** — what eva calls it
- **What it does** — one sentence
- **Decision** — KEEP / DROP / ADAPT
- **Reason** — concrete

If KEEP: the data flows through unchanged (or with shape adjustment for our store).
If DROP: the field doesn't exist on our DTO. Code that referenced it gets stripped.
If ADAPT: structurally similar but rewritten for our data sources.

---

## Type-level decisions

### `ShortlistSummaryRow`
**What:** A row in the user's product shortlist (favorited items they might buy).
**Decision: DROP.** No catalog → no shortlist. The `shortlistRows` array becomes `[]` permanently.
**Effect:** all `shortlist`, `hasPrimaryShortlist`, substitution guidance — all drop or default.

### `ProjectExecutionPackage`
**What:** Aggregated handoff package — title, room, preferred direction, shortlist, accepted constraints, highlighted artifacts, unresolved items, next step.
**Decision: ADAPT (strip).** Keep `title`, `room`, `preferredDirectionLabel`, `acceptedConstraints`, `unresolved`, `nextStep`. Drop `shortlist` and `highlightedArtifacts` (the latter depends on a project artifact system we don't have).
**Effect:** `buildExecutionPackage` shrinks ~60 LOC.

### `buildExecutionPackage` (private helper)
**Decision: ADAPT.** Same as above. Function still exists, returns a smaller object.

### `ProjectSummaryDto` — the big return type
This is where the keep/drop calls actually matter. Every field gets called out below:

| Field | Decision | Reason |
|---|---|---|
| `projectId` | **KEEP** | We have project ids |
| `title` | **KEEP** | Project name |
| `room` | **KEEP** | Project's room context |
| `roomType` | **KEEP** | Living room / bedroom / etc. |
| `goalSummary` | **KEEP** | One-line user intent |
| `briefLines` | **KEEP** | Key/value pairs about the project |
| `workflowStage` | **DROP** | No workflow → no stage |
| `workflowEvaluation` | **DROP** | Same |
| `milestone` | **DROP** | Same |
| `preferredDirection` | **ADAPT** | Keep the concept ("here's the design direction the user is locked into") but populate from preferences slice instead of decision context table |
| `decisionNotes` | **KEEP** | User's free-form notes |
| `acceptedConstraints` | **KEEP** | Constraints user has accepted (e.g., "must include workspace") |
| `comparisonCandidates` | **DROP** | Eva lets users compare 2+ paths. We don't have that flow |
| `recommendations` | **DROP** | E-commerce recommendations object (snapshot, top items, prices) |
| `shortlist` | **DROP** | E-commerce shortlist |
| `artifacts.*` (3 sub-fields) | **DROP** | Project artifacts = uploaded files / outputs we don't have |
| `studio` | **ADAPT** | Eva stores a "saved studio room" with placement counts; we have live scene state. Adapt to read from our scene-source-slice |
| `unresolvedSystem` | **KEEP** | Open issues the system noticed |
| `unresolvedUser` | **KEEP** | User's own follow-up list |
| `unresolved` | **KEEP** | De-duped combined list |
| `handoffReadiness` | **DROP** | Handoff = sending the project to a contractor. Not in scope |
| `nextStep` | **ADAPT** | Eva derives this from workflow + execution. We derive it from preferences + scene state ("you've picked style but haven't placed a sofa yet") |
| `decisionContext` | **DROP** | Wraps comparison candidates + decision notes; only `decisionNotes` survives, return as a flat field |
| `stats.conversationCount` | **KEEP** | Already track this |
| `stats.fileCount` | **DROP** | No project files |
| `stats.shortlistCount` | **DROP** | No shortlist |
| `executionReadiness` | **DROP** | Execution / contractor handoff |
| `executionPackage` | **ADAPT** | Stripped version (see above) |
| `projectInsights.whatChangedRecently` | **DROP** | Reads `recentWorkflowEvents` — no workflow |
| `projectInsights.primaryBlockers` | **KEEP** | First N unresolved items |
| `execution` | **DROP** | Execution view (tasks, blockers) |
| `nextBestAction` | **ADAPT** | Same source as `nextStep` |
| `collaboration` | **DROP** | Multi-user approval flow we don't have |
| `substitutionGuidanceByShortlistItemId` | **DROP** | Shortlist + substitution = e-commerce |
| `externalExecution` | **DROP** | Procurement |
| `recentPacketSends` | **DROP** | Handoff audit |

### Net DTO shrink
- **KEEP fields:** 11 (title, room, roomType, goalSummary, briefLines, decisionNotes, acceptedConstraints, unresolvedSystem, unresolvedUser, unresolved, projectInsights.primaryBlockers)
- **ADAPT fields:** 5 (preferredDirection, studio, nextStep, executionPackage [stripped], nextBestAction)
- **DROP fields:** 16 (workflowStage, workflowEvaluation, milestone, comparisonCandidates, recommendations, shortlist, artifacts.*, handoffReadiness, decisionContext, stats.fileCount, stats.shortlistCount, executionReadiness, projectInsights.whatChangedRecently, execution, collaboration, substitutionGuidanceByShortlistItemId, externalExecution, recentPacketSends)

The new DTO is roughly **40% the size** of eva's. Output type:

```ts
export type ProjectSummaryDto = {
  projectId: string;
  title: string;
  room: string;
  roomType: string | null;
  goalSummary: string;
  briefLines: { key: string; value: string }[];
  preferredDirection: { label: string; notes?: string; items: Array<{ id: string; title: string; category: string; reasonWhyItFits: string }>; updatedAt?: string } | null;
  decisionNotes: string | null;
  acceptedConstraints: string[];
  studio: { sceneSource: "viewer" | "room-director"; placementCount: number; styleBibleName: string | null } | null;
  unresolvedSystem: string[];
  unresolvedUser: string[];
  unresolved: string[];
  nextStep: string;
  nextBestAction: string;
  stats: { conversationCount: number };
  executionPackage: { title: string; room: string; preferredDirectionLabel: string | null; acceptedConstraints: string[]; unresolved: string[]; nextStep: string };
  projectInsights: { primaryBlockers: string[] };
};
```

---

## Implementation decisions

### Body of `buildProjectSummary` — section-by-section
**Lines 314–331 (Prisma `findUnique` + relations):**
**ADAPT.** Replace with our data source: project record from `useStore.getState().projects.find(p => p.id === projectId)` server-side won't work (no store on server). Instead the caller passes the project state in. New signature:
```ts
buildProjectSummary(input: {
  projectId: string;
  title: string;
  room: string | null;
  preferences: Record<string, string>;
  acceptedConstraints: string[];
  decisionNotes: string | null;
  conversationCount: number;
  studioState: { sceneSource: ...; placementCount: number; styleBibleName: string | null } | null;
  preferredDirection: ...;
}): ProjectSummaryDto
```
Pure function. No I/O. Caller assembles the input from Zustand or Supabase as appropriate.

**Lines 334–344 (Prisma message count + decision context + recommendations snapshot):**
- Message count: caller passes in.
- Decision context: keep `decisionNotes` only.
- Recommendations snapshot: DROP entirely.

**Lines 346–369 (preferredDirection + topFromSnap):**
- preferredDirection: ADAPT — read from caller input.
- topFromSnap: DROP.

**Lines 371–394 (conversation count + artifacts + studio):**
- conversation count: caller passes in.
- artifacts: DROP.
- studio: caller passes in.

**Lines 396–504 (shortlist + workflow + handoff):**
DROP entirely.

**Lines 506–602 (executionPackage + projectInsights + execution state):**
- executionPackage: ADAPT (stripped, as above).
- projectInsights: KEEP only `primaryBlockers`.
- execution state: DROP.

**Lines 604–end (taskDtos, packetSends, collaboration, externalExecution):**
DROP entirely.

### Stripped `buildExecutionPackage`
```ts
function buildExecutionPackage(input: {
  title: string;
  room: string;
  preferredDirectionLabel: string | null;
  acceptedConstraints: string[];
  unresolved: string[];
  nextStep: string;
}): ProjectExecutionPackage {
  return {
    title: input.title,
    room: input.room,
    preferredDirectionLabel: input.preferredDirectionLabel,
    acceptedConstraints: input.acceptedConstraints,
    unresolved: input.unresolved,
    nextStep: input.nextStep,
  };
}
```
~10 LOC instead of ~80.

---

## Final file size estimate

| Section | Eva LOC | Ours LOC |
|---|---|---|
| Type definitions | ~190 | ~50 |
| `buildExecutionPackage` | ~30 | ~10 |
| `buildProjectSummary` body | ~480 | ~150 |
| Helpers + imports | ~140 | ~40 |
| **TOTAL** | **837** | **~250** |

## DROPPED.md companion

For every dropped function, I'll add an entry to `src/lib/chat-brain/projects/DROPPED.md`:
```markdown
## buildShortlistFitScores
- **Source:** lib/eva/projects/build-project-summary.ts:380
- **Dropped:** Turn 2, v0.36.0
- **Reason:** Requires product catalog (no equivalent in furnishes-studio).
- **To restore:** Build product catalog server-side (Prisma `Product` table or Supabase equivalent), then port the scoring logic.
```

This makes every cut auditable and reversible.

## Open questions for sign-off

1. **`preferredDirection`:** I'm proposing this surfaces from the preferences slice. Eva computes it from a richer "decision context" with comparison candidates. Without comparisons, the field becomes "the user's locked-in style" (e.g., "japandi minimalism") with related `briefLines`. Confirm that's the right read.

2. **`studio` field:** I'm proposing it's `{ sceneSource, placementCount, styleBibleName }` — three small things the brain wants to know about the current scene. Eva stored a database row per saved scene; we don't. Confirm.

3. **`nextStep` vs `nextBestAction`:** Eva has both — `nextStep` is workflow-derived, `nextBestAction` prefers execution-orchestration output. Without either system, both fields collapse to the same value. I'm proposing they remain as separate fields (same value) so call sites that expect both don't break. Confirm.

4. **DROPPED.md location:** I'm proposing it lives alongside the source file. Alternative: `docs/chat-brain-migration/DROPPED.md` (single doc). Either works. Confirm preference.
