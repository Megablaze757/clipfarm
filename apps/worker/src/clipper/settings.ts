import type { Env } from "./env";

/**
 * Runtime settings the ADMIN PANEL changes — no redeploy, no Cloudflare
 * dashboard: guest mode on/off, and the Stripe prices + webhook secret that
 * "Set up payments" creates. Kept as one small JSON object in the R2 bucket
 * (private; only the Worker can read it), cached per isolate for 30 s.
 *
 * Environment variables still win when they're set, so anything configured
 * the old way keeps working.
 */
export interface Settings {
  guest_mode?: boolean;
  stripe?: {
    mode?: "live" | "test";
    product_id?: string;
    prices?: Partial<Record<"creator" | "team" | "agency", string>>;
    webhook_id?: string;
    webhook_secret?: string;
    set_up_at?: string;
  };
  updated_at?: string;
  /** notifications.ts: everything before this was already emailed about. */
  notify_cursor?: string;
  /** notifications.ts: the UTC date the admin daily summary last went out. */
  daily_sent?: string;
}

const KEY = "_clipper/settings.json";
let cache: { at: number; value: Settings } | null = null;

export async function getSettings(env: Env): Promise<Settings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  let value: Settings = {};
  try {
    const obj = env.R2_BUCKET ? await env.R2_BUCKET.get(KEY) : null;
    if (obj) value = (await obj.json()) as Settings;
  } catch { /* unreadable → defaults */ }
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(env: Env, patch: (s: Settings) => Settings): Promise<Settings> {
  cache = null;
  const next = { ...patch(await getSettings(env)), updated_at: new Date().toISOString() };
  await env.R2_BUCKET.put(KEY, JSON.stringify(next), { httpMetadata: { contentType: "application/json" } });
  cache = { at: Date.now(), value: next };
  return next;
}

/** Guest mode: the env var forces it off; otherwise the admin panel's switch (default on). */
export async function guestModeOn(env: Env): Promise<boolean> {
  if ((env.CLIPPER_GUEST_MODE ?? "").trim().toLowerCase() === "off") return false;
  const s = await getSettings(env);
  return s.guest_mode !== false;
}

export async function stripePrice(env: Env, plan: string): Promise<string | undefined> {
  const fromEnv = plan === "creator" ? env.CLIPPER_PRICE_CREATOR : plan === "team" ? env.CLIPPER_PRICE_TEAM : plan === "agency" ? env.CLIPPER_PRICE_AGENCY : undefined;
  if (fromEnv) return fromEnv;
  const s = await getSettings(env);
  return s.stripe?.prices?.[plan as "creator"];
}

export async function planForStripePrice(env: Env, priceId: string | null | undefined): Promise<"creator" | "team" | "agency" | null> {
  if (!priceId) return null;
  for (const p of ["creator", "team", "agency"] as const) if ((await stripePrice(env, p)) === priceId) return p;
  return null;
}

export async function stripeWebhookSecret(env: Env): Promise<string> {
  if (env.CLIPPER_STRIPE_WEBHOOK_SECRET) return env.CLIPPER_STRIPE_WEBHOOK_SECRET;
  return (await getSettings(env)).stripe?.webhook_secret ?? "";
}
