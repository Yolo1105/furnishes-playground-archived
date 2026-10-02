# Phase 0 — Feature Flag Inventory

> Every env var introduced across Turns 1–5. Flags exist for two reasons: (1) emergency rollback if something breaks, (2) opt-in testing before defaulting on.

## Flag catalog

### `ENABLE_BRAIN_PIPELINE` *(Turn 2 onward)*
**Default:** `false`
**Effect when true:** `/api/chat` routes through `runChatPostPipeline` (the new brain). When false, existing simple flow runs.
**Why exists:** rollback for the highest-risk turn (Risk 1 mitigation). When the brain ships in v0.36.0, you flip this on locally to test. It defaults off in production until you flip it on intentionally.
**Removed when:** v0.40.0 (post-migration cleanup, once stable for ~2 weeks of real use).

### `BRAIN_PREFERENCES_ENABLED` *(Turn 2 onward)*
**Default:** `true`
**Effect when false:** preference extraction skipped after each turn; existing preferences still read into prompts (read-only mode).
**Why exists:** Risk 4 mitigation — if extraction starts hallucinating preferences, flip this off to stop new ones from landing without breaking the brain's ability to use existing ones.
**Removed when:** when extraction is proven reliable (~v0.41.0 if no incidents).

### `BRAIN_VISION_ENABLED` *(Turn 3 onward)*
**Default:** `true`
**Effect when false:** server-side vision summarization for attachments is skipped. Attachments still appear inline in the prompt as raw images (Anthropic vision still sees them), but the cached text summary doesn't get computed.
**Why exists:** vision API costs money per call. If costs spike, flip off; the brain still sees images, just without the persistent summary.
**Removed when:** never — useful permanent kill-switch.

### `BRAIN_FALLBACK_MODEL_ENABLED` *(Turn 3 onward)*
**Default:** `true`
**Effect when false:** Sonnet → Haiku fallback disabled. Errors return immediately on Sonnet failure.
**Why exists:** Risk 1 mitigation. If Haiku fallback ever produces noticeably worse output for your use case, flip off and pay for Sonnet retries instead.
**Removed when:** never — useful tuning switch.

### `BRAIN_SUGGESTIONS_ENABLED` *(Turn 5 onward)*
**Default:** `true`
**Effect when false:** Suggestions tab shows the empty state permanently. `/api/suggestions` returns 503.
**Why exists:** Risk 5 mitigation. If suggestion costs balloon, flip off entirely.
**Removed when:** never — keep as kill-switch.

### `BRAIN_SUGGESTIONS_DAILY_CAP` *(Turn 5)*
**Default:** `50`
**Effect:** integer; max suggestion API calls per user per UTC day. Beyond cap, route returns cached + "daily limit reached."
**Why exists:** Risk 5 mitigation. Prevents one user from burning $50/day in Claude calls if a script spams refresh.
**Removed when:** never — operational tuning.

### `BRAIN_RECOVERY_QUEUE_ENABLED` *(Turn 3)*
**Default:** `true`
**Effect when false:** the empty-stream → generateText recovery loop in Stage 14 is skipped. Empty streams return the friendly error instead of trying to recover.
**Why exists:** the recovery loop adds latency (up to 30s timeout). If you'd rather show errors faster than wait for recovery, flip off.

### `DEBUG_CHAT_TRACE` *(Turn 1, ports as-is)*
**Default:** unset
**Effect when `1`:** chat pipeline logs verbose stage-by-stage trace to console.
**Why exists:** debugging. Already in eva, ports as-is.

### `BRAIN_ALLOW_DOWNGRADE` *(Turn 2 onward, emergency-only)*
**Default:** unset (effectively `false`)
**Effect when `1`:** schema migrations run **backwards** if needed. Used only when an upgrade goes catastrophically wrong and we need to restore an older snapshot shape from a backup.
**Why exists:** migrations are forward-only by policy. This flag is the emergency override. Should never be set in normal operation.
**Removed when:** never. Kept as a permanent escape hatch.

## Configuration matrix

| Flag | v0.34.0 | v0.35.0 | v0.36.0 | v0.37.0 | v0.38.0 | v0.39.0 |
|---|---|---|---|---|---|---|
| `ENABLE_BRAIN_PIPELINE` | n/a | n/a | introduced (default off) | default off | default off | **default on** |
| `BRAIN_PREFERENCES_ENABLED` | n/a | n/a | introduced (default on) | default on | default on | default on |
| `BRAIN_VISION_ENABLED` | n/a | n/a | n/a | introduced (default on) | default on | default on |
| `BRAIN_FALLBACK_MODEL_ENABLED` | n/a | n/a | n/a | introduced (default on) | default on | default on |
| `BRAIN_SUGGESTIONS_ENABLED` | n/a | n/a | n/a | n/a | n/a | introduced (default on) |
| `BRAIN_SUGGESTIONS_DAILY_CAP` | n/a | n/a | n/a | n/a | n/a | introduced (default 50) |
| `BRAIN_RECOVERY_QUEUE_ENABLED` | n/a | n/a | n/a | introduced (default on) | default on | default on |

## Flip-on sequence (recommended for production)

After v0.36.0 ships:
1. Run dev with `ENABLE_BRAIN_PIPELINE=true`. Verify chat replies feel right.
2. If good, set `ENABLE_BRAIN_PIPELINE=true` in your prod env.
3. Watch for ~24h. If stable, leave on permanently.
4. If issues: flip back to `false`. Existing chat resumes. **Zero data loss** because the brain writes to the same conversations table.

After v0.37.0 ships, the streaming layer is hot-path. **No new flag to flip** because v0.36.0 already enabled the brain. The streaming + attachments are additive on top.

After v0.38.0 ships, the Ask mode becomes available in the dropdown. **No flag** — modes are always rendered; users opt in by selecting.

After v0.39.0 ships, the Suggestions tab appears in the right rail (assuming `BRAIN_SUGGESTIONS_ENABLED=true`).

## Local dev defaults

For a developer running locally, recommend `.env.local`:
```
ANTHROPIC_API_KEY=sk-ant-...
FAL_KEY=fal-...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Brain flags — flip as needed when testing:
# ENABLE_BRAIN_PIPELINE=true
# DEBUG_CHAT_TRACE=1
```

Brain flags commented out by default. Uncomment when testing the new pipeline.

## Open questions for sign-off

1. **Default of `ENABLE_BRAIN_PIPELINE` at v0.39.0:** I'm proposing it flips to **default on** at v0.39.0 (the final milestone). Alternative: keep default off, require explicit opt-in. Confirm preference.

2. **Daily cap default of 50:** at ~$0.001/call that's $0.05/user/day max. Conservative. Could be 20 (cheaper) or 100 (more permissive). Confirm.

3. **Naming:** I prefixed brain flags with `BRAIN_*`. Alternatives: `CHAT_BRAIN_*` (clearer) or `EVA_*` (eva-style). Confirm.
