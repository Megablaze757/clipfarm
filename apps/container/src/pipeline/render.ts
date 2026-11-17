import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, probe } from "../lib/proc";
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
  crop: { mode: "center" | "path" | "fit"; keyframes: { t_ms: number; cx: number }[] };
  scale: { w: number; h: number };
  captions: { mode: "burn" | "none"; style_id: string; words: { w: string; t0: number; t1: number }[] };
  overlays: { type: "title"; text: string; t_ms: [number, number] }[];
  /** Split screen: speaker on top, this footage below (absent/none = full frame). */
  background?: { kind: "none" } | { kind: "builtin"; id: string } | { kind: "upload"; key: string };
  watermark: boolean;
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
      return `life=s=135x120:mold=20:rate=${fps}:ratio=0.18:death_color=#140026:life_color=#00f0ff:mold_color=#ff2d95,trim=duration=${d}`;
  }
}
/** Where an uploaded background lives: an R2 key, or (tests) a local path. */
let bgSource = (key: string) => key;
export function setBackgroundSource(fn: (key: string) => string) { bgSource = fn; }
const hashOf = (s: string) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x; };
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

  // --- video graph ---
  // Split screen: the speaker fills the top half, the background the bottom.
  const bg = spec.background && spec.background.kind !== "none" ? spec.background : null;
  const topH = bg ? Math.round(h / 4) * 2 : h;
  const bgArgs: string[] = [];
  if (bg?.kind === "builtin") {
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
  if (spec.crop.mode === "fit" && !bg) {
    // Letterbox onto a blurred, zoomed copy of itself (§6.6 fallback ladder).
    filters.push(`${v}split=2[bgsrc][fgsrc]`);
    filters.push(`[bgsrc]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2,eq=brightness=-0.08[bg]`);
    filters.push(`[fgsrc]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg]`);
    filters.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]`);
  } else {
    const cropW = Math.floor(Math.min(info.width, info.height * target) / 2) * 2;
    const cropH = Math.floor(Math.min(info.height, cropW / target) / 2) * 2;
    const x = spec.crop.mode === "path" ? cropXExpr(spec.crop.keyframes, info.width, cropW) : String(Math.floor((info.width - cropW) / 2));
    filters.push(`${v}crop=${cropW}:${cropH}:${x}:${Math.floor((info.height - cropH) / 2)},scale=${w}:${topH}:flags=lanczos,setsar=1[v0]`);
  }
  v = "[v0]";
  if (bg) {
    const bh = h - topH;
    filters.push(`[1:v]scale=${w}:${bh}:force_original_aspect_ratio=increase:flags=${bg.kind === "builtin" ? "neighbor" : "bicubic"},crop=${w}:${bh},setsar=1,fps=${spec.encode.fps}[bgv]`);
    filters.push(`[v0][bgv]vstack=inputs=2:shortest=1[vs]`);
    v = "[vs]";
  }
  let n = 1;
  if (spec.captions.mode === "burn" && spec.captions.words.length) {
    const rel: CapWord[] = spec.captions.words
      .map((x) => ({ w: x.w, t0: x.t0 - spec.trim.in_ms, t1: x.t1 - spec.trim.in_ms }))
      .filter((x) => x.t1 > 0 && x.t0 < durS * 1000);
    const assPath = join(dir, "captions.ass");
    await writeFile(assPath, buildAss(rel, spec.captions.style_id, w, h, { middle: !!bg }));
    filters.push(`${v}subtitles=filename='${assPath}':fontsdir='${FONTS_DIR}'[v${n}]`);
    v = `[v${n++}]`;
  }
  for (const o of spec.overlays ?? []) {
    if (o.type !== "title" || !o.text) continue;
    const [a, b] = o.t_ms;
    filters.push(`${v}drawtext=fontfile=${FONT}:text='${dt(o.text)}':fontsize=${Math.round(w * 0.058)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round(w * 0.02)}:x=(w-text_w)/2:y=h*0.12:enable='between(t,${a / 1000},${b / 1000})'[v${n}]`);
    v = `[v${n++}]`;
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
      const { stderr } = await ffmpeg(["-ss", ss, ...inputArgs, "-i", mezzanine, "-t", durS.toFixed(3), "-vn", "-af", `${base}:print_format=json`, "-f", "null", "-"]);
      const m = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1));
      if (Number.isFinite(Number(m.input_i)) && Number(m.input_i) > -70) {
        return `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
      }
    } catch { /* single-pass fallback */ }
    return base;
  })();

  const videoOnly = join(dir, "video-only.mp4");
  const [af] = await Promise.all([measure, ffmpeg([
    "-ss", ss, ...inputArgs, "-i", mezzanine, ...bgArgs, "-t", durS.toFixed(3),
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-an",
    "-c:v", "libx264", "-crf", String(spec.encode.crf), "-preset", spec.encode.preset, "-profile:v", "high",
    "-g", String(spec.encode.fps * 2), "-pix_fmt", "yuv420p",
    videoOnly,
  ], 20 * 60 * 1000)]);

  await ffmpeg([
    "-i", videoOnly,
    "-ss", ss, ...inputArgs, "-i", mezzanine,
    "-t", durS.toFixed(3),
    "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "copy",
    "-af", `${af},aresample=48000`, "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-movflags", "+faststart", out,
  ], 10 * 60 * 1000);
  return { durationMs: Math.round(durS * 1000) };
}
