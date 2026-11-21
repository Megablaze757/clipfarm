import { appUrl, type Env } from "./env";
import { ApiError, body, json } from "./http";
import { sendEmail } from "../pocketathlete/index";

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

function page(title: string, intro: string, button: string, link: string, outro: string): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#0b1020;font-family:Inter,Segoe UI,Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:40px 24px;color:#e2e8f0">
  <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:24px">✂️ Clipper</div>
  <h1 style="font-size:20px;color:#fff;margin:0 0 12px">${title}</h1>
  <p style="font-size:14px;line-height:1.6;color:#cbd5e1;margin:0 0 24px">${intro}</p>
  <a href="${link}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:12px">${button}</a>
  <p style="font-size:12px;line-height:1.6;color:#94a3b8;margin:24px 0 0">${outro}</p>
  <p style="font-size:11px;color:#64748b;margin:16px 0 0;word-break:break-all">Or paste this link into your browser:<br>${link}</p>
</div></body></html>`;
  return { html, text: `${title}\n\n${intro}\n\n${button}: ${link}\n\n${outro}` };
}

async function deliver(env: Env, to: string, subject: string, mail: { html: string; text: string }): Promise<void> {
  const r = await sendEmail(env, to, subject, mail.html, mail.text);
  if (!r.ok) throw new ApiError(503, "E_EMAIL_UNAVAILABLE", `couldn't send the email (${r.error ?? "no email provider"})`);
}

/** POST /v1/auth/signup {email, password} — creates the account and sends a Clipper confirmation email. */
export async function signup(req: Request, env: Env): Promise<Response> {
  const { email, password } = await body<{ email?: string; password?: string }>(req);
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
  await deliver(env, email.trim(), "Confirm your Clipper account", page(
    "Confirm your email", "Tap the button to confirm your email and finish creating your Clipper account.",
    "Confirm email", url, "If you didn't sign up for Clipper, ignore this email — no account will be activated."));
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
    await deliver(env, email.trim(), "Reset your Clipper password", page(
      "Reset your password", "Tap the button to choose a new password for your Clipper account. The link works once and expires in an hour.",
      "Choose a new password", url, "If you didn't ask for this, ignore this email — your password stays the same."));
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
    await deliver(env, email.trim(), "Your Clipper sign-in link", page(
      "Confirm and sign in", "Tap the button to confirm your email and sign in to Clipper.",
      "Sign in to Clipper", url, "If you didn't ask for this, ignore this email."));
  }
  return json({ sent: true });
}
