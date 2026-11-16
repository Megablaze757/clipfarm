import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { probe, StageError } from "./lib/proc";
import { db as supabase, notifyNext, r2Delete, r2Download, r2Upload } from "./lib/worker";
import type { Candidate } from "./lib/types";
import { fetchSource } from "./pipeline/ingest";
import { analyzeLoudness, energyEnvelope, extractAudio, makeMezzanine, poster, reviewProxy } from "./pipeline/transcode";
import { transcribe } from "./pipeline/asr";
import { sentences } from "./pipeline/text";
import { generateWindows, targetCount } from "./pipeline/candidates";
import { heuristicScore, selectMMR, SCORER_VERSION } from "./pipeline/scoring";
import { refineWithLLM } from "./pipeline/llm-scoring";
import { snapBoundaries } from "./pipeline/boundaries";
import { renderFinal, renderProxy, type RenderSpec } from "./pipeline/render";
import { buildSrt } from "./pipeline/captions";

/**
 * The two jobs, shared by both runners: server.ts (Cloudflare Container) and
 * cli.ts (GitHub Actions). All writes go through the Worker (`supabase` here is
 * the Worker-proxy shim from lib/worker.ts, not supabase-js).
 */
const WORK = process.env.WORK_DIR || "/tmp/clipper";


export interface ProcessJob {
  projectId: string;
  tenantId: string;
  source: { kind: "upload"; r2_key: string } | { kind: "url"; url: string };
  options: { language?: string; clip_durations?: number[] | "auto"; max_clips?: number | null };
  plan: { id: string; clipsPerSource: number | null; maxSourceMinutes: number; remainingMinutes: number };
}

async function setStatus(projectId: string, status: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabase.from("projects").update({ status, ...extra }).eq("id", projectId);
  if (error) console.error(`status ${status}: ${error.message}`);
}

export async function processProject(job: ProcessJob): Promise<void> {
  const { projectId, tenantId } = job;
  const dir = join(WORK, projectId);
  const prefix = `${tenantId}/projects/${projectId}`;
  const started = Date.now();
  const stage = (name: string) => console.log(JSON.stringify({ project_id: projectId, stage: name, t: Date.now() - started }));
  // Heartbeat: touching the row bumps updated_at, so the Worker's stale-job
  // sweep (no update for an hour) never kills a long but healthy transcode.
  const heartbeat = setInterval(() => {
    supabase.from("projects").update({ dispatched_at: new Date().toISOString() }).eq("id", projectId).then(() => {}, () => {});
  }, 5 * 60 * 1000);
  try {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    // 1. Ingest + validate (FR-1.x)
    await setStatus(projectId, "transcoding", { progress: 5 });
    stage("ingest");
    const src = await fetchSource(job.source, dir);
    const info = await probe(src.path);
    if (!info.hasAudio) throw new StageError("E_NO_AUDIO_STREAM", "This source has no audio track, so there's nothing to transcribe.");
    if (info.durationMs < 10_000) throw new StageError("E_NO_CANDIDATES", "This source is shorter than 10 seconds.");
    const minutes = info.durationMs / 60_000;
    if (minutes > job.plan.maxSourceMinutes) throw new StageError("E_SOURCE_TOO_LONG", `Sources are limited to ${Math.round(job.plan.maxSourceMinutes / 60)} hours on this plan.`);
    if (minutes > job.plan.remainingMinutes) throw new StageError("E_TENANT_QUOTA", `This source is ${Math.ceil(minutes)} minutes but only ${Math.floor(job.plan.remainingMinutes)} remain this month. Upgrade to process it.`);
    const titleUpdate = src.title ? { title: src.title } : {};
    await setStatus(projectId, "transcoding", { duration_ms: info.durationMs, progress: 10, ...titleUpdate });

    // 2. Audio first — ASR can start while the mezzanine encodes.
    const audio = join(dir, "audio.wav");
    await extractAudio(src.path, audio);
    const mezz = join(dir, "mezzanine.mp4");
    const mezzReady = makeMezzanine(src.path, mezz, info).then(async () => {
      stage("mezzanine");
      await r2Upload(`${prefix}/mezzanine/mezzanine.mp4`, mezz, "video/mp4");
      await supabase.from("artifacts").upsert({ project_id: projectId, stage: "mezzanine", uri: `${prefix}/mezzanine/mezzanine.mp4`, meta: { width: info.width, height: info.height } }, { onConflict: "project_id,stage" });
    });
    mezzReady.catch(() => {}); // awaited below; avoid an unhandled rejection meanwhile

    // 3. ASR + audio analysis (FR-3.x, FR-4.1–4.3)
    await setStatus(projectId, "transcribing", { progress: 20 });
    stage("asr");
    const [transcript, envelope, loudness] = await Promise.all([
      transcribe(audio, info.durationMs, dir, job.options.language ?? "auto"),
      energyEnvelope(audio, info.durationMs),
      analyzeLoudness(audio),
    ]);
    await supabase.from("transcripts").upsert({
      project_id: projectId, words: transcript.words, segments: transcript.segments,
      speakers: transcript.speakers, language: transcript.language,
    }, { onConflict: "project_id" });
    await setStatus(projectId, "analyzing", { language: transcript.language, loudness_json: loudness, progress: 45 });

    // 4. Candidates — Stage A recall (cheap rules) then Stage B scoring (§6.3)
    await setStatus(projectId, "candidates", { progress: 50 });
    stage("candidates");
    const words = transcript.words;
    const sents = sentences(words);
    const cap = Math.max(60, Math.round((info.durationMs / 3_600_000) * 500));
    const windows = generateWindows(words, sents, job.options.clip_durations, cap);
    if (!windows.length) throw new StageError("E_NO_CANDIDATES", "No clip-length moments were found. Try a different clip duration.");
    const speechMs = words.reduce((s, w) => s + (w.t1 - w.t0), 0);
    const globalRate = words.length / Math.max(1, speechMs / 1000);
    const scored = windows.map((w) => heuristicScore(words, envelope, w, globalRate));

    await setStatus(projectId, "scoring", { progress: 60 });
    stage("scoring");
    const n = targetCount(info.durationMs, job.plan.clipsPerSource, job.options.max_clips ?? null);
    // Only the best-looking, already-diverse windows reach the model (§17.2 cost control).
    const shortlist = selectMMR(scored, Math.min(scored.length, Math.max(n * 3, 15)), 0.2);
    const { model } = await refineWithLLM(shortlist);
    const picked = snapBoundaries(selectMMR(shortlist, n), words, envelope);

    // 5. Proxies + posters (needs the mezzanine)
    await setStatus(projectId, "scoring", { progress: 75 });
    await mezzReady;
    stage("proxies");
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < picked.length; i++) {
      const c: Candidate = picked[i];
      const proxyPath = join(dir, `proxy_${i}.mp4`);
      const thumbPath = join(dir, `thumb_${i}.jpg`);
      await renderProxy(mezz, c.t_in_ms, c.t_out_ms, proxyPath);
      await poster(mezz, c.t_in_ms + 1000, thumbPath);
      const proxyKey = `${prefix}/proxies/${i}_${c.t_in_ms}.mp4`;
      const thumbKey = `${prefix}/thumbs/cand_${i}.jpg`;
      await r2Upload(proxyKey, proxyPath, "video/mp4");
      await r2Upload(thumbKey, thumbPath, "image/jpeg");
      rows.push({
        project_id: projectId, t_in_ms: c.t_in_ms, t_out_ms: c.t_out_ms, score: c.score,
        subscores: c.subscores, features: { ...c.features, thumb_key: thumbKey },
        rationale: c.rationale, proxy_uri: proxyKey, scorer_version: `${SCORER_VERSION}${c.features.model ? `+${c.features.model}` : ""}`,
      });
      await setStatus(projectId, "scoring", { progress: 75 + Math.round((20 * (i + 1)) / picked.length) });
    }
    // A retried project replaces its previous candidates.
    await supabase.from("candidates").delete().eq("project_id", projectId);
    const { error: insErr } = await supabase.from("candidates").insert(rows);
    if (insErr) throw new Error(`saving candidates: ${insErr.message}`);

    const posterPath = join(dir, "poster.jpg");
    await poster(mezz, Math.max(1000, info.durationMs * 0.05), posterPath, join(dir, "poster.webp"));
    await r2Upload(`${prefix}/thumbs/poster.jpg`, posterPath, "image/jpeg");
    const reviewPath = join(dir, "review.mp4");
    await reviewProxy(mezz, reviewPath);
    await r2Upload(`${prefix}/proxies/review.mp4`, reviewPath, "video/mp4");
    await writeFile(join(dir, "transcript.srt"), buildSrt(words));
    await r2Upload(`${prefix}/artifacts/transcript.srt`, join(dir, "transcript.srt"), "application/x-subrip");

    // 6. Usage (§15.4) — idempotent per project.
    await supabase.from("usage_events").upsert({
      tenant_id: tenantId, project_id: projectId, kind: "ingest",
      quantity: Math.round(minutes * 100) / 100, idempotency_key: `${projectId}:ingest`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });

    await setStatus(projectId, "ready", {
      progress: 100, poster_key: `${prefix}/thumbs/poster.jpg`, review_proxy_key: `${prefix}/proxies/review.mp4`,
      candidate_count: rows.length, top_score: picked[0]?.score ?? null,
      model_versions: { asr: "groq/whisper-large-v3-turbo", scorer: SCORER_VERSION, llm: model ?? "heuristic-only" },
    });
    stage("ready");
    // The upload has done its job (the mezzanine replaces it): delete it now
    // rather than keeping a full-size copy for 7 days. Failed projects keep
    // theirs so Retry still works.
    if (job.source.kind === "upload") await r2Delete(job.source.r2_key).catch((e) => console.warn(`could not delete source: ${(e as Error).message}`));
  } catch (e) {
    const err = e instanceof StageError ? e : null;
    const detail = String((e as Error)?.message ?? e).slice(-1000);
    console.error(JSON.stringify({ project_id: projectId, error: err?.code ?? "E_PROCESSING_FAILED", detail }));
    await setStatus(projectId, "failed", { error_code: err?.code ?? "E_TRANSCODE_FAILED", error_detail: err ? err.message : detail });
  } finally {
    clearInterval(heartbeat);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await notifyNext(projectId);
  }
}

// --- Final render (§7.1) ----------------------------------------------------------

export interface RenderJob {
  jobId: string;
  clipId: string;
  tenantId: string;
  projectId: string;
  spec: RenderSpec & { mezzanine_key: string; output_key: string };
}

export async function renderJob(job: RenderJob): Promise<void> {
  const dir = join(WORK, `render_${job.jobId}`);
  const t0 = Date.now();
  try {
    await supabase.from("render_jobs").update({ status: "running" }).eq("id", job.jobId);
    await mkdir(dir, { recursive: true });
    const mezz = join(dir, "mezzanine.mp4");
    await r2Download(job.spec.mezzanine_key, mezz);
    const out = join(dir, "out.mp4");
    const { durationMs } = await renderFinal(mezz, job.spec, dir, out);
    await r2Upload(job.spec.output_key, out, "video/mp4");
    await supabase.from("render_jobs").update({
      status: "completed", uri: job.spec.output_key, duration_ms: durationMs,
      container_ms: Date.now() - t0, finished_at: new Date().toISOString(),
    }).eq("id", job.jobId);
    await supabase.from("clips").update({ status: "exported" }).eq("id", job.clipId);
    await supabase.from("usage_events").upsert({
      tenant_id: job.tenantId, project_id: job.projectId, kind: "render",
      quantity: Math.round(durationMs / 1000), idempotency_key: `${job.jobId}:render`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  } catch (e) {
    const detail = String((e as Error)?.message ?? e).slice(-1000);
    console.error(JSON.stringify({ render_id: job.jobId, error: detail }));
    await supabase.from("render_jobs").update({
      status: "failed", error_code: "E_RENDER_FAILED", error_detail: detail, finished_at: new Date().toISOString(),
    }).eq("id", job.jobId);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

