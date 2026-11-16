// =============================================================================
// apex-api — ONE Worker for PocketAthlete and Clipper.
//
// Both apps call the same AI providers, so they share one Worker: one set of
// keys (GROQ_SECRET, OPENROUTER_API_KEY, NVIDIA_SECRET) and one fallback ladder
// (Groq -> OpenRouter -> NVIDIA, defined in pocketathlete/index.ts).
//
//   /v1/*        -> Clipper (src/clipper)
//   everything   -> PocketAthlete (src/pocketathlete, synced from its own repo)
//
// Deploy with `wrangler deploy` (not the dashboard paste): Clipper needs the
// Container and R2 bindings, which only wrangler can create.
// =============================================================================
import pocketAthlete from "./pocketathlete/index";
import { handleClipper } from "./clipper/router";
import { clipperScheduled, CLIPPER_CRON } from "./clipper/cron";
import type { Env } from "./clipper/env";

export { FFmpegContainer } from "./clipper/container";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/v1" || pathname.startsWith("/v1/")) return handleClipper(req, env, ctx);
    return pocketAthlete.fetch(req, env);
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // PocketAthlete treats ANY cron other than 19:00 as its 08:00 run (reminders,
    // emails). Clipper's frequent cron must never reach it, or athletes would be
    // emailed every ten minutes.
    if (event.cron === CLIPPER_CRON) return clipperScheduled(env, ctx);
    return pocketAthlete.scheduled(event, env);
  },
};
