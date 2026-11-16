import type { Env as PocketAthleteEnv } from "../pocketathlete/index";

/**
 * The merged Worker's environment: everything PocketAthlete already has (AI
 * keys, Supabase, Stripe) plus Clipper's bindings. Clipper shares
 * PocketAthlete's Supabase project and keys — its tables are clip_-prefixed
 * (see db.ts) — so it needs no Supabase settings of its own.
 */
export interface Env extends PocketAthleteEnv {
  // Bindings
  R2_BUCKET: R2Bucket;
  /** Only bound when CLIPPER_RUNNER = "container" (needs Workers Paid). */
  FFMPEG?: DurableObjectNamespace<import("./container").FFmpegContainer>;
  /** "github" (default, free): FFmpeg runs on GitHub Actions. "container": Cloudflare Containers. */
  CLIPPER_RUNNER?: string;
  /** Starts the GitHub runs. Defaults to GITHUB_TOKEN (PocketAthlete's), which must also cover the Clipper repo. */
  CLIPPER_GITHUB_TOKEN?: string;
  /** owner/repo holding .github/workflows/clipper-job.yml. Default Megablaze757/clipfarm. */
  CLIPPER_GITHUB_REPO?: string;

  /**
   * Optional. Signs media URLs and authenticates the Container's calls back.
   * Unset, the service-role key is used — the Container already holds it, and
   * it never leaves the Worker/Container in either role.
   */
  CLIPPER_INTERNAL_SECRET?: string; // secret
  /** This Worker's public origin, e.g. https://apex-api.you.workers.dev — the Container calls it. */
  CLIPPER_API_URL?: string;
  /** Where the Clipper web app lives (Stripe redirects back here). */
  CLIPPER_APP_URL?: string;

  // Stripe. The secret key falls back to PocketAthlete's STRIPE_SECRET_KEY, so
  // one Stripe account can serve both apps; the webhook secret cannot (one per endpoint).
  CLIPPER_STRIPE_SECRET_KEY?: string;
  CLIPPER_STRIPE_WEBHOOK_SECRET?: string;
  CLIPPER_PRICE_CREATOR?: string;
  CLIPPER_PRICE_TEAM?: string;
  CLIPPER_PRICE_AGENCY?: string;
  /** Optional metered price (source minutes). Added to checkout when set. */
  CLIPPER_PRICE_METERED?: string;
  /** Stripe Billing Meter event name. Default "clipper_source_minutes". */
  CLIPPER_METER_EVENT?: string;
}

export function internalSecret(env: Env): string {
  return (env.CLIPPER_INTERNAL_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function stripeKey(env: Env): string {
  return (env.CLIPPER_STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY || "").trim();
}

/** This Worker's public URL. A dashboard paste needs no variable for it. */
export function apiUrl(env: Env): string {
  return (env.CLIPPER_API_URL || "https://apex-api.fitnessguru.workers.dev").trim().replace(/\/$/, "");
}

/** Where the Clipper web app lives (Stripe sends people back here). */
export function appUrl(env: Env): string {
  return (env.CLIPPER_APP_URL || "https://megablaze757.github.io/clipfarm").trim().replace(/\/$/, "");
}
