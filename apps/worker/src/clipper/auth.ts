import { internalSecret, type Env } from "./env";
import { dbJson, dbOne, dbPatch, rpc } from "./db";
import { ApiError, safeEqual } from "./http";
import { planFor, type Plan } from "./plans";
import { verifyGithubRunner } from "./github-oidc";
import { guestModeOn } from "./settings";
import { bonusMinutes } from "./referrals";

export interface Caller {
  /** "" for a guest — never write it to a column that references auth.users. */
  userId: string;
  email: string;
  tenantId: string;
  role: "owner" | "editor" | "viewer";
  plan: Plan;
  guest: boolean;
  /** Platform admin (see isAdminUser) — the admin panel, any workspace, unlimited plan. */
  admin: boolean;
}

/**
 * WHO IS AN ADMIN — decided here, on the Worker, from the verified session;
 * the web app only hides or shows the panel. Same model as FootballFitnessGuru
 * (role = 'admin' on the account), and the two apps share accounts:
 *   - an admin on PocketAthlete (public.profiles.role = 'admin'), or
 *   - an address in CLIPPER_ADMIN_EMAILS (a Worker secret, comma-separated).
 * Either way the email must be CONFIRMED, so nobody can sign up with an
 * admin's address and get in before proving they own it.
 */
export async function isAdminUser(env: Env, user: { id: string; email?: string; email_confirmed_at?: string | null }): Promise<boolean> {
  if (!user.email_confirmed_at || !user.email) return false;
  const listed = (env.CLIPPER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (listed.includes(user.email.toLowerCase())) return true;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const rows = r.ok ? ((await r.json()) as { role?: string }[]) : [];
    return rows[0]?.role === "admin";
  } catch {
    return false;
  }
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
  return { userId: "", email: "", tenantId: GUEST_TENANT, role: "owner", plan: guestPlan(), guest: true, admin: false };
}


/** Verifies the Supabase JWT (the same accounts as PocketAthlete) and loads the Clipper workspace. */
export async function requireCaller(req: Request, env: Env): Promise<Caller> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) {
    if (await guestModeOn(env)) return guestCaller(env);
    throw new ApiError(401, "E_UNAUTHORIZED", "sign in first");
  }
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!r.ok) throw new ApiError(401, "E_UNAUTHORIZED", "session expired — sign in again");
  const user = (await r.json()) as { id?: string; email?: string; email_confirmed_at?: string | null };
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
  const admin = await isAdminUser(env, { id: user.id, email: user.email, email_confirmed_at: user.email_confirmed_at });
  // An admin's own workspace runs on the unlimited internal plan — set on the
  // tenant row too, so the processing runner gets the same limits.
  if (admin && tenant?.plan !== "enterprise") await dbPatch(env, `tenants?id=eq.${profile.tenant_id}`, { plan: "enterprise" }).catch(() => {});
  return {
    userId: user.id,
    email: user.email ?? "",
    tenantId: profile.tenant_id,
    role: profile.role,
    plan: await withBonus(env, profile.tenant_id, planFor(admin ? "enterprise" : tenant?.plan)),
    guest: false,
    admin,
  };
}

/** Referral bonus minutes add to the monthly allowance (referrals.ts). */
async function withBonus(env: Env, tenantId: string, plan: Plan): Promise<Plan> {
  const bonus = await bonusMinutes(env, tenantId).catch(() => 0);
  return bonus ? { ...plan, monthlyMinutes: plan.monthlyMinutes + bonus } : plan;
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
