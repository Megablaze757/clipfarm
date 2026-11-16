// =============================================================================
// PASTE THIS FILE INTO THE CLOUDFLARE DASHBOARD. Not cloudflare/src/index.ts.
//
// Generated — do not edit. Rebuild with:  node scripts/build-worker-bundle.mjs
//
// src/index.ts is TypeScript, and pasting it gives
// "Uncaught SyntaxError: Unexpected token 'export'" because Workers run
// JavaScript. This is the same code with the types stripped and the imports
// inlined. Select all of it, paste over everything in the editor, and deploy.
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
  const chip = /* @__PURE__ */ __name((s) => `<span class="pa-chip" style="display:inline-block;background-color:#fbf4e0;border:1px solid #ecdfb6;color:#7d5c0c;font-size:12px;font-weight:700;padding:6px 11px;border-radius:999px;margin:0 5px 7px 0;white-space:nowrap;">${escapeHtml(s)}</span>`, "chip");
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

// src/email-layout.ts
function escapeHtml2(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(escapeHtml2, "escapeHtml");
function escapeAttr2(s) {
  return escapeHtml2(s).replace(/"/g, "&quot;");
}
__name(escapeAttr2, "escapeAttr");
function ctaButton2(href, label) {
  return `<tr><td style="padding-bottom:12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" bgcolor="#e3b53f" style="background:#e3b53f;border-radius:999px;">
        <a href="${escapeAttr2(href)}" style="display:block;padding:17px 20px;font-size:18px;font-weight:800;color:#0b0f0d;text-decoration:none;letter-spacing:-0.01em;">${escapeHtml2(label)}</a>
      </td></tr>
    </table>
  </td></tr>`;
}
__name(ctaButton2, "ctaButton");
function emailHead(subject, preheader) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml2(subject)}</title>
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
${preheaderBlock(preheader)}
<table role="presentation" class="pa-bg" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef1ec" style="background-color:#eef1ec;padding:20px 12px;">
<tr><td align="center">
<table role="presentation" class="pa-card" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:560px;background-color:#ffffff;border-radius:20px;padding:30px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">`;
}
__name(emailHead, "emailHead");
function preheaderBlock(text) {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml2(text)}</div>`;
}
__name(preheaderBlock, "preheaderBlock");
function emailFoot() {
  return `</table></td></tr></table></body></html>`;
}
__name(emailFoot, "emailFoot");
function emailBrand() {
  return `<tr><td style="padding-bottom:20px;">
    <span class="pa-h" style="font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#0e1411;">
      <span class="pa-gold" style="color:#8a6510;">&#9670;</span> PocketAthlete
    </span>
  </td></tr>`;
}
__name(emailBrand, "emailBrand");
function block(text) {
  const lines2 = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const cell = /* @__PURE__ */ __name((inner) => `<tr><td class="pa-body" style="font-size:16px;line-height:1.55;color:#495751;padding-bottom:18px;">${inner}</td></tr>`, "cell");
  if (lines2.length > 1 && lines2.every((l) => /^[-•*]\s+/.test(l))) {
    const items = lines2.map((l) => l.replace(/^[-•*]\s+/, "")).map((l) => `<tr>
        <td width="18" valign="top" class="pa-gold" style="font-size:16px;line-height:1.55;color:#8a6510;">&bull;</td>
        <td valign="top" class="pa-body" style="font-size:16px;line-height:1.55;color:#495751;padding-bottom:6px;">${escapeHtml2(l)}</td>
      </tr>`).join("");
    return cell(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${items}</table>`);
  }
  const pairs = lines2.map((l) => l.match(/^([^:]{1,28}):\s*(.{1,24})$/));
  if (lines2.length > 1 && pairs.every(Boolean)) {
    const rows = pairs.map((m) => `<tr>
        <td class="pa-body pa-rule" style="font-size:15px;line-height:1.5;color:#495751;border-top:1px solid #e4e8e3;padding:9px 0;">${escapeHtml2(m[1])}</td>
        <td align="right" class="pa-h pa-rule" style="font-size:15px;line-height:1.5;font-weight:800;color:#0e1411;border-top:1px solid #e4e8e3;padding:9px 0;">${escapeHtml2(m[2])}</td>
      </tr>`).join("");
    return cell(`<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>`);
  }
  return cell(escapeHtml2(text).replaceAll("\n", "<br>"));
}
__name(block, "block");
function renderEmail(subject, shell) {
  const eyebrow = shell.eyebrow ? `<tr><td class="pa-gold" style="font-size:12px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:#8a6510;padding-bottom:8px;">${escapeHtml2(shell.eyebrow)}</td></tr>` : "";
  const heading = `<tr><td class="pa-h" style="font-size:26px;line-height:1.18;font-weight:800;letter-spacing:-0.02em;color:#0e1411;padding-bottom:12px;">${escapeHtml2(shell.heading)}</td></tr>`;
  const paragraphs = shell.paragraphs.filter((p) => p.trim() !== "").map(block).join("");
  const cta = shell.cta ? ctaButton2(shell.cta.href, shell.cta.label) : "";
  const note = shell.note ? `<tr><td class="pa-muted" align="center" style="font-size:13px;line-height:1.5;color:#5d6860;padding-bottom:20px;">${escapeHtml2(shell.note)}</td></tr>` : "";
  const footer = shell.footerHtml ? `<tr><td class="pa-rule" style="border-top:1px solid #e4e8e3;padding-top:20px;">
        <div class="pa-h" style="font-size:14px;font-weight:800;letter-spacing:-0.01em;color:#0e1411;padding-bottom:6px;">
          <span class="pa-gold" style="color:#8a6510;">&#9670;</span> PocketAthlete
        </div>
        <div class="pa-muted" style="font-size:12px;line-height:1.5;color:#5d6860;">${shell.footerHtml}</div>
      </td></tr>` : "";
  return emailHead(subject, shell.preheader) + emailBrand() + eyebrow + heading + paragraphs + cta + note + footer + emailFoot();
}
__name(renderEmail, "renderEmail");
function renderText(shell) {
  const lines2 = [shell.heading.toUpperCase(), "", ...shell.paragraphs.filter((p) => p.trim() !== "")];
  if (shell.cta)
    lines2.push("", `${shell.cta.label.replace(/\s*→\s*$/, "")}: ${shell.cta.href}`);
  if (shell.note)
    lines2.push("", shell.note);
  if (shell.footerHtml) {
    const text = shell.footerHtml.replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g, "$2: $1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    if (text)
      lines2.push("", "\u2014", text);
  }
  return lines2.join("\n");
}
__name(renderText, "renderText");

// Clipper Platform endpoints integration
async function handleClipperRoute(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey"
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (path === "/v1/upload/presign" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    return new Response(JSON.stringify({
      upload_url: "https://ntmcnglooqwbdebhpopp.supabase.co/storage/v1/upload/resumable",
      file_key: `raw_sources/${Date.now()}_${body.filename || "source.mp4"}`,
      content_type: body.content_type || "video/mp4"
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (path === "/v1/jobs/process" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    return new Response(JSON.stringify({
      job_id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      status: "queued",
      project_id: body.project_id || "proj_default"
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (path === "/v1/projects" && request.method === "GET") {
    return new Response(JSON.stringify({
      projects: [
        { id: "demo-project-1", name: "Lex Fridman AI Podcast Clip", status: "ready", candidates_count: 3 },
        { id: "demo-project-2", name: "Tech Talk 2026 Keynote", status: "ready", candidates_count: 2 }
      ]
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (path === "/v1/clips" && request.method === "GET") {
    return new Response(JSON.stringify({
      candidates: [
        { id: "cand_1", project_id: "demo-project-1", title: "Why AI Agents Will Replace Monoliths", start_time: 12.5, end_time: 48.0, watchability_score: 96, rationale: "Interrogative Hook, Self-Contained" },
        { id: "cand_2", project_id: "demo-project-1", title: "The 3 Rules of Scaling Containers", start_time: 104.0, end_time: 142.5, watchability_score: 91, rationale: "High Energy, Actionable Insight" }
      ]
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (path === "/v1/renders" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    return new Response(JSON.stringify({
      render_id: `rnd_${Date.now()}`,
      status: "completed",
      download_url: body.video_url || "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return null;
}

// Main Worker Fetch Dispatcher
var src_default = {
  async fetch(request, env, ctx) {
    const clipperRes = await handleClipperRoute(request, env);
    if (clipperRes) return clipperRes;
    return new Response(JSON.stringify({ status: "ok", service: "PocketAthlete & Clipper Worker", timestamp: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};
export {
  src_default as default
};
