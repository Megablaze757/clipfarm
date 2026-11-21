import type { Sfx } from "./games";

/**
 * GAME SOUNDS — synthesized from scratch (sine tones, noise, envelopes), so
 * there are no sound files to license. The viral simulations live on these:
 * a tick on every bounce, a pop when a ring shatters. Mixed well UNDER the
 * speech at export (render.ts), never over it.
 *
 * Returns a mono 48 kHz 16-bit WAV.
 */
const RATE = 48_000;

function voice(kind: Sfx["kind"], p: number, rand: () => number): Float32Array {
  const len = (s: number) => new Float32Array(Math.round(RATE * s));
  const env = (i: number, n: number, attack = 0.004, curve = 5) => {
    const t = i / RATE;
    return Math.min(1, t / attack) * Math.exp((-curve * i) / n);
  };
  switch (kind) {
    case "bounce": { // soft marimba-ish tick; pitch from the hint
      const f = 520 + 700 * p, out = len(0.09);
      for (let i = 0; i < out.length; i++) out[i] = (Math.sin(2 * Math.PI * f * (i / RATE)) * 0.8 + Math.sin(4 * Math.PI * f * (i / RATE)) * 0.2) * env(i, out.length, 0.002, 6);
      return out;
    }
    case "tick": { // tiny plinko peg
      const f = 1400 + 900 * p, out = len(0.035);
      for (let i = 0; i < out.length; i++) out[i] = Math.sin(2 * Math.PI * f * (i / RATE)) * env(i, out.length, 0.001, 7) * 0.6;
      return out;
    }
    case "pop": { // shatter: noise burst + falling thump
      const out = len(0.28);
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE, thump = Math.sin(2 * Math.PI * (180 - 260 * t) * t);
        out[i] = ((rand() * 2 - 1) * 0.55 * Math.exp(-28 * t) + thump * 0.7 * Math.exp(-9 * t)) * Math.min(1, t / 0.002);
      }
      return out;
    }
    case "coin": { // two-note ding
      const out = len(0.22);
      for (let i = 0; i < out.length; i++) {
        const t = i / RATE, f = t < 0.06 ? 988 : 1319;
        out[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-7 * t) * 0.7;
      }
      return out;
    }
    case "jump": { // rising whoosh
      const out = len(0.14);
      for (let i = 0; i < out.length; i++) { const t = i / RATE; out[i] = Math.sin(2 * Math.PI * (300 + 2200 * t) * t) * env(i, out.length, 0.01, 3) * 0.45; }
      return out;
    }
    case "thud": { // block lands
      const out = len(0.12), f = 140 + 160 * p;
      for (let i = 0; i < out.length; i++) { const t = i / RATE; out[i] = (Math.sin(2 * Math.PI * f * t) * 0.8 + (rand() * 2 - 1) * 0.15) * Math.exp(-30 * t); }
      return out;
    }
    case "chime": { // perfect stack: bright triad
      const out = len(0.45), f = 660 + 330 * p;
      for (let i = 0; i < out.length; i++) { const t = i / RATE; out[i] = (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 1.25 * t) * 0.6 + Math.sin(2 * Math.PI * f * 1.5 * t) * 0.5) * Math.exp(-5 * t) * 0.4; }
      return out;
    }
    case "crash": default: {
      const out = len(0.4);
      for (let i = 0; i < out.length; i++) { const t = i / RATE; out[i] = ((rand() * 2 - 1) * Math.exp(-8 * t) + Math.sin(2 * Math.PI * 90 * t) * Math.exp(-6 * t)) * 0.6; }
      return out;
    }
  }
}

/**
 * Lays the sounds on a timeline. Busy games (many balls) are thinned to at
 * most ~14 sounds a second so it stays a pleasant patter, not noise.
 */
export function synthSfx(sounds: { t: number; s: Sfx }[], durationS: number, seed = 1): Buffer {
  let r = seed >>> 0 || 1;
  const rand = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
  const mix = new Float32Array(Math.ceil((durationS + 0.5) * RATE));
  let lastT = -1, inWindow = 0;
  for (const { t, s } of sounds) {
    if (t > durationS) break;
    if (Math.floor(t * 4) !== Math.floor(lastT * 4)) inWindow = 0; // per 250 ms window
    lastT = t;
    const important = s.kind === "pop" || s.kind === "chime" || s.kind === "crash" || s.kind === "coin";
    if (!important && ++inWindow > 3) continue;
    const v = voice(s.kind, Math.max(0, Math.min(1, s.p ?? 0.5)), rand);
    const at = Math.round(t * RATE);
    for (let i = 0; i < v.length && at + i < mix.length; i++) mix[at + i] += v[i];
  }
  // Soft limiter, then 16-bit PCM.
  const pcm = Buffer.alloc(44 + mix.length * 2);
  for (let i = 0; i < mix.length; i++) pcm.writeInt16LE(Math.round(Math.tanh(mix[i] * 0.9) * 30000), 44 + i * 2);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + mix.length * 2, 4); pcm.write("WAVE", 8); pcm.write("fmt ", 12);
  pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(mix.length * 2, 40);
  return pcm;
}
