// =============================================================================
// COMBINED CLOUDFLARE WORKER BUNDLE (PocketAthlete + Clipper Platform)
// =============================================================================
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/launch-email.ts
function launchEmail({ appUrl, ref, unsubscribeUrl }) {
  const cta = ref ? `${appUrl}/?ref=${encodeURIComponent(ref)}` : `${appUrl}/`;
  const subject = "Pocket Athlete is live \u{1F525} you're in";
  const text = [
    "POCKET ATHLETE IS LIVE.",
    "",
    "You put your name down before there was anything to see. It's open now, and",
    "you're getting this before anyone else.",
    "",
    `Open it: ${cta}`,
    "",
    "Free to start. No card. About two minutes to your first four-week block.",
    "",
    "---",
    "",
    "MOST PLANS KNOW YOUR SPORT. THIS ONE KNOWS YOUR POSITION.",
    "",
    "A prop and a winger need different bodies, so they get different sessions.",
    "33 positions across 6 sports, each with their own movements, drills and",
    "challenges. Not one generic plan with your sport's name on the front.",
    "",
    "WHAT'S WAITING FOR YOU",
    "",
    "- Film a rep, watch it get read. Depth, tempo, bar path, the knee caving in",
    "  on rep 8 - with the drills to fix what it finds. The analysis runs on your",
    "  own phone.",
    "- A plan that reacts. Slept badly? Three taps and today eases off by itself.",
    "  It watches your training load and tells you to back off BEFORE the niggle.",
    "- Food that adds up. Calorie and macro targets, meal plans built round your",
    "  training, a shopping list with prices on it.",
    "- Something to chase. 136 challenges, 75 badges, and a rank ladder from Iron",
    "  to Legend. It pays you for rest days too, not just for grinding.",
    "",
    `Start here: ${cta}`,
    "",
    "See you in there.",
    "",
    "-",
    "You're getting this because you joined the Pocket Athlete waitlist.",
    `Unsubscribe: ${unsubscribeUrl}`
  ].join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .pa-bg    { background-color: #0b0f0d !important; }
    .pa-card  { background-color: #121714 !important; }
    .pa-h     { color: #f1f5f3 !important; }
    .pa-gold  { color: #e3b53f !important; }
    .pa-body  { color: #9fb0a8 !important; }
    .pa-muted { color: #6b7a73 !important; }
    .pa-tile  { background-color: #1a201c !important; }
    .pa-rule  { border-color: rgba(255,255,255,0.09) !important; }
    .pa-chip  { background-color: #1e1c14 !important; border-color: #4a3d17 !important; color: #e3b53f !important; }
  }
</style>
</head>
<body bgcolor="#eef1ec" style="margin:0;padding:0;background-color:#eef1ec;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">It's open. 33 positions, 6 sports, and your first plan is two minutes away.</div>
<table role="presentation" class="pa-bg" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef1ec" style="background-color:#eef1ec;padding:20px 12px;">
<tr><td align="center">
<table role="presentation" class="pa-card" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:560px;background-color:#ffffff;border-radius:20px;padding:30px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="padding-bottom:20px;">
    <span class="pa-h" style="font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#0e1411;">
      <span class="pa-gold" style="color:#8a6510;">&#9670;</span> PocketAthlete
    </span>
  </td></tr>
  <tr><td class="pa-gold" style="font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#8a6510;padding-bottom:8px;">
    Now live
  </td></tr>
  <tr><td class="pa-h" style="font-size:34px;line-height:1.1;font-weight:800;letter-spacing:-0.02em;color:#0e1411;padding-bottom:12px;">
    Pocket Athlete<br><span class="pa-gold" style="color:#8a6510;">is live.</span>
  </td></tr>
  <tr><td class="pa-body" style="font-size:16px;line-height:1.55;color:#495751;padding-bottom:20px;">
    You put your name down before there was anything to see. It's open now \u2014 and you're
    getting this before anyone else.
  </td></tr>
  ${ctaButton(cta, "Open Pocket Athlete \u2192")}
  <tr><td class="pa-muted" align="center" style="font-size:13px;line-height:1.5;color:#5d6860;padding-bottom:26px;">
    Free to start. No card. About two minutes to your first four-week block.
  </td></tr>
  <tr><td class="pa-h pa-rule" style="border-top:1px solid #e4e8e3;padding-top:26px;font-size:23px;line-height:1.22;font-weight:800;letter-spacing:-0.01em;color:#0e1411;padding-bottom:10px;">
    Most plans know your sport.<br><span class="pa-gold" style="color:#8a6510;">This one knows your position.</span>
  </td></tr>
  <tr><td class="pa-body" style="font-size:15px;line-height:1.6;color:#495751;padding-bottom:18px;">
    A prop and a winger need different bodies, so they get different sessions.
  </td></tr>
  ${positionStrip()}
  ${statRow()}
  <tr><td class="pa-muted" style="font-size:12px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#5d6860;padding-bottom:16px;">
    What's waiting for you
  </td></tr>
  ${row("\u{1F3A5}", "Film a rep, watch it get read", "Depth, tempo, bar path, the knee caving in on rep 8 \u2014 with the drills to fix what it finds. The analysis runs on your own phone.")}
  ${row("\u{1FA7A}", "A plan that reacts", "Slept badly? Three taps and today eases off by itself. It watches your training load and tells you to back off before the niggle, not after.")}
  ${row("\u{1F37D}\uFE0F", "Food that adds up", "Calorie and macro targets, meal plans built round your training, and a shopping list with prices on it.")}
  ${row("\u{1F3C6}", "Something to chase", "136 challenges, 75 badges and a rank ladder from Iron to Legend. It pays you for rest days too, not just for grinding.")}
  <tr><td style="padding-top:8px;"></td></tr>
  ${ctaButton(cta, "Build my first plan \u2192")}
  <tr><td class="pa-muted pa-rule" style="border-top:1px solid #e4e8e3;padding-top:22px;font-size:12px;line-height:1.6;color:#5d6860;">
    You're getting this because you joined the Pocket Athlete waitlist.<br>
    <a href="${escapeAttr(unsubscribeUrl)}" class="pa-body" style="color:#495751;text-decoration:underline;">Unsubscribe</a> \u2014 one click, no questions.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, html, text };
}
__name(launchEmail, "launchEmail");

function ctaButton(href, label) {
  return `<tr><td style="padding-bottom:12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" bgcolor="#e3b53f" style="background:#e3b53f;border-radius:999px;">
        <a href="${escapeAttr(href)}" style="display:block;padding:17px 20px;font-size:18px;font-weight:800;color:#0b0f0d;text-decoration:none;letter-spacing:-0.01em;">${escapeHtml(label)}</a>
      </td></tr>
    </table>
  </td></tr>`;
}
__name(ctaButton, "ctaButton");

function positionStrip() {
  const chip = __name((s) => `<span class="pa-chip" style="display:inline-block;background-color:#fbf4e0;border:1px solid #ecdfb6;color:#7d5c0c;font-size:12px;font-weight:700;padding:6px 11px;border-radius:999px;margin:0 5px 7px 0;white-space:nowrap;">${escapeHtml(s)}</span>`, "chip");
  const names = ["Prop", "Winger", "Goalkeeper", "Point guard", "Scrum-half", "Marathon", "+27 more"];
  return `<tr><td style="padding-bottom:20px;">${names.map(chip).join("")}</td></tr>`;
}
__name(positionStrip, "positionStrip");

function statRow() {
  const stats = [
    ["33", "positions"],
    ["6", "sports"],
    ["136", "challenges"],
    ["75", "badges"]
  ];
  const cells = stats.map(
    ([n, label]) => `<td align="center" style="padding:0 4px;">
        <div class="pa-h" style="font-size:22px;font-weight:800;color:#0e1411;">${n}</div>
        <div class="pa-muted" style="font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#5d6860;">${label}</div>
      </td>`
  ).join("");
  return `<tr><td style="padding-bottom:26px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      class="pa-tile" bgcolor="#f5f7f4" style="background-color:#f5f7f4;border-radius:14px;padding:14px 6px;">
      <tr>${cells}</tr>
    </table>
  </td></tr>`;
}
__name(statRow, "statRow");

function row(icon, title, body) {
  return `<tr><td style="padding-bottom:18px;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      <td width="34" valign="top" style="font-size:20px;line-height:1.3;">${icon}</td>
      <td valign="top">
        <div class="pa-h" style="font-size:15px;font-weight:700;color:#0e1411;padding-bottom:3px;">${escapeHtml(title)}</div>
        <div class="pa-body" style="font-size:14px;line-height:1.55;color:#495751;">${escapeHtml(body)}</div>
      </td>
    </tr></table>
  </td></tr>`;
}
__name(row, "row");

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(escapeHtml, "escapeHtml");

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
__name(escapeAttr, "escapeAttr");

// --- Standard Helper Functions ---
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE, PATCH"
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
});

async function authUser(req, env) {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: u.email } : null;
  } catch {
    return null;
  }
}
__name(authUser, "authUser");

async function supa(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...init.headers || {},
      apikey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    }
  });
}
__name(supa, "supa");

async function coachChat(req, env) {
  const u = await authUser(req, env);
  if (!u) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const question = String(body.question || "").trim();
  return json({ answer: "Coach response to: " + question });
}
__name(coachChat, "coachChat");

async function generateProgram(req, env) {
  const u = await authUser(req, env);
  if (!u) return json({ error: "unauthorized" }, 401);
  return json({ plan: { goal: "fitness", weeks: [] } });
}
__name(generateProgram, "generateProgram");

async function estimateFood(req, env) {
  const u = await authUser(req, env);
  if (!u) return json({ error: "unauthorized" }, 401);
  return json({ items: [] });
}
__name(estimateFood, "estimateFood");

async function generateChallenges(req, env) {
  const u = await authUser(req, env);
  if (!u) return json({ error: "unauthorized" }, 401);
  return json({ challenges: [] });
}
__name(generateChallenges, "generateChallenges");

async function injuryPlan(req, env) {
  const u = await authUser(req, env);
  if (!u) return json({ error: "unauthorized" }, 401);
  return json({ plan: { stages: [], redFlags: [], summary: "injury plan" } });
}
__name(injuryPlan, "injuryPlan");

async function generateContent(req, env) {
  const u = await authUser(req, env);
  if (!u) return json({ error: "unauthorized" }, 401);
  return json({ options: [] });
}
__name(generateContent, "generateContent");

async function draftExercise(req, env) {
  const u = await authUser(req, env);
  if (!u) return json({ error: "unauthorized" }, 401);
  return json({ draft: {} });
}
__name(draftExercise, "draftExercise");

async function announceLaunch(req, env) {
  const u = await authUser(req, env);
  if (!u) return json({ error: "unauthorized" }, 401);
  return json({ sent: 0, failed: 0 });
}
__name(announceLaunch, "announceLaunch");

async function stripeWebhook(req, env) {
  return json({ received: true });
}
__name(stripeWebhook, "stripeWebhook");

// --- Combined Cloudflare Worker Router ---
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // --- 1. Clipper Platform API Routes (/v1/*) ---
    if (path === "/v1/upload/presign" && request.method === "POST") {
      const auth = await authUser(request, env);
      if (!auth) return json({ error: "unauthorized" }, 401);
      const { filename } = await request.json().catch(() => ({}));
      const key = `uploads/${auth.id}/${crypto.randomUUID()}-${filename || 'source.mp4'}`;
      return json({
        uploadUrl: `${env.SUPABASE_URL}/storage/v1/object/uploads/${key}`,
        key,
        method: "PUT"
      });
    }

    if (path === "/v1/jobs/process" && request.method === "POST") {
      const auth = await authUser(request, env);
      if (!auth) return json({ error: "unauthorized" }, 401);
      const { projectId } = await request.json().catch(() => ({}));
      return json({
        status: "queued",
        jobId: crypto.randomUUID(),
        projectId,
        message: "Container dispatch initiated"
      });
    }

    if (path === "/v1/projects" && request.method === "GET") {
      const auth = await authUser(request, env);
      if (!auth) return json({ error: "unauthorized" }, 401);
      const res = await supa(env, `projects?select=*&order=created_at.desc`);
      const data = res.ok ? await res.json() : [];
      return json({ projects: data });
    }

    if (path === "/v1/clips" && request.method === "GET") {
      const auth = await authUser(request, env);
      if (!auth) return json({ error: "unauthorized" }, 401);
      const res = await supa(env, `clips?select=*&order=created_at.desc`);
      const data = res.ok ? await res.json() : [];
      return json({ clips: data });
    }

    if (path === "/v1/renders" && request.method === "POST") {
      const auth = await authUser(request, env);
      if (!auth) return json({ error: "unauthorized" }, 401);
      const { clipId, preset } = await request.json().catch(() => ({}));
      return json({
        status: "queued",
        renderId: crypto.randomUUID(),
        clipId,
        preset: preset || "9:16-vertical"
      });
    }

    // --- 2. App & PocketAthlete Handlers ---
    if (path === "/coach-chat" && request.method === "POST") return coachChat(request, env);
    if (path === "/generate-program" && request.method === "POST") return generateProgram(request, env);
    if (path === "/estimate-food" && request.method === "POST") return estimateFood(request, env);
    if (path === "/generate-challenges" && request.method === "POST") return generateChallenges(request, env);
    if (path === "/injury-plan" && request.method === "POST") return injuryPlan(request, env);
    if (path === "/generate-content" && request.method === "POST") return generateContent(request, env);
    if (path === "/draft-exercise" && request.method === "POST") return draftExercise(request, env);
    if (path === "/announce-launch" && request.method === "POST") return announceLaunch(request, env);
    if (path === "/stripe-webhook" && request.method === "POST") return stripeWebhook(request, env);

    if (path === "/health") {
      return json({ status: "ok", version: "2026-09-06.1", service: "PocketAthlete + Clipper Worker" });
    }

    if (path === "/calendar") {
      return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PocketAthlete//EN\r\nEND:VCALENDAR\r\n", {
        headers: { "Content-Type": "text/calendar" }
      });
    }

    return json({ error: "route not found", path }, 404);
  }
};
