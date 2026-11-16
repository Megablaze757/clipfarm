import type { Env } from "./env";
import { dbCount, dbJson, dbOne, dbPatch, rpc } from "./db";
import { dispatchToContainer } from "./container";
import { planFor, PRESETS } from "./plans";

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
  const plan = planFor(tenant?.plan);
  const running = await dbCount(env,
    `projects?tenant_id=eq.${project.tenant_id}&deleted_at=is.null&status=in.(${IN_FLIGHT.join(",")})&select=id`);
  if (running >= plan.concurrentJobs) return "waiting";

  const used = await minutesUsed(env, project.tenant_id);
  await dbPatch(env, `projects?id=eq.${projectId}&status=eq.queued`, { dispatched_at: new Date().toISOString() });
  await dispatchToContainer(env, `project:${projectId}`, "/process", {
    projectId,
    tenantId: project.tenant_id,
    source: project.source_kind === "upload" ? { kind: "upload", r2_key: project.source_uri } : { kind: "url", url: project.source_uri },
    options: project.options ?? {},
    plan: {
      id: plan.id,
      clipsPerSource: plan.clipsPerSource,
      maxSourceMinutes: plan.maxSourceMinutes,
      remainingMinutes: Math.max(0, plan.monthlyMinutes - used),
    },
  });
  return "dispatched";
}

interface ClipRow {
  id: string; tenant_id: string; candidate_id: string; title: string | null;
  t_in_ms: number; t_out_ms: number; edits: ClipEdits; status: string;
}
export interface ClipEdits {
  captions?: { enabled?: boolean; style?: string; edits?: { word_index: number; text: string }[] };
  layout?: { mode?: "auto" | "center" | "manual" | "fit"; aspect?: string; keyframes?: { t_ms: number; cx: number }[] };
  template_id?: string;
  title_overlay?: string;
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
  const cand = await dbOne<{ project_id: string }>(env, `candidates?id=eq.${clip.candidate_id}&select=project_id`);
  if (!cand) return;
  const [project, transcript, tenant] = await Promise.all([
    dbOne<{ id: string; title: string }>(env, `projects?id=eq.${cand.project_id}&select=id,title`),
    dbOne<{ words: { w: string; t0: number; t1: number }[] }>(env, `transcripts?project_id=eq.${cand.project_id}&select=words`),
    dbOne<{ plan: string }>(env, `tenants?id=eq.${clip.tenant_id}&select=plan`),
  ]);
  const preset = PRESETS[job.preset] ?? PRESETS.tiktok;
  const edits = clip.edits ?? {};
  const spec = {
    version: 3,
    mezzanine_key: `${clip.tenant_id}/projects/${cand.project_id}/mezzanine/mezzanine.mp4`,
    output_key: `${clip.tenant_id}/projects/${cand.project_id}/renders/${job.id}.mp4`,
    trim: { in_ms: clip.t_in_ms, out_ms: clip.t_out_ms },
    crop: {
      mode: edits.layout?.mode === "fit" ? "fit" : (edits.layout?.keyframes?.length ? "path" : "center"),
      keyframes: (edits.layout?.keyframes ?? []).slice(0, 60),
    },
    scale: { w: preset.w, h: preset.h },
    captions: {
      mode: edits.captions?.enabled === false ? "none" : "burn",
      style_id: edits.captions?.style ?? "karaoke_yellow",
      words: clipWords(transcript?.words ?? [], clip.t_in_ms, clip.t_out_ms, edits.captions),
    },
    overlays: edits.title_overlay ? [{ type: "title", text: edits.title_overlay.slice(0, 80), t_ms: [0, 2500] }] : [],
    watermark: planFor(tenant?.plan).watermark, // FR-11.6 — decided here, never by the client
    audio: { loudnorm: { target_lufs: -14, tp: -1.5 } },
    encode: { vcodec: "h264", crf: 20, preset: "medium", fps: preset.fps, faststart: true },
  };
  await dbPatch(env, `render_jobs?id=eq.${job.id}`, { spec });
  await dispatchToContainer(env, `render:${job.id}`, "/render", {
    jobId: job.id, clipId: clip.id, tenantId: clip.tenant_id, projectId: project?.id ?? cand.project_id, spec,
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
