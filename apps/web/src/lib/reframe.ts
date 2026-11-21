/**
 * Auto-reframe (§6.6) with MediaPipe face detection, running in the browser on
 * the low-res review proxy — no GPU server needed, and it costs nothing per clip.
 *
 * 1. sample a frame every 0.5 s and detect faces;
 * 2. per speaker turn (from the transcript), aim at the biggest face on screen;
 * 3. smooth: EMA across turns, moves only in the pause at a turn change, never
 *    during a word;
 * 4. jitter guard: if the subject barely moves, lock a static crop;
 * 5. fallback ladder: no faces → centre crop (or letterbox "fit" for wide shots).
 *
 * Output keyframes are clip-relative ({t_ms, cx}) — the render Container turns
 * them into an FFmpeg crop expression.
 */
export interface Keyframe { t_ms: number; cx: number }
export interface ReframeResult { mode: 'manual' | 'center' | 'fit'; keyframes: Keyframe[]; facesFound: number; samples: number; note: string }
interface Word { w: string; t0: number; t1: number; speaker?: string }

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

let detectorPromise: Promise<any> | null = null
async function detector() {
  detectorPromise ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision')
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM)
    return vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    })
  })()
  return detectorPromise
}

const seek = (v: HTMLVideoElement, t: number) => new Promise<void>((resolve) => {
  const done = () => { v.removeEventListener('seeked', done); resolve() }
  v.addEventListener('seeked', done)
  v.currentTime = t
  setTimeout(done, 3000)
})

function turns(words: Word[], inMs: number, outMs: number): { t0: number; t1: number }[] {
  const ws = words.filter((w) => w.t1 > inMs && w.t0 < outMs)
  const out: { t0: number; t1: number; speaker?: string }[] = []
  for (const w of ws) {
    const last = out[out.length - 1]
    if (last && last.speaker === w.speaker) last.t1 = w.t1
    else out.push({ t0: last ? Math.round((last.t1 + w.t0) / 2) : inMs, t1: w.t1, speaker: w.speaker })
  }
  if (!out.length) return [{ t0: inMs, t1: outMs }]
  out[out.length - 1].t1 = outMs
  // Merge turns shorter than 2 s into their neighbour: cutting the crop for a "yeah" looks broken.
  return out.reduce<{ t0: number; t1: number }[]>((acc, t) => {
    if (acc.length && t.t1 - t.t0 < 2000) acc[acc.length - 1].t1 = t.t1
    else acc.push({ t0: t.t0, t1: t.t1 })
    return acc
  }, [])
}

export async function autoReframe(
  video: HTMLVideoElement, inMs: number, outMs: number, words: Word[], targetAspect: number,
  onProgress?: (f: number) => void,
  /** Where the video starts in source time (per-clip previews start before the clip). */
  videoOffsetMs = 0,
): Promise<ReframeResult> {
  const det = await detector()
  const wasPaused = video.paused
  video.pause()
  const step = 500
  const samples: { t: number; cx: number | null; area: number }[] = []
  let ts = performance.now()
  for (let t = inMs; t < outMs; t += step) {
    await seek(video, Math.max(0, (t - videoOffsetMs) / 1000))
    ts = Math.max(ts + 1, performance.now())
    const res = det.detectForVideo(video, ts)
    const faces = (res?.detections ?? []).map((d: any) => d.boundingBox).filter(Boolean)
    if (faces.length) {
      const biggest = faces.reduce((a: any, b: any) => (b.width * b.height > a.width * a.height ? b : a))
      samples.push({ t, cx: (biggest.originX + biggest.width / 2) / video.videoWidth, area: (biggest.width * biggest.height) / (video.videoWidth * video.videoHeight) })
    } else samples.push({ t, cx: null, area: 0 })
    onProgress?.((t - inMs) / (outMs - inMs))
  }
  if (wasPaused) video.pause()
  const found = samples.filter((s) => s.cx != null)
  const srcAspect = video.videoWidth / Math.max(1, video.videoHeight)

  if (found.length < samples.length * 0.4) {
    // Fallback ladder: wide landscape with nobody to follow → letterbox, else centre.
    const mode = srcAspect > 1.5 && targetAspect < 1 ? 'fit' : 'center'
    return { mode, keyframes: [], facesFound: found.length, samples: samples.length, note: mode === 'fit' ? 'No faces found — letterboxed with a blurred background.' : 'No faces found — using a centre crop.' }
  }

  // Target per turn = median face centre during that turn.
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  const perTurn = turns(words, inMs, outMs).map((turn) => {
    const xs = found.filter((s) => s.t >= turn.t0 && s.t < turn.t1).map((s) => s.cx as number)
    return { ...turn, cx: xs.length ? median(xs) : null }
  })
  // Start ON the first speaker (not blended toward the clip's average), then EMA.
  let prev = perTurn.find((t) => t.cx != null)?.cx ?? median(found.map((s) => s.cx as number))
  const smoothed = perTurn.map((t) => {
    const target = t.cx ?? prev
    prev = prev + 0.7 * (target - prev) // EMA, mostly follows the new speaker
    return { ...t, cx: prev }
  })

  // Jitter guard: if the subject barely moves, a static crop beats a wobbling one.
  const xs = smoothed.map((t) => t.cx)
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
  if (sd < 0.03 || smoothed.length === 1) {
    return { mode: 'manual', keyframes: [{ t_ms: 0, cx: round(mean) }], facesFound: found.length, samples: samples.length, note: 'Subject is steady — locked a static crop on them.' }
  }

  // Hold each turn's position, then pan over 400 ms in the gap at the turn change.
  const keyframes: Keyframe[] = []
  smoothed.forEach((t, i) => {
    const start = Math.max(0, t.t0 - inMs)
    if (i === 0) keyframes.push({ t_ms: 0, cx: round(t.cx) })
    else {
      keyframes.push({ t_ms: Math.max(0, start - 200), cx: round(smoothed[i - 1].cx) })
      keyframes.push({ t_ms: start + 200, cx: round(t.cx) })
    }
  })
  return { mode: 'manual', keyframes: keyframes.slice(0, 60), facesFound: found.length, samples: samples.length, note: `Following the speaker across ${smoothed.length} turns.` }
}

const round = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000

/** Crop centre at clip-relative time t — mirrors the render's linear interpolation for the live preview. */
export function cxAt(keys: Keyframe[], t: number): number {
  if (!keys.length) return 0.5
  if (t <= keys[0].t_ms) return keys[0].cx
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i], b = keys[i + 1]
    if (t < b.t_ms) return a.cx + (b.cx - a.cx) * ((t - a.t_ms) / Math.max(1, b.t_ms - a.t_ms))
  }
  return keys[keys.length - 1].cx
}
