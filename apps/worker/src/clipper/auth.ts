import { internalSecret, type Env } from "./env";
import { dbJson, dbOne, rpc } from "./db";
import { ApiError, safeEqual } from "./http";
import { planFor, type Plan } from "./plans";
import { verifyGithubRunner } from "./github-oidc";

export interface Caller {
  /** "" for a guest — never write it to a column that references auth.users. */
  userId: string;
  email: string;
  tenantId: string;
  role: "owner" | "editor" | "viewer";
  plan: Plan;
  guest: boolean;
}

/**
 * GUEST MODE — for testing without an account. A request with no sign-in
 * uses ONE shared workspace on the Creator plan (600 source minutes a month,
 * no watermark), shared by everyone with the link. On until
 * CLIPPER_GUEST_MODE = "off" is set on the Worker.
 */
export { GUEST_TENANT } from "./plans";
import { GUEST_TENANT, guestPlan } from "./plans";
let guestReady = false;

async function guestCaller(env: Env): Promise<Caller> {
  if (!guestReady) {
    await dbJson(env, "tenants?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify([{ id: GUEST_TENANT, name: "Guest (testing)", plan: "creator" }]),
    });
    guestReady = true;
  }
  return { userId: "", email: "", tenantId: GUEST_TENANT, role: "owner", plan: guestPlan(), guest: true };
}

const guestAllowed = (env: Env) => (env.CLIPPER_GUEST_MODE ?? "on").trim().toLowerCase() !== "off";

/** Verifies the Supabase JWT (the same accounts as PocketAthlete) and loads the Clipper workspace. */
export async function requireCaller(req: Request, env: Env): Promise<Caller> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) {
    if (guestAllowed(env)) return guestCaller(env);
    throw new ApiError(401, "E_UNAUTHORIZED", "sign in first");
  }
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
    guest: false,
  };
}

export function requireEditor(caller: Caller) {
  if (caller.role === "viewer") throw new ApiError(403, "E_FORBIDDEN", "viewers cannot change projects");
}

/**
 * Who may call /v1/internal/*: the Cloudflare Container (shared secret it gets
 * as an env var) or a GitHub Actions run of clipper-job.yml (GitHub OIDC token,
 * no secret involved).
 */
export async function requireInternal(req: Request, env: Env): Promise<void> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (internalSecret(env) && safeEqual(token, internalSecret(env))) return;
  if (token.split(".").length === 3 && await verifyGithubRunner(token, (env.CLIPPER_GITHUB_REPO || "Megablaze757/clipfarm").trim())) return;
  throw new ApiError(401, "E_UNAUTHORIZED", "internal route");
}
