import { appUrl, internalSecret, type Env } from "./env";
import type { Caller } from "./auth";
import { dbJson } from "./db";
import { json } from "./http";

/**
 * REFERRALS — "give 2 hours, get 2 hours". Everyone has a code; a new account
 * that signs up with it is marked, and when that account's FIRST project
 * finishes (so throwaway sign-ups earn nothing), both workspaces get
 * +120 bonus minutes. Bonus minutes add to the monthly allowance and
 * don't expire.
 */
export const REFERRAL_BONUS_MINUTES = 120;
const enc = new TextEncoder();
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function sha(s: string): Promise<Uint8Array> { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
export async function codeFor(env: Env, tenantId: string): Promise<string> {
  const h = await sha(`ref:${internalSecret(env)}:${tenantId}`);
  return [...h.slice(0, 7)].map((b) => ALPHA[b % ALPHA.length]).join("");
}
const emailKey = async (email: string) => `_clipper/referrals/pending/${[...(await sha(email.toLowerCase())).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}.json`;

/** GET /v1/referral — your code, link and what it has earned. */
export async function myReferral(env: Env, caller: Caller): Promise<Response> {
  if (caller.guest) return json({ code: null });
  const code = await codeFor(env, caller.tenantId);
  await env.R2_BUCKET.put(`_clipper/referrals/codes/${code}.json`, JSON.stringify({ tenant_id: caller.tenantId }));
  const bonus = await bonusMinutes(env, caller.tenantId);
  return json({ code, link: `${appUrl(env)}/login?mode=sign_up&ref=${code}`, bonus_minutes: bonus, reward_minutes: REFERRAL_BONUS_MINUTES });
}

/** Called at sign-up (accounts.ts): remember who referred this email. */
export async function notePendingReferral(env: Env, email: string, code: string | undefined): Promise<void> {
  const c = String(code ?? "").trim().toUpperCase();
  if (!/^[A-Z2-9]{7}$/.test(c)) return;
  const owner = (await (await env.R2_BUCKET.get(`_clipper/referrals/codes/${c}.json`))?.json().catch(() => null)) as { tenant_id: string } | null;
  if (!owner) return;
  await env.R2_BUCKET.put(await emailKey(email), JSON.stringify({ code: c, referrer: owner.tenant_id, at: new Date().toISOString() }));
}

export async function bonusMinutes(env: Env, tenantId: string): Promise<number> {
  const o = await env.R2_BUCKET.get(`_clipper/bonus/${tenantId}.json`).catch(() => null);
  return o ? Number(((await o.json().catch(() => ({}))) as { minutes?: number }).minutes) || 0 : 0;
}
async function addBonus(env: Env, tenantId: string, minutes: number): Promise<void> {
  const cur = await bonusMinutes(env, tenantId);
  await env.R2_BUCKET.put(`_clipper/bonus/${tenantId}.json`, JSON.stringify({ minutes: cur + minutes, updated_at: new Date().toISOString() }));
}

/** From the notifications cron: a project finished — pay out a pending referral, once. */
export async function rewardOnFirstProject(env: Env, tenantId: string, ownerEmail: string): Promise<void> {
  const key = await emailKey(ownerEmail);
  const pending = (await (await env.R2_BUCKET.get(key))?.json().catch(() => null)) as { referrer: string } | null;
  if (!pending || pending.referrer === tenantId) return;
  const done = await dbJson<{ id: string }[]>(env, `projects?tenant_id=eq.${tenantId}&status=eq.ready&select=id&limit=2`).catch(() => []);
  if (!done.length) return;
  await env.R2_BUCKET.delete(key); // pay once
  await addBonus(env, tenantId, REFERRAL_BONUS_MINUTES);
  await addBonus(env, pending.referrer, REFERRAL_BONUS_MINUTES);
}
