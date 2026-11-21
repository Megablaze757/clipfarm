import { appUrl, type Env } from "./env";
import type { Caller } from "./auth";
import { dbInsert, dbJson, dbOne, dbPatch } from "./db";
import { ApiError, body, json, requireUuid } from "./http";
import { sendTemplate } from "./accounts";

/**
 * TEAM WORKSPACES — the owner invites people by email as editors or viewers
 * (roles already exist on clip_members). Accepting moves the person's account
 * into the inviter's workspace; only the invited, confirmed address can
 * accept. Invites live 7 days in the bucket.
 */
interface Invite { token: string; tenant_id: string; email: string; role: "editor" | "viewer"; invited_by: string; expires_at: string }
const inviteKey = (t: string) => `_clipper/invites/${t}.json`;

function requireOwner(caller: Caller) {
  if (caller.guest) throw new ApiError(401, "E_UNAUTHORIZED", "sign in to manage a team");
  if (caller.role !== "owner") throw new ApiError(403, "E_FORBIDDEN", "only the workspace owner can manage the team");
}

/** GET /v1/team */
export async function getTeam(env: Env, caller: Caller): Promise<Response> {
  if (caller.guest) return json({ members: [], invites: [], you: null });
  const members = await dbJson<{ id: string; email: string; role: string; created_at: string }[]>(env,
    `profiles?tenant_id=eq.${caller.tenantId}&select=id,email,role,created_at&order=created_at.asc`);
  const invites: Omit<Invite, "token">[] = [];
  if (caller.role === "owner") {
    const listed = await env.R2_BUCKET.list({ prefix: "_clipper/invites/", limit: 500 });
    for (const o of listed.objects) {
      const inv = (await (await env.R2_BUCKET.get(o.key))?.json().catch(() => null)) as Invite | null;
      if (inv && inv.tenant_id === caller.tenantId && new Date(inv.expires_at) > new Date()) { const { token: _t, ...rest } = inv; invites.push(rest); }
    }
  }
  return json({ members, invites, you: { id: caller.userId, role: caller.role } });
}

/** POST /v1/team/invites {email, role} */
export async function invite(req: Request, env: Env, caller: Caller): Promise<Response> {
  requireOwner(caller);
  const b = await body<{ email?: string; role?: string }>(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "E_VALIDATION", "enter a valid email address");
  if (email === caller.email.toLowerCase()) throw new ApiError(400, "E_VALIDATION", "that's you");
  const role = b.role === "viewer" ? "viewer" : "editor";
  const already = await dbOne(env, `profiles?tenant_id=eq.${caller.tenantId}&email=ilike.${encodeURIComponent(email)}&select=id`);
  if (already) throw new ApiError(409, "E_CONFLICT", "they're already in this workspace");
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const inv: Invite = { token, tenant_id: caller.tenantId, email, role, invited_by: caller.email, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() };
  await env.R2_BUCKET.put(inviteKey(token), JSON.stringify(inv));
  const ws = await dbOne<{ name: string }>(env, `tenants?id=eq.${caller.tenantId}&select=name`);
  await sendTemplate(env, "team-invite", email, {
    link: `${appUrl(env)}/invite?token=${token}`, inviter: caller.email, workspace: ws?.name ?? "their workspace", role: role === "editor" ? "an editor" : "a viewer",
  });
  return json({ invited: email, role }, 201);
}

/** POST /v1/team/accept {token} — the invited (signed-in, confirmed) person joins. */
export async function accept(req: Request, env: Env, caller: Caller): Promise<Response> {
  if (caller.guest) throw new ApiError(401, "E_UNAUTHORIZED", "sign in first");
  const { token } = await body<{ token?: string }>(req);
  if (!/^[0-9a-f]{48}$/.test(String(token ?? ""))) throw new ApiError(400, "E_VALIDATION", "invalid invite link");
  const inv = (await (await env.R2_BUCKET.get(inviteKey(String(token))))?.json().catch(() => null)) as Invite | null;
  if (!inv || new Date(inv.expires_at) < new Date()) throw new ApiError(410, "E_EXPIRED", "this invite has expired — ask for a new one");
  if (inv.email !== caller.email.toLowerCase()) throw new ApiError(403, "E_FORBIDDEN", `this invite is for ${inv.email} — sign in with that address`);
  await dbPatch(env, `profiles?id=eq.${caller.userId}`, { tenant_id: inv.tenant_id, role: inv.role });
  await env.R2_BUCKET.delete(inviteKey(String(token)));
  return json({ joined: inv.tenant_id, role: inv.role });
}

/** DELETE /v1/team/members/:id — they get a fresh workspace of their own. */
export async function removeMember(env: Env, caller: Caller, userId: string): Promise<Response> {
  requireOwner(caller);
  const id = requireUuid(userId, "member");
  if (id === caller.userId) throw new ApiError(400, "E_VALIDATION", "you can't remove yourself");
  const m = await dbOne<{ email: string }>(env, `profiles?id=eq.${id}&tenant_id=eq.${caller.tenantId}&select=email`);
  if (!m) throw new ApiError(404, "E_NOT_FOUND", "not in this workspace");
  const t = await dbInsert<{ id: string }>(env, "tenants", { name: (m.email.split("@")[0] || "My workspace").slice(0, 60) });
  await dbPatch(env, `profiles?id=eq.${id}`, { tenant_id: t.id, role: "owner" });
  return json({ removed: id });
}

/** DELETE /v1/team/invites/:email — cancel a pending invite. */
export async function cancelInvite(env: Env, caller: Caller, email: string): Promise<Response> {
  requireOwner(caller);
  const listed = await env.R2_BUCKET.list({ prefix: "_clipper/invites/", limit: 500 });
  for (const o of listed.objects) {
    const inv = (await (await env.R2_BUCKET.get(o.key))?.json().catch(() => null)) as Invite | null;
    if (inv && inv.tenant_id === caller.tenantId && inv.email === decodeURIComponent(email).toLowerCase()) await env.R2_BUCKET.delete(o.key);
  }
  return json({ cancelled: true });
}
