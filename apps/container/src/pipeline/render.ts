import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, ffmpegFromStdin, probe } from "../lib/proc";
import { GAME_H, GAME_HOOKS, GAME_W, GAMES, renderGame, type Sfx } from "./games";
import { synthSfx } from "./sfx";
import { cutTotal, enableExpr, isFiller, keepExpr, mapTime, planCuts, planZooms } from "./tighten";
import { buildAss, type CapWord } from "./captions";

/** Grid proxy (§7.1): 9:16 centre crop, 360×640, CRF 30 — ~15 % of a final's cost. */
export async function renderProxy(mezzanine: string, inMs: number, outMs: number, out: string): Promise<void> {
  await ffmpeg(["-ss", (inMs / 1000).toFixed(3), "-i", mezzanine, "-t", ((outMs - inMs) / 1000).toFixed(3),
    "-vf", "crop='min(iw,ih*9/16)':ih,scale=360:640,setsar=1",
    "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", out], 10 * 60 * 1000);
}

export interface RenderSpec {
  trim: { in_ms: number; out_ms: number };
  /** "two": two people stacked — a on top, b below (face centres, 0-1 of the width). */
  crop: { mode: "center" | "path" | "fit" | "two"; keyframes: { t_ms: number; cx: number }[]; a?: number; b?: number };
  scale: { w: number; h: number };
  captions: { mode: "burn" | "none"; style_id: string; words: { w: string; t0: number; t1: number }[] };
  overlays: { type: "title"; text: string; t_ms: [number, number] }[];
  /** Split screen: speaker on top, this footage below (absent/none = full frame). */
  background?: { kind: "none" } | { kind: "builtin"; id: string; sound?: boolean } | { kind: "upload"; key: string };
  watermark: boolean;
  /** Cut long pauses and "um/uh" (default on for new clips). */
  tighten?: boolean;
  /** Jump-zoom punch-ins on punch words and every ~6 s. */
  zoom?: boolean;
  /** Brand kit (brand.ts on the Worker): logo + colours. */
  brand?: { logo?: string | null; logo_position?: string; colors?: { active?: string; keyword?: string; headline_bg?: string; headline_text?: string } } | null;
  audio: { loudnorm: { target_lufs: number; tp: number } };
  encode: { crf: number; preset: string; fps: number };
}

// Caption/title fonts ship with the pipeline (apps/container/fonts, OFL).
export const FONTS_DIR = join(__dirname, "..", "..", "fonts");
const FONT = [join(FONTS_DIR, "Montserrat-ExtraBold.ttf"), "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"]
  .find((p) => existsSync(p)) ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/**
 * Generated split-screen backgrounds: FFmpeg sources, rendered small and
 * scaled up, so they cost almost nothing and carry no licence. `s` is the
 * generator's own resolution.
 */
export function builtinBackground(id: string, durS: number, fps: number): string {
  const d = (durS + 1).toFixed(2);
  switch (id) {
    case "fractal_zoom":
      return `mandelbrot=s=270x240:rate=${fps}:end_scale=0.0005:end_pts=${d}:inner=mincol,hue=H=t*0.4`;
    case "colour_flow":
      return `gradients=s=270x240:rate=${fps}:speed=0.03:n=5:c0=0xff2d95:c1=0x7a00ff:c2=0x00e5ff:c3=0x00ff88:c4=0xffd000:duration=${d}`;
    case "pixel_rain":
      return `cellauto=s=135x120:rule=30:rate=${fps}:scroll=1:full=1,negate,format=rgb24,colorchannelmixer=rr=0.1:gg=0.9:bb=0.6,trim=duration=${d}`;
    case "neon_life":
    default:
      return `life=s=135x120:mold=20:rate=${fps}:ratio=0.18:death_color=#140026:life_color=#00f0ff:mold_color=#2a0a3a,trim=duration=${d}`;
  }
}
/** Where an uploaded background lives: an R2 key, or (tests) a local path. */
let bgSource = (key: string) => key;
export function setBackgroundSource(fn: (key: string) => string) { bgSource = fn; }
const hashOf = (s: string) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x; };
/** Breaks a headline into balanced lines of at most ~max characters. */
export function wrapHeadline(text: string, max: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const total = words.join(" ").length;
  const n = Math.max(1, Math.ceil(total / max));
  const target = total / n;
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && (next.length > max || (cur.length >= target && lines.length < n - 1))) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

const dt = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");

/**
 * Smoothed crop centre as an FFmpeg expression of t (§6.6 step 5). Keyframes
 * come from the editor's MediaPipe pass (or manual pans), already smoothed;
 * here we only interpolate linearly between them and clamp to the frame.
 */
export function cropXExpr(keys: { t_ms: number; cx: number }[], srcW: number, cropW: number): string {
  const ks = [...keys].filter((k) => Number.isFinite(k.t_ms) && Number.isFinite(k.cx)).sort((a, b) => a.t_ms - b.t_ms);
  const px = (cx: number) => Math.max(0, Math.min(srcW - cropW, cx * srcW - cropW / 2)).toFixed(1);
  if (!ks.length) return px(0.5);
  if (ks.length === 1) return px(ks[0].cx);
  let expr = px(ks[ks.length - 1].cx);
  for (let i = ks.length - 2; i >= 0; i--) {
    const a = ks[i], b = ks[i + 1];
    const t0 = (a.t_ms / 1000).toFixed(3), t1 = (b.t_ms / 1000).toFixed(3);
    const span = Math.max(0.001, (b.t_ms - a.t_ms) / 1000);
    const seg = `${px(a.cx)}+(${px(b.cx)}-${px(a.cx)})*(t-${t0})/${span.toFixed(3)}`;
    expr = `if(lt(t\\,${t1})\\,${seg}\\,${expr})`;
  }
  return `if(lt(t\\,${(ks[0].t_ms / 1000).toFixed(3)})\\,${px(ks[0].cx)}\\,${expr})`;
}

/**
 * `mezzanine` can be a local file or an R2 URL; with `inputArgs` (auth
 * headers) FFmpeg seeks the stored video over HTTP Range and reads only the
 * seconds being cut, instead of downloading the whole source first.
 */
export async function renderFinal(mezzanine: string, spec: RenderSpec, dir: string, out: string, inputArgs: string[] = []): Promise<{ durationMs: number }> {
  const info = await probe(mezzanine, inputArgs);
  const { w, h } = spec.scale;
  const durS = (spec.trim.out_ms - spec.trim.in_ms) / 1000;
  const ss = (spec.trim.in_ms / 1000).toFixed(3);

  // Tightening: what to cut, and where everything lands afterwards (tighten.ts).
  const clipWordsRel = spec.captions.words
    .map((x) => ({ w: x.w, t0: x.t0 - spec.trim.in_ms, t1: x.t1 - spec.trim.in_ms }))
    .filter((x) => x.t1 > 0 && x.t0 < durS * 1000);
  const cuts = spec.tighten ? planCuts(clipWordsRel, durS * 1000) : [];
  const outMs = durS * 1000 - cutTotal(cuts);
  const shown = clipWordsRel
    .filter((x) => !(cuts.length && isFiller(x.w)))
    .map((x) => ({ ...x, t0: mapTime(x.t0, cuts), t1: mapTime(x.t1, cuts) }));
  const asel = cuts.length ? `aselect=${keepExpr(cuts)},asetpts=N/SR/TB,` : "";

  // --- video graph ---
  // Split screen: the speaker fills the top half, the background the bottom.
  // Two-speaker layout takes the whole frame, so it replaces any background.
  const twoUp = spec.crop.mode === "two" && spec.crop.a != null && spec.crop.b != null;
  const bg = !twoUp && spec.background && spec.background.kind !== "none" ? spec.background : null;
  const topH = bg ? Math.round(h / 4) * 2 : h;
  const bgArgs: string[] = [];
  const isGame = bg?.kind === "builtin" && !!GAMES[bg.id];
  let gameSounds: { t: number; s: Sfx }[] = [];
  const logoArgs: string[] = [];
  let sfxFile: string | null = null;
  if (bg?.kind === "builtin" && isGame) {
    // Our own gameplay: simulate, pipe the frames into a quick lossless-ish encode.
    const gameFile = join(dir, "game.mp4"), gfps = Math.min(30, spec.encode.fps);
    await ffmpegFromStdin(
      ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${GAME_W}x${GAME_H}`, "-r", String(gfps), "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "14", "-pix_fmt", "yuv420p", gameFile],
      async (write) => { gameSounds = await renderGame(bg.id, hashOf(spec.trim.in_ms + bg.id), gfps, Math.ceil((durS + 0.5) * gfps), write); },
    );
    bgArgs.push("-i", gameFile);
    // The game's sounds, synthesized, mixed quietly under the speech below.
    if (bg.sound !== false && gameSounds.length) {
      sfxFile = join(dir, "game-sfx.wav");
      await writeFile(sfxFile, synthSfx(gameSounds, durS, hashOf(bg.id + spec.trim.in_ms)));
    }
  } else if (bg?.kind === "builtin") {
    bgArgs.push("-f", "lavfi", "-i", builtinBackground(bg.id, durS, spec.encode.fps));
  } else if (bg?.kind === "upload") {
    // Loop the footage and start somewhere different each export.
    const bgUrl = bgSource(bg.key);
    const bgInfo = await probe(bgUrl, inputArgs).catch(() => null);
    const room = Math.max(0, (bgInfo?.durationMs ?? 0) / 1000 - durS - 1);
    const start = room > 0 ? (hashOf(spec.trim.in_ms + bg.key) % Math.floor(room * 10)) / 10 : 0;
    bgArgs.push("-stream_loop", "-1", "-ss", start.toFixed(1), ...inputArgs, "-i", bgUrl);
  }
  const target = w / topH;
  const filters: string[] = [];
  let v = "[0:v]";
  if (cuts.length) {
    filters.push(`[0:v]select=${keepExpr(cuts)},setpts=N/FRAME_RATE/TB[cut]`);
    v = "[cut]";
  }
  if (twoUp) {
    // Two speakers stacked: the same frame cropped twice, one face per half.
    const half = Math.round(h / 4) * 2, t2 = w / half;
    const cw = Math.floor(Math.min(info.width, info.height * t2) / 2) * 2;
    const ch = Math.floor(Math.min(info.height, cw / t2) / 2) * 2;
    const xAt = (c: number) => Math.round(Math.max(0, Math.min(info.width - cw, c * info.width - cw / 2)));
    const y = Math.floor((info.height - ch) / 2);
    filters.push(`${v}split=2[sa][sb]`);
    filters.push(`[sa]crop=${cw}:${ch}:${xAt(spec.crop.a!)}:${y},scale=${w}:${half}:flags=lanczos,setsar=1[ta]`);
    filters.push(`[sb]crop=${cw}:${ch}:${xAt(spec.crop.b!)}:${y},scale=${w}:${h - half}:flags=lanczos,setsar=1[tb]`);
    filters.push(`[ta][tb]vstack=inputs=2[v0]`);
  } else if (spec.crop.mode === "fit" && !bg) {
    // Letterbox onto a blurred, zoomed copy of itself (§6.6 fallback ladder).
    filters.push(`${v}split=2[bgsrc][fgsrc]`);
    filters.push(`[bgsrc]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2,eq=brightness=-0.08[bg]`);
    filters.push(`[fgsrc]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg]`);
    filters.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]`);
  } else {
    const cropW = Math.floor(Math.min(info.width, info.height * target) / 2) * 2;
    const cropH = Math.floor(Math.min(info.height, cropW / target) / 2) * 2;
    const keys = spec.crop.keyframes.map((k) => ({ ...k, t_ms: mapTime(k.t_ms, cuts) }));
    const x = spec.crop.mode === "path" ? cropXExpr(keys, info.width, cropW) : String(Math.floor((info.width - cropW) / 2));
    filters.push(`${v}crop=${cropW}:${cropH}:${x}:${Math.floor((info.height - cropH) / 2)},scale=${w}:${topH}:flags=lanczos,setsar=1[v0]`);
  }
  v = "[v0]";
  // Punch-ins: an instant ~12 % zoom on punch words and every ~6 s (a cut, not
  // a slow zoom — that's the viral style, and it can't wobble).
  if (spec.zoom && !twoUp && !(spec.crop.mode === "fit" && !bg)) {
    const segs = planZooms(shown, outMs);
    if (segs.length) {
      const zw = Math.round(w / 1.12 / 2) * 2, zh = Math.round(topH / 1.12 / 2) * 2;
      filters.push(`[v0]split=2[za][zb]`);
      filters.push(`[zb]crop=${zw}:${zh}:(in_w-${zw})/2:(in_h-${zh})/2,scale=${w}:${topH}:flags=lanczos,setsar=1[zz]`);
      filters.push(`[za][zz]overlay=0:0:enable=${enableExpr(segs)}[vz]`);
      v = "[vz]";
    }
  }
  if (bg) {
    const bh = h - topH;
    // Games carry their challenge line ("WILL IT ESCAPE?") along the bottom.
    const hookLine = isGame && bg.kind === "builtin" ? GAME_HOOKS[bg.id] : null;
    const label = hookLine && existsSync(join(FONTS_DIR, "Anton-Regular.ttf"))
      ? `,drawtext=fontfile='${join(FONTS_DIR, "Anton-Regular.ttf")}':text='${dt(hookLine)}':fontsize=${Math.round(bh * 0.072)}:fontcolor=white:borderw=${Math.max(3, Math.round(bh * 0.008))}:bordercolor=black:x=(w-text_w)/2:y=h-text_h-${Math.round(bh * 0.05)}`
      : "";
    filters.push(`[1:v]scale=${w}:${bh}:force_original_aspect_ratio=increase:flags=${bg.kind === "builtin" && !isGame ? "neighbor" : "bicubic"},crop=${w}:${bh},setsar=1,fps=${spec.encode.fps}${label}[bgv]`);
    filters.push(`${v}[bgv]vstack=inputs=2:shortest=1[vs]`);
    v = "[vs]";
  }
  let n = 1;
  if (spec.captions.mode === "burn" && shown.length) {
    const rel: CapWord[] = shown;
    const assPath = join(dir, "captions.ass");
    await writeFile(assPath, buildAss(rel, spec.captions.style_id, w, h, { middle: !!bg || twoUp, colors: spec.brand?.colors }));
    filters.push(`${v}subtitles=filename='${assPath}':fontsdir='${FONTS_DIR}'[v${n}]`);
    v = `[v${n++}]`;
  }
  for (const o of spec.overlays ?? []) {
    if (o.type !== "title" || !o.text) continue;
    // The context headline, viral-page style: black text on white boxes, one
    // per line, stacked near the top (top of the speaker half in split screen).
    const [a, b] = o.t_ms;
    const fs = Math.round(w * 0.06), pad = Math.round(fs * 0.3), lineH = fs + pad * 2 + Math.round(fs * 0.12);
    const lines = wrapHeadline(o.text.toUpperCase(), 20).slice(0, 3);
    const ffc = (c: string | undefined, d: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? `0x${c.slice(1)}` : d);
    const headBg = ffc(spec.brand?.colors?.headline_bg, "white"), headText = ffc(spec.brand?.colors?.headline_text, "black");
    const y0 = Math.round(h * (bg || twoUp ? 0.035 : 0.1));
    const when = `enable='between(t,${(a / 1000).toFixed(2)},${(b / 1000).toFixed(2)})'`;
    lines.forEach((line, k) => {
      filters.push(`${v}drawtext=fontfile='${FONT}':text='${dt(line)}':fontsize=${fs}:fontcolor=${headText}:box=1:boxcolor=${headBg}:boxborderw=${pad}:x=(w-text_w)/2:y=${y0 + k * lineH + pad}:${when}[v${n}]`);
      v = `[v${n++}]`;
    });
  }
  // Brand logo in a corner (~14 % of the width).
  if (spec.brand?.logo) {
    const m = spec.brand.logo.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (m) {
      const logoPath = join(dir, `brand-logo.${m[1] === "jpeg" ? "jpg" : m[1]}`);
      await writeFile(logoPath, Buffer.from(m[2], "base64"));
      logoArgs.push("-loop", "1", "-i", logoPath);
      const idx = 1 + bgArgs.filter((a) => a === "-i").length;
      const lw = Math.round(w * 0.14), mg = Math.round(w * 0.04);
      const pos = spec.brand.logo_position ?? "top-right";
      const x = pos.endsWith("left") ? String(mg) : `W-w-${mg}`;
      const y = pos.startsWith("bottom") ? `H-h-${Math.round(h * 0.2)}` : String(Math.round(h * 0.03));
      filters.push(`[${idx}:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=0.92[logo]`);
      filters.push(`${v}[logo]overlay=${x}:${y}:shortest=1[v${n}]`);
      v = `[v${n++}]`;
    }
  }
  if (spec.watermark) {
    // FR-11.6 — applied whenever the Worker says so; the client can't turn it off.
    filters.push(`${v}drawtext=fontfile=${FONT}:text='Made with Clipper':fontsize=${Math.round(w * 0.03)}:fontcolor=white@0.75:shadowcolor=black@0.6:shadowx=2:shadowy=2:x=w-text_w-${Math.round(w * 0.04)}:y=${Math.round(h * 0.04)}[v${n}]`);
    v = `[v${n++}]`;
  }
  filters.push(`${v}fps=${spec.encode.fps},format=yuv420p[vout]`);

  // SPEED: the loudness measurement (pass 1 of loudnorm) and the video encode
  // run at the same time; then a quick mux adds the normalised audio to the
  // already-encoded video (video is stream-copied, only audio is encoded).
  const { target_lufs: I, tp: TP } = spec.audio.loudnorm;
  const base = `loudnorm=I=${I}:TP=${TP}:LRA=11`;
  const measure = (async () => {
    if (!info.hasAudio) return base;
    try {
      const { stderr } = await ffmpeg(["-ss", ss, ...inputArgs, "-i", mezzanine, "-t", durS.toFixed(3), "-vn", "-af", `${asel}${base}:print_format=json`, "-f", "null", "-"]);
      const m = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1));
      if (Number.isFinite(Number(m.input_i)) && Number(m.input_i) > -70) {
        return `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
      }
    } catch { /* single-pass fallback */ }
    return base;
  })();

  const videoOnly = join(dir, "video-only.mp4");
  const [af] = await Promise.all([measure, ffmpeg([
    "-ss", ss, ...inputArgs, "-i", mezzanine, ...bgArgs, ...logoArgs, "-t", durS.toFixed(3),
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-an",
    "-c:v", "libx264", "-crf", String(spec.encode.crf), "-preset", spec.encode.preset, "-profile:v", "high",
    "-g", String(spec.encode.fps * 2), "-pix_fmt", "yuv420p",
    videoOnly,
  ], 20 * 60 * 1000)]);

  await ffmpeg(sfxFile && info.hasAudio ? [
    // Speech (loudness-normalised) + game sounds ~16 dB under it.
    "-i", videoOnly,
    "-ss", ss, ...inputArgs, "-i", mezzanine,
    "-i", sfxFile,
    "-t", durS.toFixed(3),
    "-filter_complex", `[1:a:0]${asel}${af},aresample=48000[sp];[2:a]aresample=48000,volume=0.16[fx];[sp][fx]amix=inputs=2:duration=first:normalize=0[a]`,
    "-map", "0:v:0", "-map", "[a]", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-movflags", "+faststart", out,
  ] : [
    "-i", videoOnly,
    "-ss", ss, ...inputArgs, "-i", mezzanine,
    "-t", durS.toFixed(3),
    "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy",
    "-af", `${asel}${af},aresample=48000`, "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-movflags", "+faststart", out,
  ], 10 * 60 * 1000);
  return { durationMs: Math.round(outMs) };
}
