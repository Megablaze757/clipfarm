import { appUrl, type Env } from "./env";
import { ApiError, body, json } from "./http";
import { renderEmail, type TemplateName } from "./email-templates";
import type { Caller } from "./auth";
import { notePendingReferral } from "./referrals";

/**
 * Clipper's own account emails.
 *
 * Clipper shares PocketAthlete's Supabase project (same accounts), and that
 * project's email templates link to PocketAthlete's site — so a Clipper user
 * confirming their email or resetting a password would land on the wrong app.
 * Instead, the Worker asks Supabase for the one-time token (Admin
 * generate_link) and sends a Clipper email whose link comes back to Clipper's
 * /login or /reset-password, where the page spends it with verifyOtp.
 *
 * Token-hash links (not Supabase's redirect URL) work in any browser or mail
 * app — the same choice FootballFitnessGuru made, for the same reasons.
 *
 * Passwords pass straight through to Supabase over TLS; nothing is stored here.
 */

type LinkType = "signup" | "recovery" | "magiclink";

async function generateLink(env: Env, type: LinkType, email: string, password?: string): Promise<{ hashed_token?: string; error?: string; status: number }> {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type, email, ...(password ? { password } : {}) }),
  });
  const j = (await r.json().catch(() => ({}))) as { hashed_token?: string; properties?: { hashed_token?: string }; msg?: string; message?: string; error_description?: string };
  return { hashed_token: j.hashed_token ?? j.properties?.hashed_token, error: j.msg ?? j.message ?? j.error_description, status: r.status };
}

const emailOk = (e: unknown): e is string => typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) && e.length <= 254;

/** One email per address per minute — the button can't be used to spam someone. */
async function throttled(env: Env, kind: string, email: string): Promise<boolean> {
  const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${email.toLowerCase()}`)))]
    .slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `_clipper/throttle/${h}`;
  const prev = await env.R2_BUCKET.head(key);
  if (prev && Date.now() - prev.uploaded.getTime() < 60_000) return true;
  await env.R2_BUCKET.put(key, "1");
  return false;
}

/**
 * CLIPPER'S OWN SENDER. Same delivery channels as PocketAthlete (its Gmail
 * Apps Script or Resend — the Worker's existing secrets), but every email goes
 * out as "Clipper": its own From name, and no PocketAthlete reply-to.
 *
 *   CLIPPER_EMAIL_FROM  e.g. "Clipper <hello@yourdomain.com>" (optional). By
 *                       default: "Clipper" + the address the sender already
 *                       uses (Gmail always sends from its own account; Resend
 *                       needs a verified domain, so the address is kept).
 *   CLIPPER_REPLY_TO    optional reply address just for Clipper.
 */
const v = (env: Env, name: string) => String((env as unknown as Record<string, unknown>)[name] ?? "").trim();
export function clipperFrom(env: Env): string {
  const explicit = v(env, "CLIPPER_EMAIL_FROM");
  if (explicit) return explicit;
  const shared = v(env, "REMINDER_FROM");
  const address = (shared.match(/<([^>]+)>/)?.[1] ?? shared).trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) ? `Clipper <${address}>` : "Clipper";
}

/** Renders a template from email-templates/ and sends it as Clipper. */
export async function sendTemplate(env: Env, name: TemplateName, to: string, vars: Record<string, string | undefined> = {}): Promise<void> {
  const mail = renderEmail(name, { ...vars, email: to, app_url: appUrl(env) });
  await deliver(env, to, mail.subject, mail);
}

async function deliver(env: Env, to: string, subject: string, mail: { html: string; text: string }): Promise<void> {
  const from = clipperFrom(env), replyTo = v(env, "CLIPPER_REPLY_TO");
  let ok = false, error = "no email provider is set on the Worker";
  try {
    const gas = v(env, "GAS_EMAIL_URL"), resendKey = v(env, "RESEND_API_KEY");
    if (gas) {
      const r = await fetch(gas, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: v(env, "GAS_EMAIL_SECRET"), to, subject, html: mail.html, text: mail.text, from, ...(replyTo ? { replyTo } : {}) }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
      ok = r.ok; error = j.error ?? j.message ?? `Gmail sender returned ${r.status}`;
    } else if (resendKey) {
      if (!from.includes("@")) throw new Error("set CLIPPER_EMAIL_FROM (e.g. Clipper <hello@yourdomain.com>) to send with Resend");
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, html: mail.html, text: mail.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; name?: string };
      ok = r.ok; error = j.message ?? j.name ?? `Resend returned ${r.status}`;
    }
  } catch (e) {
    error = (e as Error).message;
  }
  if (!ok) {
    console.error(`[clipper email] ${subject} → failed: ${error}`);
    throw new ApiError(503, "E_EMAIL_UNAVAILABLE", "we couldn't send the email just now — try again in a minute");
  }
}

/** POST /v1/auth/signup {email, password} — creates the account and sends a Clipper confirmation email. */
export async function signup(req: Request, env: Env): Promise<Response> {
  const { email, password, ref } = await body<{ email?: string; password?: string; ref?: string }>(req);
  if (!emailOk(email)) throw new ApiError(400, "E_VALIDATION", "enter a valid email address");
  if (typeof password !== "string" || password.length < 8) throw new ApiError(400, "E_VALIDATION", "passwords need at least 8 characters");
  if (await throttled(env, "signup", email)) throw new ApiError(429, "E_RATE_LIMITED", "wait a minute before trying again");
  const link = await generateLink(env, "signup", email.trim(), password);
  if (!link.hashed_token) {
    if (link.status === 422 || /already|registered|exists/i.test(link.error ?? "")) {
      return json({ exists: true, message: "That email already has an account — sign in, or use “Forgot password?”." });
    }
    throw new ApiError(502, "E_AUTH", link.error ?? "couldn't create the account");
  }
  const url = `${appUrl(env)}/login?token_hash=${encodeURIComponent(link.hashed_token)}&type=signup`;
  await sendTemplate(env, "confirm-signup", email.trim(), { link: url });
  await notePendingReferral(env, email.trim(), ref).catch(() => {});
  return json({ sent: true });
}

/** POST /v1/auth/recover {email} — always "sent", so it can't be used to find out who has an account. */
export async function recover(req: Request, env: Env): Promise<Response> {
  const { email } = await body<{ email?: string }>(req);
  if (!emailOk(email)) throw new ApiError(400, "E_VALIDATION", "enter a valid email address");
  if (await throttled(env, "recover", email)) return json({ sent: true });
  const link = await generateLink(env, "recovery", email.trim());
  if (link.hashed_token) {
    const url = `${appUrl(env)}/reset-password?token_hash=${encodeURIComponent(link.hashed_token)}&type=recovery`;
    await sendTemplate(env, "reset-password", email.trim(), { link: url });
  }
  return json({ sent: true });
}

/** POST /v1/auth/resend {email} — a fresh sign-in link that also confirms the address. */
export async function resend(req: Request, env: Env): Promise<Response> {
  const { email } = await body<{ email?: string }>(req);
  if (!emailOk(email)) throw new ApiError(400, "E_VALIDATION", "enter a valid email address");
  if (await throttled(env, "resend", email)) throw new ApiError(429, "E_RATE_LIMITED", "wait a minute before sending another");
  const link = await generateLink(env, "magiclink", email.trim());
  if (link.hashed_token) {
    const url = `${appUrl(env)}/login?token_hash=${encodeURIComponent(link.hashed_token)}&type=magiclink`;
    await sendTemplate(env, "sign-in-link", email.trim(), { link: url });
  }
  return json({ sent: true });
}

/**
 * POST /v1/auth/password-changed — the signed-in user's security notice after
 * they change their password. Only ever sent to the caller's OWN confirmed
 * address, at most once a minute.
 */
export async function passwordChanged(env: Env, caller: Caller): Promise<Response> {
  if (caller.guest || !caller.email) throw new ApiError(401, "E_UNAUTHORIZED", "sign in first");
  if (await throttled(env, "pwchanged", caller.email)) return json({ sent: false });
  const when = new Date().toUTCString().replace(" GMT", " UTC");
  await sendTemplate(env, "password-changed", caller.email, { link: `${appUrl(env)}/login?mode=forgot`, when });
  return json({ sent: true });
}
