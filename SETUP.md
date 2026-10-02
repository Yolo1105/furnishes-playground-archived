# Setup

This guide walks through getting the app running with the **chat brain
pipeline** — streaming replies, scene grounding, design rules, mode
discipline, vision via reference images, and proactive suggestions.

The brain is on by default. Set `ENABLE_BRAIN_PIPELINE=false` only if
you need to stop model calls without removing the API key. There is no
legacy JSON chat path.

## 1. Install Node 24 + dependencies

```bash
nvm use            # picks up .nvmrc → Node 24
npm install
```

## 2. Get an Anthropic API key

The brain calls Anthropic's `/v1/messages` endpoint directly. Each
request costs real money (Sonnet 4.6 is roughly $3 per million input
tokens, $15 per million output tokens — a typical chat turn is well
under a cent).

1. Go to https://console.anthropic.com/.
2. Sign up or log in.
3. Add at least $5 of credits (the minimum).
4. Create an API key. Copy it — it starts with `sk-ant-api03-`.

## 2b. Get a fal.ai API key (only if you want text-to-3D)

The chat-driven asset generator and the room director both call
fal.ai for the actual 3D model generation (Flux Schnell for the 2D
style anchor, then TripoSR / Hunyuan3D / Trellis for the mesh). Chat
and suggestions work fine without this — but if you want to type "a
walnut mid-century armchair" in the chat dock and have it produce a
real GLB you can place in the scene, you need a fal.ai key.

1. Go to https://fal.ai/dashboard/keys.
2. Sign up or log in.
3. Create an API key. The format varies; copy the whole thing.
4. Note: fal.ai charges per generation. TripoSR previews are roughly
   $0.005 each; Hunyuan3D hero generations are roughly $0.05 each.

## 3. Create `.env.local`

Copy the template and fill in your keys:

```bash
cp .env.example .env.local
```

Open `.env.local` in your editor and paste your keys. At minimum:

```
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
ENABLE_BRAIN_PIPELINE=true
FAL_API_KEY=your-fal-ai-key-here
```

If you don't need text-to-3D, leave `FAL_API_KEY` blank — chat and
suggestions will still work.

`.env.local` is gitignored, so your keys won't be committed.

## 4. Run the dev server

```bash
npm run dev
```

The first time it boots, the console prints the brain pipeline status:

```
[brain] ENABLE_BRAIN_PIPELINE=true → brain pipeline ACTIVE
[brain] ANTHROPIC_API_KEY present (sk-ant-api03-...XXXX)
[brain] suggestions daily cap: 50 (UTC midnight reset)
```

Open http://localhost:3000.

## 5. Verify it actually works

### Check 1 — config status

Open http://localhost:3000/api/health in another tab. You should see:

```json
{
  "ok": true,
  "brainEnabled": true,
  "anthropicKeyPresent": true,
  "suggestionsDailyCap": 50,
  "suggestionsRemainingToday": 50,
  "textTo3dReady": true,
  "falKeyPresent": true,
  "meshPreviewProvider": "triposr",
  "meshHeroProvider": "hunyuan3d"
}
```

If `brainEnabled` is `false`, `ENABLE_BRAIN_PIPELINE` is set to an
off value (`0`, `false`, `no`, `off`). Unset it or set it to `true`,
then restart `npm run dev`.

If `anthropicKeyPresent` is `false`, your key isn't being read.
Double-check that `.env.local` exists at the **project root** (not in
`src/`) and has `ANTHROPIC_API_KEY=...` on its own line.

If `textTo3dReady` is `false`, either `falKeyPresent` is `false` (set
`FAL_API_KEY` in `.env.local`) or `anthropicKeyPresent` is `false` —
the chat-driven generator needs both, because Claude derives the piece
spec from your prompt before fal.ai generates the mesh.

If a `hints` array appears in the response, follow it — each entry
points at exactly what's misconfigured and how to fix it.

### Check 2 — streaming chat

In the chat dock, type "design a small reading nook for me" and send.
Behaviors that confirm the brain is on:

- The reply **streams in word-by-word** (not all at once)
- The reply is **longer than ~500 characters** (the legacy cap is gone)
- The reply references **specific pieces from your scene** if you have
  any (room dimensions, placed furniture)
- In the browser DevTools **Network** tab, the `/api/chat` request shows
  `Content-Type: text/event-stream` and an `X-Chat-Request-Id` header

If the reply arrives all at once and is short, the brain is off.
Check the dev server console for the boot banner.

### Check 3 — mode discipline (Turn 4)

Switch the mode dropdown above the chat input to **Ask** and ask
"should I move my sofa?" The reply should describe trade-offs without
proposing a specific move.

Switch to **Interior Design** and ask the same question. The reply
should propose concrete changes.

### Check 4 — suggestions (Turn 5)

Click the **sparkle icon** in the top bar between the map and help
buttons. The Suggestions modal opens. Click **Generate**. You should
see 3-5 cards stream in, each grounded in your scene state.

The counter shows `49 / 50 today` after the first generation.

### Check 5 — text-to-3D generation

Switch the mode dropdown to **Furniture**, type "a walnut mid-century
armchair" and send. The reply should be short (it's a generation
trigger, not a chat). After 5-15 seconds, a tile should appear in the
recent-generations bar — click it to drop the GLB into your scene.

If you get a 503 with "service offline" or "FAL_API_KEY not configured,"
your fal.ai key isn't being read. Check `/api/health` for `falKeyPresent`
and recheck `.env.local`.

## Common issues

### "brain pipeline disabled" message in suggestions modal

`ENABLE_BRAIN_PIPELINE` is set to an off value (`0`, `false`, `no`,
`off`). Unset it or set it to `true`, then restart the dev server.

### 500 errors on `/api/chat` or `/api/suggestions`

Check the dev server console for the actual error.

- `model: claude-sonnet-4-6 not found` → Anthropic deprecated the
  model. Update `BRAIN_ANTHROPIC_MODEL` in
  `src/lib/chat-brain/core/anthropic-model.ts`.
- `anthropic-version is not supported` → API version drifted. Update
  it in `src/lib/chat-brain/generation/anthropic-stream.ts` (currently
  `2023-06-01`).
- `invalid x-api-key` → key is wrong, expired, or has no credits.
  Check https://console.anthropic.com/settings/billing.

### Daily cap exhausted during testing

Set `BRAIN_SUGGESTIONS_DAILY_CAP=0` in `.env.local` to disable the
cap, or wait until UTC midnight.

### Chat works but doesn't stream

Either (a) the brain is off — check `/api/health`, or (b) a proxy or
middleware is buffering the SSE stream. The brain sends
`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`
headers; if you've got an unusual proxy in front, those should make it
through.

### "FAL_API_KEY not configured" / 503 from generate-asset or generate-room

Your fal.ai key isn't being read. Check `/api/health` — if
`falKeyPresent` is `false`, the key isn't reaching the server. Common
causes:

- Typo in the var name: it's `FAL_API_KEY` (or `FAL_KEY`), nothing
  else. Anthropic's `ANTHROPIC_API_KEY` doesn't substitute for it.
- `.env.local` not at the project root.
- Dev server not restarted after editing `.env.local`.

Once `falKeyPresent` is `true`, errors from fal.ai itself (insufficient
credits, model unavailable) appear in the dev-server console as
`[providers/fal]` warnings.

### Mesh provider value not recognized

If you set `MESH_PREVIEW_PROVIDER` or `MESH_HERO_PROVIDER` to a value
that's not in the valid set, the app silently falls back to the
default and `/api/health` flags it. Valid values:
`triposr`, `hunyuan3d`, `trellis`, `step1x3d`, `meshy`. Typos like
`meschy` or `hunyan` fall back without crashing — check
`meshPreviewUsedFallback` / `meshHeroUsedFallback` on the health
response to see if your value was accepted. `step1x3d` is accepted
as a name but the fal endpoint is gone — generation fails with a
clear error telling you to switch to `trellis` or `hunyuan3d`.

## What runs without keys

The app degrades cleanly. Without any keys set:

- **Without `ANTHROPIC_API_KEY`**: chat and suggestions return 503
  with a clear message.
- **With `ENABLE_BRAIN_PIPELINE=false`**: chat and suggestions return
  503 (no legacy JSON path).
- **Without `FAL_API_KEY`**: chat + suggestions both work (assuming
  Anthropic is configured). Text-to-3D returns 503 with a clear
  "service offline" message.
- **Without any keys**: the 3D scene editor still works (place
  furniture, draw walls, save to localStorage). Chat dock renders but
  every message returns an error.

## Pricing notes for development

### Anthropic (Sonnet 4.6)

- Input: ~$3 per million tokens
- Output: ~$15 per million tokens

A typical chat turn with the brain is ~3-5k input tokens (the full
prompt stack with scene context) and ~200-1000 output tokens. That's
about $0.01-$0.03 per turn.

A suggestions generation is ~3-5k input + ~1500-3000 output (5 cards).
That's ~$0.03-$0.06 per generation. With the default cap of 50/day,
you cap your daily Anthropic spend at roughly $1.50-$3.00.

### fal.ai (text-to-3D)

- Flux Schnell (2D style anchor): ~$0.005 per image
- TripoSR (preview mesh, default): ~$0.005 per generation, ~1 second
- Hunyuan3D 3.1 Rapid (preview/balanced) / Pro (hero): ~$0.05–$0.15
- Trellis 2 (EU/UK/SK alternative): similar to Hunyuan3D
- Meshy v6: slower and more expensive; often 5–10 minutes
- Step1X-3D: retired on fal.ai — do not set `MESH_*_PROVIDER=step1x3d`

A single piece preview is roughly $0.01 (Flux + TripoSR). A hero
generation is roughly $0.06 (Flux + Hunyuan3D). A full 6-piece room
generation runs ~$0.30-$0.40 depending on tier.

The asset-generation route has a built-in rate limit of 12 requests/hour
per client. The room-director route has 8/hour. These bound your
worst-case spend if a UI bug starts hammering the endpoint.

Set `BRAIN_SUGGESTIONS_DAILY_CAP=5` and use `MESH_PREVIEW_PROVIDER=triposr`
(default) while you're getting started for tighter spend caps.

## Where to look in the code

- `src/lib/chat-brain/core/brain-flag.ts` — the `isBrainEnabled` reader
- `src/lib/chat-brain/core/anthropic-model.ts` — the model constant
- `src/lib/chat-brain/generation/anthropic-stream.ts` — the actual
  Anthropic call and SSE parser (line 62: API URL, line 142: version)
- `src/lib/providers/index.ts` — the fal.ai provider registry that
  resolves `MESH_PREVIEW_PROVIDER` and `MESH_HERO_PROVIDER`
- `src/lib/providers/fal.ts` — the fal.ai adapter for every mesh model
  (TripoSR, Hunyuan3D 3.1, Trellis 2, Meshy v6)
- `src/app/api/chat/route.ts` — the chat endpoint (brain path only)
- `src/app/api/suggestions/route.ts` — the suggestions endpoint
- `src/app/api/generate-asset/route.ts` — single-piece text-to-3D
- `src/app/api/generate-room/route.ts` — full-room director
- `src/app/api/health/route.ts` — diagnostic endpoint

For a deeper architecture overview, see
`src/lib/chat-brain/README.md`.
