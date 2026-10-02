# Furnishes Playground (Standalone)

Self-contained Furnishes Studio playground extracted from `furnishes_prod`,
with the working generation/chat APIs from the classic `furnishes-studio`
package wired back in.

Open this folder alone — no monorepo, no Postgres, no NextAuth required.

## Quick start

```bash
nvm use            # Node 24 (.nvmrc)
npm install
cp .env.example .env.local
# edit .env.local — at minimum paste ANTHROPIC_API_KEY (chat)
# and FAL_API_KEY (furniture / room generation)
npm run dev        # http://localhost:3000
```

Health check: http://localhost:3000/api/health

## What's included

- Full Studio UI (prod playground surface): 3D viewer, chat dock, tools,
  planner, tour, profiles, starred, generations, etc.
- Backend routes:
  - `POST /api/chat` — Anthropic chat (brain pipeline; default on)
  - `POST /api/generate-room` — SSE room layout / mesh generation
  - `POST /api/generate-asset` — single furniture generation
  - `POST /api/arrange`, `/api/explain`, `/api/suggestions`
  - `GET|POST /api/conversations*` — optional sync when Supabase is set
  - `/api/studio/projects*` + snapshot — **local file store** under `data/`
- Default apartment GLB: `public/studio/apartamento.glb`
- Catalog seed: `public/studio/catalog/index.json`

## Environment

See `.env.example`. Important flags:

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Chat + Claude layout planning |
| `ENABLE_BRAIN_PIPELINE` | Chat brain; default on. `false` returns 503 (no legacy JSON path). |
| `FAL_API_KEY` / `FAL_KEY` | Image + mesh generation |
| `MESH_PREVIEW_PROVIDER` / `MESH_HERO_PROVIDER` | Mesh backend selection |
| `NEXT_PUBLIC_SUPABASE_*` | Optional — only if you want auth gating |

Without API keys, the UI still loads; chat and generation return clear 503s.

## Notes

- Projects/snapshots persist to `data/local-projects.json` (gitignored)
  and also to browser IndexedDB (`furnishes-studio`).
- This is **not** a byte-for-byte copy of prod: auth/Prisma were replaced
  with local adapters so the zip runs by itself.
- Path aliases: `@/*` → `src/*`, `@studio/*` → `src/lib/*` + `src/components/*`.
