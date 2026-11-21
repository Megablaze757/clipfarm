import type { Env } from "./env";
import { dbCount, dbJson, dbOne, dbPatch, rpc } from "./db";
import { dispatchToContainer } from "./container";
import { planFor, planForTenant, PRESETS } from "./plans";
import { loadBrand, tastes } from "./brand";
import { getSettings } from "./settings";
import { LANGUAGES, translateCaptions } from "./translate";

export const IN_FLIGHT = ["transcoding", "transcribing", "analyzing", "candidates", "scoring"];

export interface ProjectRow {
  id: string;
  tenant_id: string;
  title: string;
  source_kind: "upload" | "url";
  source_uri: string;
  status: string;
  options: Record<string, unknown> | null;
  dispatched_at: string | null;
  duration_ms: number | null;
}

export function monthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function minutesUsed(env: Env, tenantId: string): Promise<number> {
  const n = await rpc<number>(env, "tenant_usage_minutes", { p_tenant: tenantId, p_since: monthStart() });
  return Number(n) || 0;
}

/**
 * Hands a queued project to a Container if the tenant has a free job slot
 * (per-tenant concurrency cap, §17.2). Otherwise it stays queued and the cron
 * sweep starts it when a slot frees. Safe to call repeatedly.
 */
export async function dispatchProject(env: Env, projectId: string): Promise<"dispatched" | "waiting" | "skipped"> {
  const project = await dbOne<ProjectRow>(env, `projects?id=eq.${projectId}&deleted_at=is.null&select=*`);
  if (!project || project.status !== "queued") return "skipped";
  const tenant = await dbOne<{ plan: string }>(env, `tenants?id=eq.${project.tenant_id}&select=plan`);
  const plan = planForTenant(project.tenant_id, tenant?.plan);
  const running = await dbCount(env,
    `projects?tenant_id=eq.${project.tenant_id}&deleted_at=is.null&status=in.(${IN_FLIGHT.join(",")})&select=id`);
  if (running >= plan.concurrentJobs) return "waiting";

  await dbPatch(env, `projects?id=eq.${projectId}&status=eq.queued`, { dispatched_at: new Date().toISOString() });
  await runJob(env, "process", projectId, await processPayload(env, project));
  return "dispatched";
}

/** What the processing job needs. Also served to GitHub runners at /v1/internal/jobs/process/{id}. */
export async function processPayload(env: Env, project: ProjectRow) {
  const tenant = await dbOne<{ plan: string }>(env, `tenants?id=eq.${project.tenant_id}&select=plan`);
  const plan = planForTenant(project.tenant_id, tenant?.plan);
  const used = await minutesUsed(env, project.tenant_id);
  return {
    projectId: project.id,
    tenantId: project.tenant_id,
    source: project.source_kind === "upload" ? { kind: "upload", r2_key: project.source_uri } : { kind: "url", url: project.source_uri },
    options: project.options ?? {},
    title: (project as { title?: string }).title ?? null,
    // What this workspace's own results say about each kind of moment (brand.ts).
    tastes: await tastes(env, project.tenant_id).catch(() => ({})),
    plan: {
      id: plan.id,
      clipsPerSource: plan.clipsPerSource,
      maxSourceMinutes: plan.maxSourceMinutes,
      remainingMinutes: Math.max(0, plan.monthlyMinutes - used),
    },
  };
}

/** Which machine runs FFmpeg: free GitHub Actions runners (default) or Cloudflare Containers. */
export function runnerMode(env: Env): "github" | "container" | null {
  if ((env.CLIPPER_RUNNER ?? "github") === "container") return env.FFMPEG ? "container" : null;
  return githubToken(env) ? "github" : null;
}

const githubToken = (env: Env) => (env.CLIPPER_GITHUB_TOKEN || env.GITHUB_TOKEN || "").trim();
const githubRepo = (env: Env) => (env.CLIPPER_GITHUB_REPO || "Megablaze757/clipfarm").trim();

/**
 * Starts a job. In GitHub mode this fires a repository_dispatch event; the
 * runner (.github/workflows/clipper-job.yml) then fetches the job from the
 * Worker itself, proving who it is with a GitHub OIDC token — so nothing
 * sensitive ever goes in the (publicly visible) event payload.
 */
/** Which runner a job goes to — GitHub's, or the operator's own PC (settings.home_runner). */
async function homeRunner(env: Env, kind: "process" | "render", payload: unknown): Promise<{ runs_on?: string }> {
  const mode = (await getSettings(env).catch(() => ({} as { home_runner?: string }))).home_runner ?? "off";
  if (mode === "all") return { runs_on: "self-hosted" };
  if (mode === "youtube" && kind === "process") {
    const url = (payload as { source?: { url?: string } })?.source?.url ?? "";
    if (/^https?:\/\/([a-z0-9-]+\.)?(youtube\.com|youtu\.be)\//i.test(url)) return { runs_on: "self-hosted" };
  }
  return {};
}

export async function runJob(env: Env, kind: "process" | "render", id: string, payload: unknown): Promise<void> {
  const mode = runnerMode(env);
  if (mode === "container") {
    await dispatchToContainer(env, `${kind === "process" ? "project" : "render"}:${id}`, kind === "process" ? "/process" : "/render", payload);
    return;
  }
  if (mode !== "github") throw new Error("no video runner configured (set GITHUB_TOKEN, or CLIPPER_RUNNER=container with the Container binding)");
  const r = await fetch(`https://api.github.com/repos/${githubRepo(env)}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken(env)}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "apex-api-clipper",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: `clipper-${kind}`, client_payload: { id, ...(await homeRunner(env, kind, payload)) } }),
  });
  if (r.status !== 204) {
    throw new Error(`GitHub refused the dispatch (${r.status}) — the token needs Contents: read & write on ${githubRepo(env)}: ${(await r.text()).slice(0, 200)}`);
  }
}

interface ClipRow {
  id: string; tenant_id: string; candidate_id: string; title: string | null;
  t_in_ms: number; t_out_ms: number; edits: ClipEdits; status: string;
}
export interface ClipEdits {
  captions?: { enabled?: boolean; style?: string; edits?: { word_index: number; text: string }[]; /** translate to (translate.ts) */ lang?: string };
  layout?: { mode?: "auto" | "center" | "manual" | "fit" | "two"; aspect?: string; keyframes?: { t_ms: number; cx: number }[]; two?: { a: number; b: number } | null };
  template_id?: string;
  title_overlay?: string;
  /** Cut long pauses and "um/uh" on export (default on). */
  tighten?: boolean;
  /** Jump-zoom punch-ins on export (default on). */
  zoom?: boolean;
  /** Split-screen footage under the speaker (see backgrounds.ts). */
  background?: { kind: "none" } | { kind: "builtin"; id: string; sound?: boolean } | { kind: "upload"; key: string };
}

/** Applies caption edits to the transcript words inside [t_in, t_out]. */
export function clipWords(
  words: { w: string; t0: number; t1: number; speaker?: string }[],
  t_in: number, t_out: number, edits: ClipEdits["captions"],
) {
  const fixes = new Map((edits?.edits ?? []).map((e) => [e.word_index, e.text]));
  const out: { i: number; w: string; t0: number; t1: number; speaker?: string }[] = [];
  words.forEach((word, i) => {
    if (word.t1 <= t_in || word.t0 >= t_out) return;
    const text = fixes.has(i) ? String(fixes.get(i)) : word.w;
    if (text.trim()) out.push({ i, w: text, t0: word.t0, t1: word.t1, speaker: word.speaker });
  });
  return out;
}

/** Builds the render spec (§7.1) and starts the render Container. */
export async function dispatchRender(env: Env, jobId: string): Promise<void> {
  const job = await dbOne<{ id: string; clip_id: string; preset: string; kind: string; status: string }>(
    env, `render_jobs?id=eq.${jobId}&select=id,clip_id,preset,kind,status`);
  if (!job || job.status !== "queued") return;
  const clip = await dbOne<ClipRow>(env, `clips?id=eq.${job.clip_id}&select=*`);
  if (!clip) return;
  const cand = await dbOne<{ project_id: string; features: { edit_key?: string; edit_offset_ms?: number } | null }>(env, `candidates?id=eq.${clip.candidate_id}&select=project_id,features`);
  if (!cand) return;
  const [project, transcript, tenant] = await Promise.all([
    dbOne<{ id: string; title: string; review_proxy_key: string | null }>(env, `projects?id=eq.${cand.project_id}&select=id,title,review_proxy_key`),
    dbOne<{ words: { w: string; t0: number; t1: number }[] }>(env, `transcripts?project_id=eq.${cand.project_id}&select=words`),
    dbOne<{ plan: string }>(env, `tenants?id=eq.${clip.tenant_id}&select=plan`),
  ]);
  const preset = PRESETS[job.preset] ?? PRESETS.tiktok;
  const section = cand.features?.edit_key && !project?.review_proxy_key ? { key: cand.features.edit_key, offset: Number(cand.features.edit_offset_ms ?? 0) } : null;
  const edits = clip.edits ?? {};
  const spec = {
    version: 3,
    project_id: project?.id ?? cand.project_id,
    // The media the project plays from: the original upload when browsers can
    // play it, otherwise its working copy. (Older projects: the mezzanine.)
    // Long streams have no full copy: each clip exports from its own section.
    mezzanine_key: section ? section.key : project?.review_proxy_key || `${clip.tenant_id}/projects/${cand.project_id}/mezzanine/mezzanine.mp4`,
    output_key: `${clip.tenant_id}/projects/${cand.project_id}/renders/${job.id}.mp4`,
    trim: { in_ms: clip.t_in_ms - (section?.offset ?? 0), out_ms: clip.t_out_ms - (section?.offset ?? 0) },
    crop: edits.layout?.mode === "two" && edits.layout.two
      ? { mode: "two", keyframes: [], a: Number(edits.layout.two.a), b: Number(edits.layout.two.b) }
      : {
        mode: edits.layout?.mode === "fit" ? "fit" : (edits.layout?.keyframes?.length ? "path" : "center"),
        keyframes: (edits.layout?.keyframes ?? []).slice(0, 60),
      },
    scale: { w: preset.w, h: preset.h },
    captions: {
      mode: edits.captions?.enabled === false ? "none" : "burn",
      style_id: edits.captions?.style ?? "karaoke_yellow",
      words: clipWords(transcript?.words ?? [], clip.t_in_ms, clip.t_out_ms, edits.captions)
        .map((w) => (section ? { ...w, t0: w.t0 - section.offset, t1: w.t1 - section.offset } : w)),
    },
    background: edits.background?.kind === "builtin" || edits.background?.kind === "upload" ? edits.background : { kind: "none" },
    // The headline stays up for the whole clip — it's the context, not an intro card.
    overlays: edits.title_overlay ? [{ type: "title", text: edits.title_overlay.slice(0, 80), t_ms: [0, clip.t_out_ms - clip.t_in_ms] }] : [],
    watermark: planFor(tenant?.plan).watermark, // FR-11.6 — decided here, never by the client
    tighten: edits.tighten !== false,
    zoom: edits.zoom !== false,
    // Brand kit: logo in a corner, caption + headline colours (brand.ts).
    brand: await loadBrand(env, clip.tenant_id).then((b) => (b ? { logo: b.logo ?? null, logo_position: b.logo_position, colors: b.colors ?? {} } : null)).catch(() => null),
    audio: { loudnorm: { target_lufs: -14, tp: -1.5 } },
    encode: { vcodec: "h264", crf: 21, preset: "veryfast", fps: preset.fps, faststart: true }, // veryfast: ~3x faster than medium; CRF 21 keeps quality well above what TikTok/Reels re-encode to
  };
  // Translated captions (and headline), if the clip asks for a language.
  const lang = edits.captions?.lang;
  if (lang && LANGUAGES[lang] && spec.captions.mode === "burn") {
    const tr = await translateCaptions(env, clip.id, spec.captions.words, edits.title_overlay, lang)
      .catch((e) => { console.error(`translate ${clip.id} → ${lang}: ${String(e)}`); return null; });
    if (tr) {
      spec.captions.words = tr.words.map((w, i) => ({ i, w: w.w, t0: w.t0, t1: w.t1 }));
      if (tr.headline && spec.overlays[0]) spec.overlays[0].text = tr.headline;
    }
  }
  await dbPatch(env, `render_jobs?id=eq.${job.id}`, { spec });
  await runJob(env, "render", job.id, {
    jobId: job.id, clipId: clip.id, tenantId: clip.tenant_id, projectId: spec.project_id, spec,
  });
}

export async function failStale(env: Env): Promise<void> {
  // Anything "in flight" for over an hour has lost its Container (§12.6).
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await dbJson(env, `projects?status=in.(${IN_FLIGHT.join(",")})&updated_at=lt.${cutoff}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", error_code: "E_PROCESSING_TIMEOUT", error_detail: "Processing stopped responding. Retry the project." }),
  });
  await dbJson(env, `render_jobs?status=eq.running&queued_at=lt.${cutoff}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "failed", error_code: "E_RENDER_TIMEOUT" }),
  });
}
