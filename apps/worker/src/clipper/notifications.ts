import { appUrl, type Env } from "./env";
import { dbJson } from "./db";
import { GUEST_TENANT } from "./plans";
import { sendTemplate } from "./accounts";
import { overviewData } from "./admin";
import { getSettings, updateSettings } from "./settings";

/**
 * Emails that go out on their own, from the 10-minute cron:
 *   - "Your clips are ready" to a project's owner when processing finishes —
 *     long streams take a while, and people leave the tab;
 *   - an alert to the admins when jobs fail;
 *   - a daily summary to the admins (first run after 08:00 UTC).
 *
 * A cursor in the Worker's settings marks how far we've emailed, so nothing
 * is sent twice and nothing from before this feature existed is sent at all.
 */
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const admins = (env: Env) => (env.CLIPPER_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export async function sendNotifications(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const settings = await getSettings(env);
  const cursor = settings.notify_cursor;
  if (!cursor) { await updateSettings(env, (s) => ({ ...s, notify_cursor: now })); return; }

  // 1. Clips ready → the project's owner.
  const ready = await dbJson<{ id: string; tenant_id: string; title: string; candidate_count: number | null }[]>(env,
    `projects?status=eq.ready&deleted_at=is.null&updated_at=gt.${cursor}&tenant_id=neq.${GUEST_TENANT}&select=id,tenant_id,title,candidate_count&limit=50`);
  for (const p of ready) {
    const marker = `_clipper/notified/ready-${p.id}`;
    if (await env.R2_BUCKET.head(marker)) continue;
    await env.R2_BUCKET.put(marker, now);
    try {
      const [owner] = await dbJson<{ email: string }[]>(env, `profiles?tenant_id=eq.${p.tenant_id}&role=eq.owner&select=email&limit=1`);
      if (!owner?.email) continue;
      const top = await dbJson<{ t_in_ms: number; t_out_ms: number; score: number; features: { context_title?: string; title?: string } }[]>(env,
        `candidates?project_id=eq.${p.id}&select=t_in_ms,t_out_ms,score,features&order=score.desc&limit=3`);
      if (!top.length) continue;
      const head = (c: (typeof top)[number]) => c.features?.context_title || c.features?.title || "A strong moment";
      const clips = top.map((c, i) => `<div style="padding:10px 12px;margin:0 0 8px 0;border:1px solid #e4e4f0;border-radius:10px;">
  <div style="font-size:14px;font-weight:700;color:#12121a;">${i + 1}. ${esc(head(c))}</div>
  <div style="font-size:12px;color:#5d5f75;margin-top:2px;">at ${clock(c.t_in_ms)} · ${Math.round((c.t_out_ms - c.t_in_ms) / 1000)} s · score ${Math.round(c.score)}</div>
</div>`).join("\n");
      await sendTemplate(env, "clips-ready", owner.email, {
        link: `${appUrl(env)}/projects/view?id=${p.id}`, title: p.title || "your video",
        count: String(p.candidate_count ?? top.length), top: head(top[0]), clips,
      });
    } catch (e) {
      console.error(`[clipper notify] ready ${p.id}: ${String(e)}`);
    }
  }

  const to = admins(env);
  if (to.length) {
    // 2. Failures → admins (one email per run, listing them all).
    const failed = await dbJson<{ id: string; title: string; error_code: string | null; error_detail: string | null }[]>(env,
      `projects?status=eq.failed&updated_at=gt.${cursor}&select=id,title,error_code,error_detail&limit=20`);
    const failedExports = await dbJson<{ id: string; preset: string; error_code: string | null; error_detail: string | null }[]>(env,
      `render_jobs?status=eq.failed&finished_at=gt.${cursor}&select=id,preset,error_code,error_detail&limit=20`).catch(() => []);
    const items = [
      ...failed.map((f) => ({ what: `Project “${f.title}”`, why: `${f.error_code ?? "error"}: ${f.error_detail ?? ""}` })),
      ...failedExports.map((r) => ({ what: `Export (${r.preset})`, why: `${r.error_code ?? "error"}: ${r.error_detail ?? ""}` })),
    ];
    if (items.length) {
      const rows = items.map((x) => `<div style="padding:8px 0;border-bottom:1px solid #f0f0f6;"><strong>${esc(x.what)}</strong><br><span style="color:#b42318;">${esc(x.why.slice(0, 240))}</span></div>`).join("\n");
      for (const a of to) {
        await sendTemplate(env, "admin-alert", a, { link: `${appUrl(env)}/admin#jobs`, count: String(items.length), first: items[0].what, rows })
          .catch((e) => console.error(`[clipper notify] alert: ${String(e)}`));
      }
    }

    // 3. Daily summary → admins.
    const today = now.slice(0, 10);
    if (new Date().getUTCHours() >= 8 && settings.daily_sent !== today) {
      await updateSettings(env, (s) => ({ ...s, daily_sent: today }));
      const d = await overviewData(env);
      const line = (k: string, v: string) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #f0f0f6;"><tr><td style="padding:6px 0;color:#5d5f75;">${k}</td><td align="right" style="padding:6px 0;font-weight:700;color:#12121a;">${esc(v)}</td></tr></table>`;
      const rows = [
        line("Users", `${d.users} (+${d.new_users_this_month} this month)`),
        line("Paying", `${d.paying} · $${d.mrr_usd}/mo`),
        line("Minutes processed", String(d.minutes_this_month)),
        line("Projects / exports", `${d.projects_this_month} / ${d.exports_this_month}`),
        line("Failed in the last 24 h", String(d.failed_last_24h)),
        line("Guest mode", d.guest_mode ? "ON — anyone can use it free" : "off"),
      ].join("\n");
      for (const a of to) {
        await sendTemplate(env, "admin-daily", a, {
          link: `${appUrl(env)}/admin`, users: String(d.users), mrr: String(d.mrr_usd), new_users: String(d.new_users_this_month),
          minutes: String(d.minutes_this_month), failed: String(d.failed_last_24h), rows,
        }).catch((e) => console.error(`[clipper notify] daily: ${String(e)}`));
      }
    }
  }

  await updateSettings(env, (s) => ({ ...s, notify_cursor: now }));
}
