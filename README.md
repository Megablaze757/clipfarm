# Clipper — Long-Form to Short-Form Auto-Clipping Platform

Clipper turns long-form video/audio into a ranked set of short, self-contained, platform-native clips.

## Tech Stack
- **Frontend:** Next.js 15, TypeScript, Tailwind CSS, shadcn/ui
- **Backend Router:** Cloudflare Worker
- **Video Processing Engine:** Cloudflare Containers (Docker + FFmpeg)
- **Database & Auth:** Supabase (Postgres + Multi-Tenant RLS + Realtime)
- **Storage:** Cloudflare R2
- **ASR & ML:** Groq (Whisper Large v3) & OpenRouter (LLM Candidate Scoring)
- **Billing:** Stripe Subscriptions & Metered Billing

## Setup & Deployment
```bash
npm install
npm run build
```
