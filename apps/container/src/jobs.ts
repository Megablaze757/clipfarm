import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { probe, StageError } from "./lib/proc";
import { db as supabase, ffAuthArgs, notifyNext, r2Delete, r2DownloadParallel, r2Upload, r2Url } from "./lib/worker";
import type { Candidate } from "./lib/types";
import { fetchSource } from "./pipeline/ingest";
import { analyzeLoudness, browserPlayable, energyEnvelope, extractAudio, makeMezzanine, poster } from "./pipeline/transcode";
import { localChunksUsed, pool, transcribe } from "./pipeline/asr";
import { sentences } from "./pipeline/text";
import { generateWindows, targetCount } from "./pipeline/candidates";
import { heuristicScore, reactionEvents, selectMMR, SCORER_VERSION } from "./pipeline/scoring";
import { chatNominations, nominateMoments } from "./pipeline/moments";
import { chatSpikes, type ChatSignal } from "./pipeline/chat";
import { alignSection, buildZoneAudio, downloadAudioOnly, downloadSection, downloadTwitchChat, LONG_MS, parseChatFile, probeLink, remapTranscript, spansGap, twitchVodId, zonesFromChat, zonesFromEnergy, type Zone } from "./pipeline/longform";
import { isSiteUrl } from "./pipeline/ingest";
import { refineWithLLM } from "./pipeline/llm-scoring";
import { snapBoundaries } from "./pipeline/boundaries";
import { renderFinal, setBackgroundSource, type RenderSpec } from "./pipeline/render";
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
  options: { language?: string; clip_durations?: number[] | "auto"; max_clips?: number | null; chat_key?: string };
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
    //
    // SPEED: an upload is never downloaded. FFmpeg reads it straight from R2
    // through the Worker (HTTP Range), so the audio is pulled in one pass and
    // thumbnails seek directly. A link is downloaded once (it has to be).
    await setStatus(projectId, "transcoding", { progress: 5 });
    stage("ingest");
    let input: string, inputArgs: string[], inputName: string, title: string | undefined;
    let long: { url: string; chatPath: Promise<string | null> } | null = null;
    if (job.source.kind === "upload") {
      // 8 parallel range requests, then everything reads the local file.
      // (Streaming through one connection measured ~20 MB/s: 2.5 min for 1 h.)
      const ext = job.source.r2_key.slice(job.source.r2_key.lastIndexOf("."));
      input = join(dir, `source${ext}`);
      const t = Date.now();
      const bytes = await r2DownloadParallel(job.source.r2_key, input);
      stage(`downloaded ${(bytes / 1e9).toFixed(2)} GB in ${((Date.now() - t) / 1000).toFixed(1)} s`);
      inputArgs = []; inputName = job.source.r2_key;
    } else {
      // A long stream (> 2 h): audio only now, chat alongside, video later
      // just for the clips that are picked (longform.ts).
      const linkInfo = isSiteUrl(job.source.url) ? await probeLink(job.source.url).catch(() => null) : null;
      if (linkInfo && linkInfo.durationMs > LONG_MS) {
        const vod = twitchVodId(job.source.url);
        const t = Date.now();
        const chatPath = vod && !job.options.chat_key ? downloadTwitchChat(vod, dir) : Promise.resolve(null);
        chatPath.catch(() => {});
        input = await downloadAudioOnly(job.source.url, dir);
        stage(`long stream (${(linkInfo.durationMs / 3_600_000).toFixed(1)} h): audio in ${((Date.now() - t) / 1000).toFixed(0)} s`);
        inputArgs = []; inputName = input; title = linkInfo.title;
        long = { url: job.source.url, chatPath };
      } else {
        const src = await fetchSource(job.source, dir);
        input = src.path; inputArgs = []; inputName = src.path; title = src.title;
      }
    }
    const info = await probe(input, inputArgs);
    if (!info.hasAudio) throw new StageError("E_NO_AUDIO_STREAM", "This source has no audio track, so there's nothing to transcribe.");
    if (info.durationMs < 10_000) throw new StageError("E_NO_CANDIDATES", "This source is shorter than 10 seconds.");
    const minutes = info.durationMs / 60_000;
    if (minutes > job.plan.maxSourceMinutes) throw new StageError("E_SOURCE_TOO_LONG", `Sources are limited to ${Math.round(job.plan.maxSourceMinutes / 60)} hours on this plan.`);
    if (minutes > job.plan.remainingMinutes) throw new StageError("E_TENANT_QUOTA", `This source is ${Math.ceil(minutes)} minutes but only ${Math.floor(job.plan.remainingMinutes)} remain this month. Upgrade to process it.`);
    await setStatus(projectId, "transcoding", { duration_ms: info.durationMs, progress: 10, ...(title ? { title } : {}) });

    // 2. The MEDIA everything plays and exports from. If browsers can play the
    // original, that's it — no working copy, no re-encode, no re-upload.
    // Otherwise (MKV, HEVC, audio-only…) make an MP4 copy, in parallel with
    // transcription. Either way only ONE full-size copy is stored.
    const playable = browserPlayable(info, inputName);
    let mediaKey: string;
    let mediaReady: Promise<void>;
    if (long) {
      mediaKey = ""; // no full copy — each picked clip gets its own section below
      mediaReady = Promise.resolve();
    } else if (playable && job.source.kind === "upload") {
      mediaKey = job.source.r2_key;
      mediaReady = Promise.resolve();
    } else if (playable) {
      const ext = inputName.slice(inputName.lastIndexOf(".")).toLowerCase();
      mediaKey = `${prefix}/source/source${ext}`;
      mediaReady = r2Upload(mediaKey, input, ext === ".webm" ? "video/webm" : "video/mp4");
    } else {
      mediaKey = `${prefix}/mezzanine/mezzanine.mp4`;
      const mezz = join(dir, "mezzanine.mp4");
      mediaReady = makeMezzanine(input, mezz, info, inputArgs).then(async (mode) => {
        stage(`working copy (${mode})`);
        await r2Upload(mediaKey, mezz, "video/mp4");
      });
    }
    mediaReady.catch(() => {}); // awaited below; avoid an unhandled rejection meanwhile
    if (!long) stage(playable ? "media: original is browser-playable — no working copy" : "media: making a working copy");

    // Audio for transcription, streamed straight from the source.
    const audio = join(dir, "audio.wav");
    await extractAudio(input, audio, inputArgs);

    // Live chat — a log the user added, or (long Twitch streams) fetched
    // automatically. Bursts mark what the audience reacted to (chat.ts).
    // Never fatal: a bad or missing log just means no chat signal.
    let chat: ChatSignal | null = null;
    try {
      let chatFile: string | null = null;
      if (job.options.chat_key) {
        chatFile = join(dir, "chat.log");
        await r2DownloadParallel(job.options.chat_key, chatFile);
      } else if (long) {
        chatFile = await long.chatPath;
      }
      if (chatFile) {
        chat = chatSpikes(await parseChatFile(chatFile), info.durationMs);
        stage(`chat: ${chat.messages} messages, ${chat.spikes.length} spikes`);
      }
    } catch (e) {
      console.warn(`chat log unusable: ${(e as Error).message.slice(0, 200)}`);
    }

    // 3. ASR + audio analysis (FR-3.x, FR-4.1–4.3)
    await setStatus(projectId, "transcribing", { progress: 20 });
    stage("asr");
    let transcript, envelope, loudness;
    let zones: Zone[] | null = null;
    if (long) {
      // Only the hot zones are transcribed, then mapped back to stream time.
      envelope = await energyEnvelope(audio, info.durationMs);
      zones = chat?.spikes.length ? zonesFromChat(chat, info.durationMs) : zonesFromEnergy(envelope, info.durationMs);
      const zoneMs = zones.reduce((a, z) => a + z.t1 - z.t0, 0);
      stage(`hot zones: ${zones.length} (${(zoneMs / 60_000).toFixed(0)} min of ${(info.durationMs / 60_000).toFixed(0)}) from ${chat?.spikes.length ? "chat" : "audio reactions"}`);
      const zoneWav = join(dir, "zones.wav");
      await buildZoneAudio(audio, zones, zoneWav);
      const [t, l] = await Promise.all([transcribe(zoneWav, zoneMs, dir, job.options.language ?? "auto"), analyzeLoudness(zoneWav)]);
      transcript = remapTranscript(t, zones); loudness = l;
    } else {
      [transcript, envelope, loudness] = await Promise.all([
        transcribe(audio, info.durationMs, dir, job.options.language ?? "auto"),
        energyEnvelope(audio, info.durationMs),
        analyzeLoudness(audio),
      ]);
    }
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
    // (Long streams: never a window that jumps between two hot zones.)
    const windows = generateWindows(words, sents, job.options.clip_durations, cap).filter((w) => !zones || !spansGap(words, w.i0, w.i1));
    const speechMs = words.reduce((s, w) => s + (w.t1 - w.t0), 0);
    const globalRate = words.length / Math.max(1, speechMs / 1000);
    const reactions = reactionEvents(words, envelope);

    const scored = windows.map((w) => heuristicScore(words, envelope, w, globalRate, reactions, chat));

    // Engine v2, pass 1: an AI reads the whole transcript and nominates the
    // moments an editor would cut. They join the heuristic windows below.
    await setStatus(projectId, "scoring", { progress: 55 });
    stage("nominate");
    const aiNominations = await nominateMoments(words, sents, 6, chat);
    // The biggest chat spikes are candidates too, unless the AI already took that moment.
    const nominations = [...aiNominations, ...chatNominations(sents, chat).filter((c) =>
      !aiNominations.some((m) => Math.max(m.s0, c.s0) <= Math.min(m.s1, c.s1)))]
      .filter((m) => !zones || !spansGap(words, sents[m.s0].i0, sents[m.s1].i1));
    const nominated = nominations.map((m) => {
      const c = heuristicScore(words, envelope, { i0: sents[m.s0].i0, i1: sents[m.s1].i1, t0: sents[m.s0].t0, t1: sents[m.s1].t1 }, globalRate, reactions, chat);
      c.features.nominated = true;
      c.features.category = m.category;
      if (m.hook) c.features.hook_line = m.hook;
      if (m.why) c.rationale = m.why;
      return c;
    });
    if (!windows.length && !nominated.length) throw new StageError("E_NO_CANDIDATES", "No clip-length moments were found. Try a different clip duration.");

    await setStatus(projectId, "scoring", { progress: 62 });
    stage(`judge (${nominated.length} nominated, ${reactions.length} reactions)`);
    const n = targetCount(info.durationMs, job.plan.clipsPerSource, job.options.max_clips ?? null);
    // Pass 2 sees every nominated moment plus the best diverse heuristic
    // windows (cost control: never the whole pool).
    const heuristicPicks = selectMMR(scored, Math.min(scored.length, Math.max(n * 2, 12)), 0.2);
    const shortlist = [...nominated.slice(0, Math.max(n * 3, 20)), ...heuristicPicks];
    const { model } = await refineWithLLM(shortlist, words);
    const picked = snapBoundaries(selectMMR(shortlist, n), words, envelope);

    // 5. Thumbnails only — NO preview videos. The shortlist and the editor
    // play each clip straight from the media (start/end + centre crop in the
    // browser), so the old per-clip encodes, minutes on a long stream, are gone.
    // A thumbnail is one keyframe seek: well under a second each.
    await setStatus(projectId, "scoring", { progress: 85 });
    stage("thumbnails");
    const rows: (Record<string, unknown> | undefined)[] = new Array(picked.length);
    let posterFrom: { file: string; atMs: number } | null = null;
    await pool(picked.length, long ? 3 : 4, async (i) => {
      const c: Candidate = picked[i];
      const thumbPath = join(dir, `thumb_${i}.jpg`);
      const thumbKey = `${prefix}/thumbs/cand_${i}.jpg`;
      if (long) {
        // Long stream: fetch just this clip's video (±20 s), find exactly where
        // it sits in the stream, and make it the clip's own media.
        const secPath = join(dir, `section_${i}.mp4`), secKey = `${prefix}/sections/cand_${i}.mp4`;
        const want = Math.max(0, c.t_in_ms - 20_000);
        try {
          await downloadSection(long.url, want, c.t_out_ms + 20_000, secPath);
          const sec = await probe(secPath);
          const offset = await alignSection(secPath, sec.durationMs, envelope, want);
          await r2Upload(secKey, secPath, "video/mp4");
          await poster(secPath, Math.max(0, c.t_in_ms - offset + 1000), thumbPath).catch(() => {});
          await r2Upload(thumbKey, thumbPath, "image/jpeg").catch(() => {});
          if (i === 0) posterFrom = { file: secPath, atMs: Math.max(0, c.t_in_ms - offset + 1000) };
          rows[i] = {
            project_id: projectId, t_in_ms: c.t_in_ms, t_out_ms: c.t_out_ms, score: c.score, subscores: c.subscores,
            features: { ...c.features, thumb_key: thumbKey, edit_key: secKey, edit_offset_ms: offset, edit_duration_ms: sec.durationMs },
            rationale: c.rationale, proxy_uri: secKey, scorer_version: `${SCORER_VERSION}${c.features.model ? `+${c.features.model}` : ""}`,
          };
        } catch (e) {
          console.warn(`section ${i}: ${(e as Error).message.slice(0, 300)}`); // dropped: no video to edit
        }
        return;
      }
      try {
        await poster(input, c.t_in_ms + 1000, thumbPath, undefined, inputArgs);
        await r2Upload(thumbKey, thumbPath, "image/jpeg");
      } catch (e) {
        console.warn(`thumbnail ${i}: ${(e as Error).message.slice(0, 200)}`);
      }
      rows[i] = {
        project_id: projectId, t_in_ms: c.t_in_ms, t_out_ms: c.t_out_ms, score: c.score,
        subscores: c.subscores,
        features: { ...c.features, thumb_key: thumbKey },
        rationale: c.rationale, proxy_uri: mediaKey, scorer_version: `${SCORER_VERSION}${c.features.model ? `+${c.features.model}` : ""}`,
      };
    });
    await mediaReady;
    if (!long) await supabase.from("artifacts").upsert({ project_id: projectId, stage: "media", uri: mediaKey, meta: { width: info.width, height: info.height, playable } }, { onConflict: "project_id,stage" });
    const saved = rows.filter((r): r is Record<string, unknown> => !!r);
    if (!saved.length) throw new StageError("E_INGEST_CORRUPT", "The stream's video couldn't be downloaded for any clip.");
    // A retried project replaces its previous candidates.
    await supabase.from("candidates").delete().eq("project_id", projectId);
    const { error: insErr } = await supabase.from("candidates").insert(saved);
    if (insErr) throw new Error(`saving candidates: ${insErr.message}`);

    const posterPath = join(dir, "poster.jpg");
    const pf = posterFrom as { file: string; atMs: number } | null;
    if (long && pf) await poster(pf.file, pf.atMs, posterPath);
    else await poster(input, Math.max(1000, info.durationMs * 0.05), posterPath, undefined, inputArgs);
    await r2Upload(`${prefix}/thumbs/poster.jpg`, posterPath, "image/jpeg");
    await writeFile(join(dir, "transcript.srt"), buildSrt(words));
    await r2Upload(`${prefix}/artifacts/transcript.srt`, join(dir, "transcript.srt"), "application/x-subrip");

    // 6. Usage (§15.4) — idempotent per project.
    await supabase.from("usage_events").upsert({
      tenant_id: tenantId, project_id: projectId, kind: "ingest",
      quantity: Math.round(minutes * 100) / 100, idempotency_key: `${projectId}:ingest`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });

    await setStatus(projectId, "ready", {
      // review_proxy_key = the media the editor and shortlist play.
      progress: 100, poster_key: `${prefix}/thumbs/poster.jpg`, review_proxy_key: long ? null : mediaKey,
      candidate_count: saved.length, top_score: picked[0]?.score ?? null,
      model_versions: { asr: localChunksUsed() ? `groq/whisper-large-v3-turbo + local faster-whisper/${process.env.WHISPER_MODEL || "small"} (${localChunksUsed()} chunks)` : "groq/whisper-large-v3-turbo", scorer: SCORER_VERSION, llm: model ?? "heuristic-only", ...(chat ? { chat: `${chat.messages} messages, ${chat.spikes.length} spikes` } : {}), ...(zones ? { long_stream: `${zones.length} hot zones` } : {}) },
    });
    stage("ready");
    // If a working copy replaced the upload, the original isn't needed: delete
    // it now so only one full-size copy is ever stored. When the original IS
    // the media, it stays until the bucket's 7-day rule removes it.
    if (job.source.kind === "upload" && mediaKey !== job.source.r2_key) {
      await r2Delete(job.source.r2_key).catch((e) => console.warn(`could not delete source: ${(e as Error).message}`));
    }
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
    // Read the stored media over HTTP Range — only the seconds being cut are
    // fetched, instead of downloading a multi-GB source first.
    const out = join(dir, "out.mp4");
    setBackgroundSource(r2Url); // uploaded split-screen footage is read straight from R2
    const { durationMs } = await renderFinal(r2Url(job.spec.mezzanine_key), job.spec, dir, out, await ffAuthArgs());
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

