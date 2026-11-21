import { internalSecret, type Env } from "./env";
import { requireCaller, requireEditor, requireInternal, type Caller } from "./auth";
import { dbCount, dbInsert, dbJson, dbOne, dbPatch } from "./db";
import { ApiError, body, CORS, errorResponse, json, requireUuid } from "./http";
import { serveMedia, signedUrl, streamObject } from "./media";
import { internalR2, uploadAbort, uploadComplete, uploadCreate, uploadPart } from "./upload";
import { checkout, portal, webhook } from "./billing";
import { internalComplete, internalDb, internalJob, internalTranscribe } from "./internal";
import { clipWords, dispatchProject, dispatchRender, minutesUsed, runnerMode, IN_FLIGHT, type ClipEdits, type ProjectRow } from "./jobs";
import { PLANS, PRESETS } from "./plans";
import { checkBackground, listBackgrounds, uploadBackground, uploadChat } from "./backgrounds";
import * as admin from "./admin";
import { passwordChanged, recover, resend, signup } from "./accounts";
import { modelChain } from "../pocketathlete/index";

type Handler = (req: Request, env: Env, ctx: ExecutionContext, params: string[]) => Promise<Response>;
type Authed = (req: Request, env: Env, caller: Caller, params: string[], ctx: ExecutionContext) => Promise<Response>;

const authed = (fn: Authed): Handler => async (req, env, ctx, params) => fn(req, env, await requireCaller(req, env), params, ctx);
const internal = (fn: Handler): Handler => async (req, env, ctx, params) => { await requireInternal(req, env); return fn(req, env, ctx, params); };

const UUID = "([0-9a-f-]{36})";
const ROUTES: [string, RegExp, Handler][] = [
  ["GET", /^\/v1\/health$/, async (_r, env) => json({
    ok: true, service: "clipper",
    ai: modelChain(env).map((r) => `${r.provider}/${r.model}`),
    configured: { supabase: !!env.SUPABASE_SERVICE_ROLE_KEY, internal_secret: !!internalSecret(env), r2: !!env.R2_BUCKET, runner: runnerMode(env) },
  })],
  ["GET", /^\/v1\/media$/, async (r, env) => serveMedia(r, env)],
  ["GET", /^\/v1\/plans$/, async () => json({ plans: Object.values(PLANS), presets: PRESETS })],

  // Uploads (§11.4)
  ["POST", /^\/v1\/upload\/(?:presign|create)$/, authed(async (r, env, c) => { requireEditor(c); return uploadCreate(r, env, c); })],
  ["PUT", /^\/v1\/upload\/part$/, authed(async (r, env, c) => uploadPart(r, env, c))],
  ["POST", /^\/v1\/upload\/complete$/, authed(async (r, env, c) => uploadComplete(r, env, c))],
  ["POST", /^\/v1\/upload\/abort$/, authed(async (r, env, c) => uploadAbort(r, env, c))],

  // Projects
  ["POST", /^\/v1\/projects$/, authed(createProject)],
  ["GET", /^\/v1\/projects$/, authed(listProjects)],
  ["GET", new RegExp(`^/v1/projects/${UUID}$`), authed(getProject)],
  ["DELETE", new RegExp(`^/v1/projects/${UUID}$`), authed(deleteProject)],
  ["POST", new RegExp(`^/v1/projects/${UUID}/retry$`), authed(retryProject)],
  ["GET", new RegExp(`^/v1/projects/${UUID}/transcript$`), authed(getTranscript)],
  ["PATCH", new RegExp(`^/v1/projects/${UUID}/transcript$`), authed(patchTranscript)],
  ["GET", new RegExp(`^/v1/projects/${UUID}/clips$`), authed(listCandidates)],

  // Clips
  ["POST", /^\/v1\/clips$/, authed(createClip)],
  ["GET", new RegExp(`^/v1/clips/${UUID}$`), authed(getClip)],
  ["PATCH", new RegExp(`^/v1/clips/${UUID}$`), authed(patchClip)],
  ["POST", new RegExp(`^/v1/clips/${UUID}/feedback$`), authed(clipFeedback)],
  ["POST", new RegExp(`^/v1/clips/${UUID}/render$`), authed(renderClip)],
  ["GET", new RegExp(`^/v1/renders/${UUID}$`), authed(getRender)],

  // Split-screen background footage
  ["GET", /^\/v1\/backgrounds$/, authed(async (_r, env, c) => listBackgrounds(env, c))],
  ["PUT", /^\/v1\/backgrounds$/, authed(async (r, env, c) => uploadBackground(r, env, c))],

  // Live-chat logs for chat analysis
  ["PUT", /^\/v1\/chat$/, authed(async (r, env, c) => uploadChat(r, env, c))],

  // Accounts — Clipper-branded confirmation / reset emails (accounts.ts)
  ["POST", /^\/v1\/auth\/signup$/, async (r, env) => signup(r, env)],
  ["POST", /^\/v1\/auth\/recover$/, async (r, env) => recover(r, env)],
  ["POST", /^\/v1\/auth\/resend$/, async (r, env) => resend(r, env)],
  ["POST", /^\/v1\/auth\/password-changed$/, authed(async (_r, env, c) => passwordChanged(env, c))],

  // Admin panel (admin.ts) — every route checks the admin role on the Worker
  ["GET", /^\/v1\/admin\/overview$/, authed(async (_r, env, c) => { admin.requireAdmin(c); return admin.overview(env); })],
  ["GET", /^\/v1\/admin\/users$/, authed(async (r, env, c) => { admin.requireAdmin(c); return admin.users(r, env); })],
  ["POST", new RegExp(`^/v1/admin/workspaces/${UUID}/plan$`), authed(async (r, env, c, p) => { admin.requireAdmin(c); return admin.setPlan(r, env, p[0]); })],
  ["GET", /^\/v1\/admin\/jobs$/, authed(async (_r, env, c) => { admin.requireAdmin(c); return admin.jobs(env); })],
  ["POST", new RegExp(`^/v1/admin/projects/${UUID}/retry$`), authed(async (_r, env, c, p, ctx) => { admin.requireAdmin(c); return admin.retry(env, ctx, p[0]); })],
  ["GET", /^\/v1\/admin\/payments$/, authed(async (_r, env, c) => { admin.requireAdmin(c); return admin.payments(env); })],
  ["POST", /^\/v1\/admin\/payments\/setup$/, authed(async (_r, env, c) => { admin.requireAdmin(c); return admin.paymentsSetup(env); })],
  ["GET", /^\/v1\/admin\/settings$/, authed(async (r, env, c) => { admin.requireAdmin(c); return admin.settings(r, env); })],
  ["PATCH", /^\/v1\/admin\/settings$/, authed(async (r, env, c) => { admin.requireAdmin(c); return admin.settings(r, env); })],

  // Brand kits, usage, billing
  ["GET", /^\/v1\/brandkits$/, authed(async (_r, env, c) => json({ brandkits: await dbJson(env, `brandkits?tenant_id=eq.${c.tenantId}&select=*&order=created_at.desc`) }))],
  ["POST", /^\/v1\/brandkits$/, authed(createBrandkit)],
  ["GET", /^\/v1\/usage$/, authed(getUsage)],
  ["GET", /^\/v1\/me$/, authed(async (_r, _env, c) => json({ user_id: c.userId, email: c.email, tenant_id: c.tenantId, role: c.role, plan: c.plan, is_admin: c.admin, guest: c.guest }))],
  ["POST", /^\/v1\/billing\/checkout$/, authed(async (r, env, c) => checkout(r, env, c))],
  ["POST", /^\/v1\/billing\/portal$/, authed(async (_r, env, c) => portal(env, c))],
  ["POST", /^\/v1\/webhooks\/stripe$/, async (r, env) => webhook(r, env)],

  // Job runner (GitHub Actions or Container) -> Worker
  ["POST", /^\/v1\/internal\/complete$/, internal(async (r, env) => internalComplete(r, env))],
  ["POST", /^\/v1\/internal\/db$/, internal(async (r, env) => internalDb(r, env))],
  ["POST", /^\/v1\/internal\/transcribe$/, internal(async (r, env) => internalTranscribe(r, env))],
  ["GET", /^\/v1\/internal\/jobs\/(process|render)\/([0-9a-f-]{36})$/, internal(async (_r, env, _c, p) => internalJob(env, p[0], p[1]))],
  ["GET", /^\/v1\/internal\/r2$/, internal(async (r, env) => streamObject(r, env, new URL(r.url).searchParams.get("key") ?? ""))],
  ["PUT", /^\/v1\/internal\/r2$/, internal(async (r, env) => internalR2(r, env, "object"))],
  ["DELETE", /^\/v1\/internal\/r2$/, internal(async (r, env) => internalR2(r, env, "object"))],
  ["POST", /^\/v1\/internal\/r2\/(multipart|complete)$/, internal(async (r, env, _c, p) => internalR2(r, env, p[0]))],
  ["PUT", /^\/v1\/internal\/r2\/part$/, internal(async (r, env) => internalR2(r, env, "part"))],
  ["POST", /^\/v1\/internal\/projects\/([0-9a-f-]{36})\/next$/, internal(async (_r, env, ctx, p) => {
    // A job finished: start the tenant's next queued project, if any.
    const project = await dbOne<{ tenant_id: string }>(env, `projects?id=eq.${p[0]}&select=tenant_id`);
    if (project) {
      const next = await dbJson<{ id: string }[]>(env, `projects?tenant_id=eq.${project.tenant_id}&status=eq.queued&deleted_at=is.null&select=id&order=created_at.asc&limit=3`);
      ctx.waitUntil(Promise.all(next.map((n) => dispatchProject(env, n.id).catch(() => "skipped"))));
    }
    return json({ ok: true });
  })],
];

export async function handleClipper(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const requestId = `req_${crypto.randomUUID().slice(0, 12)}`;
  const { pathname } = new URL(req.url);
  try {
    // Without the R2 binding or a job runner, say so plainly instead of a
    // TypeError 500 — PocketAthlete and the rest of /v1 keep working either way.
    const needsStorage = /^\/v1\/(upload\/|media$|internal\/r2|backgrounds$|chat$)/.test(pathname) || (req.method === "POST" && /^\/v1\/(projects|clips\/[^/]+\/render)$/.test(pathname));
    if (needsStorage && !env.R2_BUCKET) {
      throw new ApiError(503, "E_PROCESSING_UNAVAILABLE",
        "Video storage isn't switched on for this Worker yet: add an R2 bucket binding named R2_BUCKET (bucket clipper-prod).");
    }
    if (req.method === "POST" && /^\/v1\/(projects|clips\/[^/]+\/render)$/.test(pathname) && !runnerMode(env)) {
      throw new ApiError(503, "E_PROCESSING_UNAVAILABLE",
        "Video processing isn't switched on yet: the Worker's GITHUB_TOKEN must be set and allowed to start workflows on the Clipper repo.");
    }
    let pathMatched = false;
    for (const [method, re, handler] of ROUTES) {
      const m = re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (method !== req.method) continue;
      return await handler(req, env, ctx, m.slice(1));
    }
    throw pathMatched ? new ApiError(405, "E_METHOD", "method not allowed") : new ApiError(404, "E_NOT_FOUND", "no such route");
  } catch (e) {
    return errorResponse(e, requestId);
  }
}

// --- Projects ----------------------------------------------------------------

async function ownProject(env: Env, caller: Caller, id: string): Promise<ProjectRow & Record<string, any>> {
  const p = await dbOne<ProjectRow & Record<string, any>>(env,
    `projects?id=eq.${requireUuid(id, "project")}&tenant_id=eq.${caller.tenantId}&deleted_at=is.null&select=*`);
  if (!p) throw new ApiError(404, "E_NOT_FOUND", "project not found");
  return p;
}

/** Cheap SSRF pre-check (§14.5). The Container re-checks after DNS resolution. */
function checkSourceUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new ApiError(400, "E_VALIDATION", "that is not a valid URL"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new ApiError(400, "E_VALIDATION", "only http(s) links can be imported");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(10|127|0)\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || h === "::1" || /^f[cd]/.test(h) || /^fe80/.test(h)) {
    throw new ApiError(400, "E_VALIDATION", "that address is not reachable from the internet");
  }
  return u.toString();
}

async function createProject(req: Request, env: Env, caller: Caller, _p: string[], ctx: ExecutionContext): Promise<Response> {
  requireEditor(caller);
  const b = await body<{
    title?: string;
    source?: { kind?: string; r2_key?: string; url?: string };
    options?: { language?: string; clip_durations?: number[]; max_clips?: number; template_id?: string; chat_key?: string };
  }>(req);
  const idem = req.headers.get("Idempotency-Key")?.slice(0, 120) || null;
  if (idem) {
    const existing = await dbOne(env, `projects?tenant_id=eq.${caller.tenantId}&idempotency_key=eq.${encodeURIComponent(idem)}&select=*`);
    if (existing) return json(existing, 200);
  }

  let source_kind: "upload" | "url";
  let source_uri: string;
  if (b.source?.kind === "upload") {
    const key = String(b.source.r2_key ?? "");
    if (!key.startsWith(`${caller.tenantId}/uploads/`)) throw new ApiError(403, "E_FORBIDDEN", "not your upload");
    if (!(await env.R2_BUCKET.head(key))) throw new ApiError(400, "E_INGEST_CORRUPT", "the upload did not finish — upload the file again");
    source_kind = "upload"; source_uri = key;
  } else if (b.source?.kind === "url") {
    source_kind = "url"; source_uri = checkSourceUrl(String(b.source.url ?? ""));
  } else {
    throw new ApiError(400, "E_VALIDATION", "source.kind must be 'upload' or 'url'");
  }

  const used = await minutesUsed(env, caller.tenantId);
  if (used >= caller.plan.monthlyMinutes) {
    throw new ApiError(403, "E_TENANT_QUOTA", `You've used all ${caller.plan.monthlyMinutes} source minutes on the ${caller.plan.label} plan this month. Upgrade to keep going.`);
  }

  // Optional live-chat log (uploaded via PUT /v1/chat) — powers chat analysis.
  let chat_key: string | null = null;
  if (b.options?.chat_key) {
    chat_key = String(b.options.chat_key);
    if (!chat_key.startsWith(`${caller.tenantId}/chat/`) || chat_key.includes("..")) throw new ApiError(403, "E_FORBIDDEN", "not your chat log");
    if (!(await env.R2_BUCKET.head(chat_key))) throw new ApiError(400, "E_VALIDATION", "the chat log upload did not finish — add it again");
  }

  const durations = (b.options?.clip_durations ?? []).map(Number).filter((n) => [15, 30, 60, 90].includes(n));
  const options = {
    language: typeof b.options?.language === "string" ? b.options.language.slice(0, 8) : "auto",
    clip_durations: durations.length ? durations : "auto",
    max_clips: Math.min(Math.max(Number(b.options?.max_clips) || 0, 0), 40) || null,
    template_id: b.options?.template_id ?? null,
    ...(chat_key ? { chat_key } : {}),
  };
  const title = String(b.title ?? "").trim().slice(0, 200) ||
    (source_kind === "url" ? new URL(source_uri).hostname : "Untitled upload");

  const project = await dbInsert<ProjectRow>(env, "projects", {
    tenant_id: caller.tenantId, title, source_kind, source_uri, status: "queued", options, idempotency_key: idem,
  });
  ctx.waitUntil(dispatchProject(env, project.id).catch((e) => console.error(`dispatch ${project.id}: ${String(e)}`)));
  return json({ ...project, credit_cost: null }, 201);
}

async function decorate(env: Env, p: Record<string, any>) {
  return {
    ...p,
    poster_url: await signedUrl(env, p.poster_key),
    review_url: await signedUrl(env, p.review_proxy_key),
  };
}

async function listProjects(req: Request, env: Env, caller: Caller): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
  const before = url.searchParams.get("before");
  const status = url.searchParams.get("status");
  let q = `projects?tenant_id=eq.${caller.tenantId}&deleted_at=is.null&select=id,title,source_kind,status,duration_ms,error_code,error_detail,poster_key,candidate_count,top_score,created_at,updated_at&order=created_at.desc&limit=${limit}`;
  if (before) q += `&created_at=lt.${encodeURIComponent(before)}`;
  if (status === "ready") q += "&status=eq.ready";
  else if (status === "processing") q += `&status=in.(queued,${IN_FLIGHT.join(",")})`;
  const rows = await dbJson<Record<string, any>[]>(env, q);
  return json({ projects: await Promise.all(rows.map((r) => decorate(env, r))) });
}

async function getProject(_r: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  return json(await decorate(env, await ownProject(env, caller, p[0])));
}

async function deleteProject(_r: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  requireEditor(caller);
  await ownProject(env, caller, p[0]);
  await dbPatch(env, `projects?id=eq.${p[0]}&tenant_id=eq.${caller.tenantId}`, { deleted_at: new Date().toISOString() });
  return json({ deleted: true });
}

async function retryProject(_r: Request, env: Env, caller: Caller, p: string[], ctx: ExecutionContext): Promise<Response> {
  requireEditor(caller);
  const project = await ownProject(env, caller, p[0]);
  if (project.status !== "failed") throw new ApiError(409, "E_CONFLICT", "only failed projects can be retried");
  await dbPatch(env, `projects?id=eq.${project.id}`, { status: "queued", error_code: null, error_detail: null, dispatched_at: null });
  ctx.waitUntil(dispatchProject(env, project.id).catch((e) => console.error(String(e))));
  return json({ id: project.id, status: "queued" });
}

async function getTranscript(_r: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  await ownProject(env, caller, p[0]);
  const t = await dbOne(env, `transcripts?project_id=eq.${p[0]}&select=words,segments,speakers,edited_at`);
  if (!t) throw new ApiError(404, "E_NOT_FOUND", "no transcript yet");
  return json(t);
}

async function patchTranscript(req: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  requireEditor(caller);
  await ownProject(env, caller, p[0]);
  const { edits } = await body<{ edits?: { word_index: number; text: string }[] }>(req);
  const t = await dbOne<{ id: string; words: { w: string }[] }>(env, `transcripts?project_id=eq.${p[0]}&select=id,words`);
  if (!t) throw new ApiError(404, "E_NOT_FOUND", "no transcript yet");
  for (const e of edits ?? []) {
    if (Number.isInteger(e.word_index) && t.words[e.word_index]) t.words[e.word_index].w = String(e.text).slice(0, 60);
  }
  await dbPatch(env, `transcripts?id=eq.${t.id}`, { words: t.words, edited_by: caller.userId || null, edited_at: new Date().toISOString() });
  return json({ updated: (edits ?? []).length });
}

async function listCandidates(req: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  await ownProject(env, caller, p[0]);
  const url = new URL(req.url);
  const min = Number(url.searchParams.get("min_score")) || 0;
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 100);
  const rows = await dbJson<Record<string, any>[]>(env,
    `candidates?project_id=eq.${p[0]}&score=gte.${min}&select=*&order=score.desc&limit=${limit}`);
  const clips = await dbJson<{ id: string; candidate_id: string; status: string }[]>(env,
    `clips?tenant_id=eq.${caller.tenantId}&candidate_id=in.(${rows.map((r) => r.id).join(",") || "00000000-0000-0000-0000-000000000000"})&select=id,candidate_id,status`);
  const clipBy = new Map(clips.map((c) => [c.candidate_id, c]));
  return json({
    candidates: await Promise.all(rows.map(async (r) => ({
      ...r,
      proxy_url: await signedUrl(env, r.proxy_uri),
      thumb_url: await signedUrl(env, r.features?.thumb_key),
      clip_id: clipBy.get(r.id)?.id ?? null,
      clip_status: clipBy.get(r.id)?.status ?? null,
    }))),
  });
}

// --- Clips -------------------------------------------------------------------

async function ownClip(env: Env, caller: Caller, id: string) {
  const c = await dbOne<{ id: string; tenant_id: string; candidate_id: string; title: string | null; t_in_ms: number; t_out_ms: number; edits: ClipEdits; status: string; updated_at: string }>(
    env, `clips?id=eq.${requireUuid(id, "clip")}&tenant_id=eq.${caller.tenantId}&select=*`);
  if (!c) throw new ApiError(404, "E_NOT_FOUND", "clip not found");
  return c;
}

async function createClip(req: Request, env: Env, caller: Caller): Promise<Response> {
  requireEditor(caller);
  const { candidate_id } = await body<{ candidate_id?: string }>(req);
  const cand = await dbOne<{ id: string; project_id: string; t_in_ms: number; t_out_ms: number; features: any; rationale: string | null }>(
    env, `candidates?id=eq.${requireUuid(candidate_id, "candidate")}&select=id,project_id,t_in_ms,t_out_ms,features,rationale`);
  if (!cand) throw new ApiError(404, "E_NOT_FOUND", "candidate not found");
  await ownProject(env, caller, cand.project_id);
  const existing = await dbOne<{ id: string }>(env, `clips?candidate_id=eq.${cand.id}&tenant_id=eq.${caller.tenantId}&select=id`);
  if (existing) return json({ id: existing.id, existing: true });
  const clip = await dbInsert<{ id: string }>(env, "clips", {
    candidate_id: cand.id, tenant_id: caller.tenantId,
    title: cand.features?.title ?? cand.rationale ?? null,
    t_in_ms: cand.t_in_ms, t_out_ms: cand.t_out_ms,
    edits: {
      captions: { enabled: true, style: "karaoke_yellow", edits: [] }, layout: { mode: "auto", aspect: "9:16" },
      // The engine's context headline ("KAI CENAT CRASHES OUT AT …"), editable in the editor.
      ...(cand.features?.context_title ? { title_overlay: String(cand.features.context_title).slice(0, 80) } : {}),
    },
  });
  return json({ id: clip.id }, 201);
}

async function getClip(_r: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  const clip = await ownClip(env, caller, p[0]);
  const cand = await dbOne<Record<string, any>>(env, `candidates?id=eq.${clip.candidate_id}&select=*`);
  const project = cand ? await ownProject(env, caller, cand.project_id) : null;
  const transcript = project ? await dbOne<{ words: any[] }>(env, `transcripts?project_id=eq.${project.id}&select=words`) : null;
  // A window around the clip so the editor can extend the trim (FR-7.4 max 180s).
  const pad = 60_000;
  const words = clipWords(transcript?.words ?? [], Math.max(0, clip.t_in_ms - pad), clip.t_out_ms + pad, clip.edits?.captions);
  const renders = await dbJson<Record<string, any>[]>(env,
    `render_jobs?clip_id=eq.${clip.id}&select=id,preset,status,uri,error_code,queued_at,finished_at&order=queued_at.desc&limit=5`);
  return json({
    clip,
    candidate: cand ? { ...cand, proxy_url: await signedUrl(env, cand.proxy_uri), edit_url: await signedUrl(env, cand.features?.edit_key) } : null,
    project: project ? await decorate(env, project) : null,
    words,
    renders: await Promise.all(renders.map(async (r) => ({ ...r, download_url: r.status === "completed" ? await signedUrl(env, r.uri, 24 * 3600, `${(clip.title || "clip").slice(0, 40)}.mp4`) : null }))),
    plan: caller.plan,
  });
}

async function patchClip(req: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  requireEditor(caller);
  const clip = await ownClip(env, caller, p[0]);
  const b = await body<{ t_in_ms?: number; t_out_ms?: number; title?: string; captions?: ClipEdits["captions"]; layout?: ClipEdits["layout"]; background?: unknown; template_id?: string; title_overlay?: string; status?: string }>(req);
  const t_in = b.t_in_ms != null ? Math.round(Number(b.t_in_ms)) : clip.t_in_ms;
  const t_out = b.t_out_ms != null ? Math.round(Number(b.t_out_ms)) : clip.t_out_ms;
  const dur = t_out - t_in;
  if (!(t_in >= 0) || !(dur >= 8000) || dur > 180_000) throw new ApiError(422, "E_VALIDATION", "clips must be between 8 and 180 seconds (FR-7.4)");
  const edits: ClipEdits = { ...(clip.edits ?? {}) };
  if (b.captions) edits.captions = { ...(edits.captions ?? {}), ...b.captions, edits: (b.captions.edits ?? edits.captions?.edits ?? []).slice(0, 2000) };
  if (b.layout) edits.layout = { ...(edits.layout ?? {}), ...b.layout, keyframes: (b.layout.keyframes ?? edits.layout?.keyframes ?? []).slice(0, 60) };
  const bg = await checkBackground(env, caller, b.background);
  if (bg) edits.background = bg;
  if (b.template_id !== undefined) edits.template_id = b.template_id;
  if (b.title_overlay !== undefined) edits.title_overlay = String(b.title_overlay).slice(0, 80);
  const patch: Record<string, unknown> = { t_in_ms: t_in, t_out_ms: t_out, edits, updated_at: new Date().toISOString() };
  if (b.title !== undefined) patch.title = String(b.title).slice(0, 200);
  if (b.status && ["draft", "approved"].includes(b.status)) patch.status = b.status;
  const [updated] = await dbPatch(env, `clips?id=eq.${clip.id}&tenant_id=eq.${caller.tenantId}`, patch);
  if (Math.abs(dur - (clip.t_out_ms - clip.t_in_ms)) > 20_000) {
    if (!caller.guest) await dbInsert(env, "feedback", { clip_id: clip.id, user_id: caller.userId, signal: "edited_heavy", payload: { from: [clip.t_in_ms, clip.t_out_ms], to: [t_in, t_out] } }).catch(() => {});
  }
  return json({ clip: updated, render_invalidated: true });
}

async function clipFeedback(req: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  const clip = await ownClip(env, caller, p[0]);
  const { signal, payload } = await body<{ signal?: string; payload?: unknown }>(req);
  if (!["not_good", "exported", "published", "edited_heavy", "good"].includes(String(signal))) throw new ApiError(400, "E_VALIDATION", "unknown signal");
  // Feedback rows need a real user (they train the scorer per person); guests are skipped.
  if (caller.guest) return json({ recorded: false, reason: "guest" });
  await dbInsert(env, "feedback", { clip_id: clip.id, user_id: caller.userId, signal, payload: payload ?? null });
  return json({ recorded: true });
}

async function renderClip(req: Request, env: Env, caller: Caller, p: string[], ctx: ExecutionContext): Promise<Response> {
  requireEditor(caller);
  const clip = await ownClip(env, caller, p[0]);
  const { preset = "tiktok" } = await body<{ preset?: string }>(req).catch(() => ({ preset: "tiktok" }));
  if (!PRESETS[preset]) throw new ApiError(400, "E_VALIDATION", `preset must be one of ${Object.keys(PRESETS).join(", ")}`);
  const running = await dbCount(env, `render_jobs?clip_id=in.(${clip.id})&status=in.(queued,running)&select=id`);
  if (running > 0) throw new ApiError(409, "E_CONFLICT", "this clip is already rendering");
  const job = await dbInsert<{ id: string }>(env, "render_jobs", { clip_id: clip.id, tenant_id: caller.tenantId, preset, kind: "final", status: "queued" });
  ctx.waitUntil(dispatchRender(env, job.id).catch((e) => console.error(`render ${job.id}: ${String(e)}`)));
  if (!caller.guest) await dbInsert(env, "feedback", { clip_id: clip.id, user_id: caller.userId, signal: "exported", payload: { preset } }).catch(() => {});
  return json({ id: job.id, status: "queued" }, 202);
}

async function getRender(_r: Request, env: Env, caller: Caller, p: string[]): Promise<Response> {
  const job = await dbOne<Record<string, any>>(env, `render_jobs?id=eq.${requireUuid(p[0], "render")}&tenant_id=eq.${caller.tenantId}&select=id,clip_id,preset,status,uri,error_code,error_detail,queued_at,finished_at`);
  if (!job) throw new ApiError(404, "E_NOT_FOUND", "render not found");
  return json({ ...job, download_url: job.status === "completed" ? await signedUrl(env, job.uri, 24 * 3600, "clip.mp4") : null });
}

async function createBrandkit(req: Request, env: Env, caller: Caller): Promise<Response> {
  requireEditor(caller);
  const b = await body<{ name?: string; fonts?: unknown; colors?: unknown; caption_style?: unknown }>(req);
  if (!b.name?.trim()) throw new ApiError(400, "E_VALIDATION", "name required");
  const kit = await dbInsert(env, "brandkits", { tenant_id: caller.tenantId, name: b.name.trim().slice(0, 80), fonts: b.fonts ?? null, colors: b.colors ?? null, caption_style: b.caption_style ?? null });
  return json(kit, 201);
}

async function getUsage(_r: Request, env: Env, caller: Caller): Promise<Response> {
  const used = await minutesUsed(env, caller.tenantId);
  const sub = await dbOne<Record<string, any>>(env, `subscriptions?tenant_id=eq.${caller.tenantId}&select=status,price_id,current_period_end,cancel_at_period_end&order=updated_at.desc`);
  const [projects, renders] = await Promise.all([
    dbCount(env, `projects?tenant_id=eq.${caller.tenantId}&deleted_at=is.null&select=id`),
    dbCount(env, `render_jobs?tenant_id=eq.${caller.tenantId}&status=eq.completed&select=id`),
  ]);
  return json({ plan: caller.plan, minutes_used: Math.round(used * 10) / 10, minutes_included: caller.plan.monthlyMinutes, projects, renders, subscription: sub });
}

