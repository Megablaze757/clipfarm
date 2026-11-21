import type { Env } from "./env";
import type { Caller } from "./auth";
import { dbCount, dbJson, dbPatch } from "./db";
import { ApiError, body, json, requireUuid } from "./http";
import { PLANS, type Plan } from "./plans";
import { dispatchProject, IN_FLIGHT } from "./jobs";
import { setupStripe, stripeOverview } from "./billing";
import { getSettings, guestModeOn, updateSettings } from "./settings";

/**
 * The admin panel's API — every route checks the role HERE, from the verified
 * session (see isAdminUser in auth.ts). The web app showing or hiding the
 * panel is a convenience, never the permission.
 *
 * Admins read across all workspaces, so these queries are deliberately
 * NOT tenant-filtered — which is exactly why nothing else may call them.
 */
export function requireAdmin(caller: Caller): void {
  if (!caller.admin) throw new ApiError(403, "E_FORBIDDEN", "admins only");
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };
const PAID = ["active", "trialing", "past_due"];

/** GET /v1/admin/overview — the numbers that matter at a glance. */
export async function overview(env: Env): Promise<Response> {
  const since = monthStart(), day = new Date(Date.now() - 86_400_000).toISOString();
  const [users, newUsers, tenants, subs, usage, projectsMonth, failedDay, inFlight, rendersMonth] = await Promise.all([
    dbCount(env, "profiles?select=id"),
    dbCount(env, `profiles?created_at=gte.${since}&select=id`),
    dbJson<{ plan: string }[]>(env, "tenants?select=plan&limit=10000"),
    dbJson<{ tenant_id: string; status: string; price_id: string | null }[]>(env, `subscriptions?status=in.(${PAID.join(",")})&select=tenant_id,status,price_id&limit=10000`),
    dbJson<{ quantity: number }[]>(env, `usage_events?kind=eq.ingest&created_at=gte.${since}&select=quantity&limit=100000`),
    dbCount(env, `projects?created_at=gte.${since}&select=id`),
    dbCount(env, `projects?status=eq.failed&updated_at=gte.${day}&select=id`),
    dbCount(env, `projects?status=in.(${IN_FLIGHT.join(",")})&select=id`),
    dbCount(env, `render_jobs?status=eq.completed&queued_at=gte.${since}&select=id`),
  ]);
  const byPlan: Record<string, number> = {};
  for (const t of tenants) byPlan[t.plan] = (byPlan[t.plan] ?? 0) + 1;
  const planOf = new Map<string, string>();
  const tenantPlans = await dbJson<{ id: string; plan: string }[]>(env,
    `tenants?id=in.(${[...new Set(subs.map((s) => s.tenant_id))].join(",") || "00000000-0000-0000-0000-000000000000"})&select=id,plan`);
  for (const t of tenantPlans) planOf.set(t.id, t.plan);
  const mrr = subs.reduce((sum, s) => sum + (PLANS[(planOf.get(s.tenant_id) ?? "free") as Plan["id"]]?.priceUsd ?? 0), 0);
  return json({
    users, new_users_this_month: newUsers, workspaces: tenants.length, workspaces_by_plan: byPlan,
    paying: subs.length, mrr_usd: mrr,
    minutes_this_month: Math.round(usage.reduce((a, u) => a + Number(u.quantity || 0), 0)),
    projects_this_month: projectsMonth, exports_this_month: rendersMonth,
    failed_last_24h: failedDay, processing_now: inFlight,
    guest_mode: await guestModeOn(env),
  });
}

/** GET /v1/admin/users?q= — people, their plan, and what they've used this month. */
export async function users(req: Request, env: Env): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const filter = q ? `&email=ilike.*${encodeURIComponent(q.replace(/[*,()]/g, ""))}*` : "";
  const members = await dbJson<{ id: string; email: string; role: string; tenant_id: string; created_at: string }[]>(env,
    `profiles?select=id,email,role,tenant_id,created_at&order=created_at.desc&limit=200${filter}`);
  const ids = [...new Set(members.map((m) => m.tenant_id))];
  if (!ids.length) return json({ users: [] });
  const inList = ids.join(",");
  const since = monthStart();
  const [tenants, usage, projects, subs] = await Promise.all([
    dbJson<{ id: string; plan: string; name: string }[]>(env, `tenants?id=in.(${inList})&select=id,plan,name`),
    dbJson<{ tenant_id: string; quantity: number }[]>(env, `usage_events?tenant_id=in.(${inList})&kind=eq.ingest&created_at=gte.${since}&select=tenant_id,quantity&limit=100000`),
    dbJson<{ tenant_id: string }[]>(env, `projects?tenant_id=in.(${inList})&select=tenant_id&limit=100000`),
    dbJson<{ tenant_id: string; status: string; cancel_at_period_end: boolean; current_period_end: string | null }[]>(env,
      `subscriptions?tenant_id=in.(${inList})&select=tenant_id,status,cancel_at_period_end,current_period_end&order=updated_at.desc`),
  ]);
  const t = new Map(tenants.map((x) => [x.id, x]));
  const minutes = new Map<string, number>(), count = new Map<string, number>();
  for (const u of usage) minutes.set(u.tenant_id, (minutes.get(u.tenant_id) ?? 0) + Number(u.quantity || 0));
  for (const p of projects) count.set(p.tenant_id, (count.get(p.tenant_id) ?? 0) + 1);
  const sub = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (!sub.has(s.tenant_id)) sub.set(s.tenant_id, s);
  return json({
    users: members.map((m) => ({
      id: m.id, email: m.email, role: m.role, joined: m.created_at, tenant_id: m.tenant_id,
      plan: t.get(m.tenant_id)?.plan ?? "free",
      minutes_this_month: Math.round(minutes.get(m.tenant_id) ?? 0),
      projects: count.get(m.tenant_id) ?? 0,
      subscription: sub.get(m.tenant_id) ?? null,
    })),
  });
}

/** POST /v1/admin/workspaces/:tenantId/plan {plan} — comp or change a plan (Stripe isn't charged or changed). */
export async function setPlan(req: Request, env: Env, tenantId: string): Promise<Response> {
  const { plan } = await body<{ plan?: string }>(req);
  if (!plan || !PLANS[plan as Plan["id"]]) throw new ApiError(400, "E_VALIDATION", `plan must be one of ${Object.keys(PLANS).join(", ")}`);
  const [row] = await dbPatch<{ id: string; plan: string }>(env, `tenants?id=eq.${requireUuid(tenantId, "workspace")}`, { plan });
  if (!row) throw new ApiError(404, "E_NOT_FOUND", "workspace not found");
  return json({ id: row.id, plan: row.plan });
}

/** GET /v1/admin/jobs — recent projects and failed exports, every workspace. */
export async function jobs(env: Env): Promise<Response> {
  const [projects, renders] = await Promise.all([
    dbJson<Record<string, unknown>[]>(env,
      "projects?select=id,tenant_id,title,status,progress,error_code,error_detail,duration_ms,source_kind,created_at,updated_at&deleted_at=is.null&order=created_at.desc&limit=60"),
    dbJson<Record<string, unknown>[]>(env,
      "render_jobs?status=eq.failed&select=id,tenant_id,clip_id,preset,error_code,error_detail,queued_at&order=queued_at.desc&limit=20"),
  ]);
  return json({ projects, failed_exports: renders });
}

/** POST /v1/admin/projects/:id/retry — re-run any failed project. */
export async function retry(env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const [row] = await dbPatch<{ id: string }>(env, `projects?id=eq.${requireUuid(id, "project")}&status=eq.failed`,
    { status: "queued", error_code: null, error_detail: null, dispatched_at: null });
  if (!row) throw new ApiError(409, "E_CONFLICT", "only failed projects can be retried");
  ctx.waitUntil(dispatchProject(env, row.id).catch((e) => console.error(String(e))));
  return json({ id: row.id, status: "queued" });
}

/** GET /v1/admin/payments — Stripe status, prices, and who's paying. */
export async function payments(env: Env): Promise<Response> {
  const [stripe, subs] = await Promise.all([
    stripeOverview(env),
    dbJson<Record<string, unknown>[]>(env,
      "subscriptions?select=tenant_id,status,price_id,current_period_end,cancel_at_period_end,updated_at&order=updated_at.desc&limit=100"),
  ]);
  const ids = [...new Set(subs.map((s) => String(s.tenant_id)))];
  const owners = ids.length
    ? await dbJson<{ tenant_id: string; email: string }[]>(env, `profiles?tenant_id=in.(${ids.join(",")})&role=eq.owner&select=tenant_id,email`)
    : [];
  const email = new Map(owners.map((o) => [o.tenant_id, o.email]));
  return json({
    stripe,
    plans: Object.values(PLANS).map((p) => ({ id: p.id, label: p.label, price_usd: p.priceUsd, minutes: p.monthlyMinutes, watermark: p.watermark })),
    subscriptions: subs.map((s) => ({ ...s, email: email.get(String(s.tenant_id)) ?? null })),
  });
}

export async function paymentsSetup(env: Env): Promise<Response> {
  return json(await setupStripe(env));
}

/** GET/PATCH /v1/admin/settings — switches the admin can flip without a redeploy. */
export async function settings(req: Request, env: Env): Promise<Response> {
  if (req.method === "PATCH") {
    const b = await body<{ guest_mode?: boolean }>(req);
    if (typeof b.guest_mode === "boolean") await updateSettings(env, (s) => ({ ...s, guest_mode: b.guest_mode }));
  }
  const s = await getSettings(env);
  return json({
    guest_mode: await guestModeOn(env),
    guest_mode_forced_off: (env.CLIPPER_GUEST_MODE ?? "").trim().toLowerCase() === "off",
    updated_at: s.updated_at ?? null,
  });
}
