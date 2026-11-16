# Clipper — long-form to short-form auto-clipping

Upload a podcast, webinar or stream (or paste a link) and get a ranked shortlist of
self-contained vertical clips, each with the reason it scored well. Trim, fix captions,
auto-frame the speaker, export an MP4.

## How it fits together

```
apps/web        Next.js static site (GitHub Pages) ── Supabase Auth + Realtime
     │
     ▼  /v1/*
apps/worker     apex-api — ONE Cloudflare Worker for PocketAthlete AND Clipper
     │            src/pocketathlete/  PocketAthlete's routes (synced from its repo)
     │            src/clipper/        Clipper API, R2 uploads, Stripe, cron
     │            shared: GROQ_SECRET / OPENROUTER_API_KEY / NVIDIA_SECRET and the
     │                    Groq → OpenRouter → NVIDIA fallback ladder
     ▼
apps/container  FFmpeg Container (Cloudflare Containers): ingest → Whisper ASR (Groq)
                → candidates → scoring (shared AI ladder, heuristics if all fail)
                → boundary snapping → proxies; final renders with burned captions
supabase/       clipper-setup.sql — Clipper's clip_* tables inside PocketAthlete's
                Supabase project (same accounts, same keys)
```

**AI fallbacks.** Every model call goes through PocketAthlete's `complete()` ladder:
Groq first, then OpenRouter (paid model, then free ones), then NVIDIA. If every
provider fails, scoring falls back to built-in heuristics (hook phrases, pronoun
resolution, energy, pauses) so a project never stalls on AI. Diarization degrades
to a single speaker. Speaker framing uses **MediaPipe face detection in the
browser** (no GPU server), falling back to a static lock, then a centre crop, then a
blurred-letterbox "fit".

## Getting it running

Clipper reuses everything apex-api already has — PocketAthlete's Supabase project
(and its accounts), AI keys, and Stripe key. **No new secrets.**

1. Add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (and optionally
   `SUPABASE_ACCESS_TOKEN`), then run the **Deploy apex-api Worker + Container** Action.
   It creates the R2 bucket, installs the `clip_*` tables, and deploys. Without
   `SUPABASE_ACCESS_TOKEN`, paste `supabase/clipper-setup.sql` into Supabase's SQL editor
   once instead. Containers need the Workers Paid plan.
2. GitHub Pages rebuilds the web app on every push to `main`.

**Important — PocketAthlete's own repo also deploys apex-api.** Its
`.github/workflows/deploy-worker.yml` runs on every push to `cloudflare/**` and would
replace this merged Worker with a PocketAthlete-only one (Clipper's routes and
Container would disappear). Disable that workflow there, and from now on deploy
PocketAthlete changes by syncing them here (below) and running this repo's Action.

Later, for paid Clipper plans: create Stripe prices and put them in
`CLIPPER_PRICE_*` in `apps/worker/wrangler.toml`, add a Stripe webhook to
`https://apex-api.fitnessguru.workers.dev/v1/webhooks/stripe` and set
`CLIPPER_STRIPE_WEBHOOK_SECRET`. Until then everyone is on the Free plan (60 min/month).
For Google/GitHub sign-in or email confirmation links to return to Clipper, add
`https://megablaze757.github.io/clipfarm/login` to Supabase → Auth → URL configuration.

## Develop

```bash
npm install
npm test                       # Worker typecheck + Container unit tests
npm run dev --workspace=apps/web
```

PocketAthlete's Worker code lives in its own repo. After changing it there:
`node scripts/sync-pocketathlete.mjs ../FOOTBALLFITNESSGURU`.

## API (all under the Worker, Supabase JWT in `Authorization: Bearer`)

| | |
|---|---|
| `POST /v1/upload/create`, `PUT /v1/upload/part`, `POST /v1/upload/complete` | resumable multipart upload into R2 |
| `POST /v1/projects` · `GET /v1/projects` · `GET/DELETE /v1/projects/{id}` · `POST …/retry` | projects (`Idempotency-Key` supported) |
| `GET/PATCH /v1/projects/{id}/transcript` · `GET /v1/projects/{id}/clips` | transcript, scored candidates |
| `POST /v1/clips` · `GET/PATCH /v1/clips/{id}` · `POST …/feedback` · `POST …/render` | clips, edits, export |
| `GET /v1/renders/{id}` | render status + signed download URL (24 h) |
| `GET /v1/usage` · `POST /v1/billing/checkout` · `POST /v1/billing/portal` | plans & billing |
| `GET /v1/health` | configuration + live AI ladder |
