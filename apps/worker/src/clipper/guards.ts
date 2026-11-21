import type { Env } from "./env";
import type { Caller } from "./auth";
import { ApiError, body, json } from "./http";

/**
 * ABUSE LIMITS — how many projects can be STARTED per hour, so nobody can
 * flood the runners: guests are counted per IP address (they share one
 * workspace), signed-in workspaces per workspace, scaled by plan. Admins are
 * never limited. Counters live in the bucket, one tiny object per hour.
 */
const LIMITS: Record<string, number> = { guest: 4, free: 6, creator: 20, team: 60, agency: 200, enterprise: 10_000 };

async function hash(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkProjectRate(req: Request, env: Env, caller: Caller): Promise<void> {
  if (caller.admin || !env.R2_BUCKET) return;
  const who = caller.guest ? `ip:${req.headers.get("CF-Connecting-IP") ?? "unknown"}` : `t:${caller.tenantId}`;
  const limit = caller.guest ? LIMITS.guest : LIMITS[caller.plan.id] ?? LIMITS.free;
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `_clipper/rate/${await hash(who)}-${hour}`;
  const obj = await env.R2_BUCKET.get(key);
  const n = obj ? Number(await obj.text()) || 0 : 0;
  if (n >= limit) {
    const mins = 60 - Math.floor((Date.now() % 3_600_000) / 60_000);
    throw new ApiError(429, "E_RATE_LIMITED", caller.guest
      ? `Guests can start ${limit} projects an hour — sign up for more, or try again in ${mins} min.`
      : `You've started ${limit} projects this hour (${caller.plan.label} plan) — try again in ${mins} min.`);
  }
  await env.R2_BUCKET.put(key, String(n + 1));
}

/**
 * CLIENT ERROR TRACKING — the web app reports crashes it hits (POST
 * /v1/telemetry/error), so problems in people's browsers show up in Admin →
 * System, not just failed jobs. Kept to the last ~200, deduplicated by
 * message, throttled per IP. No personal data: message, stack head, page path.
 */
interface ClientError { message: string; stack?: string; path?: string; ua?: string; count: number; first: string; last: string }
const ERR_KEY = "_clipper/client-errors.json";

export async function reportClientError(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const minute = Math.floor(Date.now() / 60_000);
  const tKey = `_clipper/rate/err-${await hash(ip)}-${minute}`;
  const seen = await env.R2_BUCKET.head(tKey);
  if (seen) return json({ ok: true, throttled: true });
  await env.R2_BUCKET.put(tKey, "1");
  const b = await body<{ message?: string; stack?: string; path?: string }>(req).catch(() => ({} as { message?: string; stack?: string; path?: string }));
  const message = String(b.message ?? "").slice(0, 300);
  if (!message) return json({ ok: false });
  const now = new Date().toISOString();
  const list = ((await (await env.R2_BUCKET.get(ERR_KEY))?.json().catch(() => null)) as ClientError[] | null) ?? [];
  const same = list.find((e) => e.message === message && e.path === b.path);
  if (same) { same.count++; same.last = now; }
  else list.unshift({ message, stack: String(b.stack ?? "").split("\n").slice(0, 6).join("\n").slice(0, 800), path: String(b.path ?? "").slice(0, 120), ua: (req.headers.get("User-Agent") ?? "").slice(0, 120), count: 1, first: now, last: now });
  list.sort((a, b2) => b2.last.localeCompare(a.last));
  await env.R2_BUCKET.put(ERR_KEY, JSON.stringify(list.slice(0, 200)));
  return json({ ok: true });
}

export async function clientErrors(env: Env): Promise<ClientError[]> {
  return ((await (await env.R2_BUCKET.get(ERR_KEY))?.json().catch(() => null)) as ClientError[] | null) ?? [];
}
