import type { Env } from "./env";
import { ApiError } from "./http";

/**
 * Clipper lives in PocketAthlete's Supabase project, using the same
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY the Worker already has. Every Clipper
 * table is prefixed "clip_" (its membership table is clip_members, not
 * profiles) so nothing collides with PocketAthlete's profiles/subscriptions.
 * The prefix is added HERE, once — call sites use plain names.
 *
 * The Worker bypasses RLS, so EVERY query that touches tenant data must filter
 * by tenant_id itself. Helpers in router.ts do that; never query by id alone.
 */
export function table(path: string): string {
  if (path.startsWith("rpc/")) return `rpc/clip_${path.slice(4)}`;
  const name = path.split(/[?/]/)[0];
  const mapped = name === "profiles" ? "clip_members" : `clip_${name}`;
  return mapped + path.slice(name.length);
}

export async function db(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError(503, "E_NOT_CONFIGURED", "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on the Worker");
  }
  return fetch(`${env.SUPABASE_URL}/rest/v1/${table(path)}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
}

export async function dbJson<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const r = await db(env, path, init);
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    throw new ApiError(502, "E_DATABASE", `database ${r.status}: ${detail}`, true);
  }
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function dbOne<T>(env: Env, path: string): Promise<T | null> {
  const rows = await dbJson<T[]>(env, path);
  return rows?.[0] ?? null;
}

export async function dbInsert<T>(env: Env, table: string, row: unknown, extraPrefer = ""): Promise<T> {
  const rows = await dbJson<T[]>(env, table, {
    method: "POST",
    headers: { Prefer: `return=representation${extraPrefer ? "," + extraPrefer : ""}` },
    body: JSON.stringify(row),
  });
  return rows[0];
}

export async function dbPatch<T>(env: Env, path: string, patch: unknown): Promise<T[]> {
  return dbJson<T[]>(env, path, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
}

export async function rpc<T>(env: Env, fn: string, args: unknown): Promise<T> {
  return dbJson<T>(env, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
}

/** Exact row count via Prefer: count=exact. */
export async function dbCount(env: Env, path: string): Promise<number> {
  const r = await db(env, path, { headers: { Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) throw new ApiError(502, "E_DATABASE", `database ${r.status}`, true);
  return Number((r.headers.get("content-range") || "/0").split("/")[1]) || 0;
}
