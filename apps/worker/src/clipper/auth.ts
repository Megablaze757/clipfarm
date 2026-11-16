import { internalSecret, type Env } from "./env";
import { dbOne, rpc } from "./db";
import { ApiError, safeEqual } from "./http";
import { planFor, type Plan } from "./plans";

export interface Caller {
  userId: string;
  email: string;
  tenantId: string;
  role: "owner" | "editor" | "viewer";
  plan: Plan;
}

/** Verifies the Supabase JWT (the same accounts as PocketAthlete) and loads the Clipper workspace. */
export async function requireCaller(req: Request, env: Env): Promise<Caller> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) throw new ApiError(401, "E_UNAUTHORIZED", "sign in first");
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!r.ok) throw new ApiError(401, "E_UNAUTHORIZED", "session expired — sign in again");
  const user = (await r.json()) as { id?: string; email?: string };
  if (!user?.id) throw new ApiError(401, "E_UNAUTHORIZED", "session expired — sign in again");

  let profile = await dbOne<{ tenant_id: string; role: Caller["role"] }>(
    env, `profiles?id=eq.${user.id}&select=tenant_id,role`);
  if (!profile) {
    // The signup trigger normally creates this. Accounts made before the
    // trigger existed get their tenant on first API call instead.
    await rpc(env, "ensure_tenant_for_user", { p_user: user.id, p_email: user.email ?? "" });
    profile = await dbOne(env, `profiles?id=eq.${user.id}&select=tenant_id,role`);
    if (!profile) throw new ApiError(500, "E_NO_TENANT", "could not create a workspace for this account");
  }
  const tenant = await dbOne<{ plan: string }>(env, `tenants?id=eq.${profile.tenant_id}&select=plan`);
  return {
    userId: user.id,
    email: user.email ?? "",
    tenantId: profile.tenant_id,
    role: profile.role,
    plan: planFor(tenant?.plan),
  };
}

export function requireEditor(caller: Caller) {
  if (caller.role === "viewer") throw new ApiError(403, "E_FORBIDDEN", "viewers cannot change projects");
}

/** The Container authenticates its calls back to the Worker with the shared secret. */
export function requireInternal(req: Request, env: Env) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!internalSecret(env) || !safeEqual(token, internalSecret(env))) {
    throw new ApiError(401, "E_UNAUTHORIZED", "internal route");
  }
}
