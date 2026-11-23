import type { Env } from "./env";
import { completeWithFallbacks, modelChain } from "../pocketathlete/index";
import { ApiError, body, json } from "./http";
import { db, dbOne } from "./db";
import { processPayload, type ProjectRow } from "./jobs";

/**
 * The job runner (GitHub Actions or the Container) holds NO keys. Everything
 * needing one goes through these routes: database writes, Groq transcription,
 * the AI ladder, and R2 (upload.ts). Keys stay in the Worker.
 */

// Tables the runner may write. Anything else is refused.
const RUNNER_TABLES = new Set(["projects", "transcripts", "candidates", "clips", "render_jobs", "usage_events", "artifacts"]);

/** Minimal Supabase-style write proxy for the runner: insert / upsert / update / delete. */
export async function internalDb(req: Request, env: Env): Promise<Response> {
  const b = await body<{
    table?: string; op?: string; values?: unknown;
    match?: Record<string, string | number>; onConflict?: string; ignoreDuplicates?: boolean;
  }>(req);
  const table = String(b.table ?? "");
  if (!RUNNER_TABLES.has(table)) throw new ApiError(403, "E_FORBIDDEN", `table ${table} is not writable by the runner`);
  const filters = Object.entries(b.match ?? {})
    .filter(([k]) => /^[a-z_]+$/.test(k))
    .map(([k, v]) => `${k}=eq.${encodeURIComponent(String(v))}`).join("&");
  let path = table;
  let init: RequestInit;
  switch (b.op) {
    case "insert":
      init = { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(b.values) };
      break;
    case "upsert":
      if (b.onConflict && /^[a-z_,]+$/.test(b.onConflict)) path += `?on_conflict=${b.onConflict}`;
      init = { method: "POST", headers: { Prefer: `resolution=${b.ignoreDuplicates ? "ignore" : "merge"}-duplicates,return=minimal` }, body: JSON.stringify(b.values) };
      break;
    case "update":
      if (!filters) throw new ApiError(400, "E_VALIDATION", "update needs a match");
      path += `?${filters}`;
      init = { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(b.values) };
      break;
    case "delete":
      if (!filters) throw new ApiError(400, "E_VALIDATION", "delete needs a match");
      path += `?${filters}`;
      init = { method: "DELETE", headers: { Prefer: "return=minimal" } };
      break;
    default:
      throw new ApiError(400, "E_VALIDATION", "op must be insert, upsert, update or delete");
  }
  const r = await db(env, path, init);
  if (!r.ok) return json({ error: { message: `${r.status} ${(await r.text()).slice(0, 300)}` } }, 200);
  return json({ error: null });
}

/**
 * Groq Whisper through the Worker's GROQ_SECRET (shared with PocketAthlete).
 * The runner posts one audio chunk; Groq's status and Retry-After are passed
 * straight back so the runner's own backoff keeps working.
 */
export async function internalTranscribe(req: Request, env: Env): Promise<Response> {
  const key = (env.GROQ_SECRET || "").trim();
  if (!key) return json({ error: "GROQ_SECRET is not set on the Worker" }, 503);
  const url = new URL(req.url);
  const form = new FormData();
  form.append("file", new File([await req.arrayBuffer()], "chunk.flac", { type: "audio/flac" }));
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");
  const lang = url.searchParams.get("language");
  if (lang && lang !== "auto" && /^[a-z]{2,3}$/.test(lang)) form.append("language", lang);
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
  });
  const headers: Record<string, string> = { "Content-Type": r.headers.get("Content-Type") || "application/json" };
  const retry = r.headers.get("retry-after");
  if (retry) headers["Retry-After"] = retry;
  return new Response(r.body, { status: r.status, headers });
}

/** A GitHub runner fetches its job here (the dispatch event only carries the id). */
export async function internalJob(env: Env, kind: string, id: string): Promise<Response> {
  if (kind === "process") {
    const project = await dbOne<ProjectRow>(env, `projects?id=eq.${id}&deleted_at=is.null&select=*`);
    if (!project) throw new ApiError(404, "E_NOT_FOUND", "project not found");
    if (project.status !== "queued") return json({ skip: `project is ${project.status}` }, 409);
    return json(await processPayload(env, project));
  }
  const job = await dbOne<{ id: string; clip_id: string; tenant_id: string; status: string; spec: any }>(
    env, `render_jobs?id=eq.${id}&select=id,clip_id,tenant_id,status,spec`);
  if (!job?.spec) throw new ApiError(404, "E_NOT_FOUND", "render not found");
  if (job.status !== "queued") return json({ skip: `render is ${job.status}` }, 409);
  return json({ jobId: job.id, clipId: job.clip_id, tenantId: job.tenant_id, projectId: job.spec.project_id, spec: job.spec });
}

/** Last time every AI provider failed for a runner request (and why). */
export const AI_HEALTH_KEY = "_clipper/ai_health.json";

/**
 * The Container's door to the shared AI ladder.
 *
 * Scoring runs in the Container, but the model keys and the Groq -> OpenRouter
 * -> NVIDIA fallback logic live here, in PocketAthlete's `complete()`. So the
 * Container asks the Worker, and both apps get the same keys, the same
 * fallbacks and the same per-provider deadlines. If every model fails this
 * returns 503 and the Container scores with its built-in heuristics instead.
 */
export async function internalComplete(req: Request, env: Env): Promise<Response> {
  const b = await body<{ system?: string; user?: string; max_tokens?: number; json?: boolean }>(req);
  if (!b.system || !b.user) throw new ApiError(400, "E_VALIDATION", "system and user are required");
  if (!modelChain(env).length) {
    return json({ error: "no AI provider key set (GROQ_SECRET / OPENROUTER_API_KEY / NVIDIA_SECRET)" }, 503);
  }
  try {
    const out = await completeWithFallbacks(env, {
      system: b.system,
      user: b.user.slice(0, 60_000),
      maxTokens: Math.min(Math.max(Number(b.max_tokens) || 1500, 100), 4000),
      json: b.json !== false,
      // Paid rungs first: Clipper scoring is batch work and must not wait on
      // rate-limited free tiers.
      priority: true,
      validate: b.json === false ? undefined : (t) => {
        try { JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); return true; } catch { return false; }
      },
    });
    return json({ text: out.text, model: out.model, cost: out.cost });
  } catch (e) {
    // Logged so a dead key or retired model shows up in `wrangler tail`
    // instead of silently turning every project into heuristic-only scoring.
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 1500);
    console.error(`internal complete: ${msg}`);
    // Remembered for the admin System tab and the cron's "AI is down" alert.
    await env.R2_BUCKET.put(AI_HEALTH_KEY, JSON.stringify({ last_failure_at: new Date().toISOString(), error: msg })).catch(() => {});
    return json({ error: e instanceof Error ? e.message : String(e) }, 503);
  }
}
