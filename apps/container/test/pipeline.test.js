// Unit tests for the pure pipeline stages (§20.1). Run with `npm test` (builds first).
const test = require("node:test");
const assert = require("node:assert/strict");
const { sentences } = require("../dist/pipeline/text");
const { generateWindows, rejectReason, targetCount } = require("../dist/pipeline/candidates");
const { heuristicScore, selectMMR, selfContainedness } = require("../dist/pipeline/scoring");
const { snapBoundaries } = require("../dist/pipeline/boundaries");
const { breakLines, buildAss } = require("../dist/pipeline/captions");
const { cropXExpr } = require("../dist/pipeline/render");
const { isPrivateAddress } = require("../dist/pipeline/ingest");
const { alignPunctuation } = require("../dist/pipeline/asr");

/** Builds a word list from text at ~3 words/s with a pause after each sentence. */
function words(text, speaker = "A") {
  let t = 1000;
  return text.split(/\s+/).map((w) => {
    const word = { w, t0: t, t1: t + 280, conf: 0.95, speaker };
    t += /[.?!]$/.test(w) ? 900 : 330;
    return word;
  });
}

const SAMPLE = Array.from({ length: 30 }, (_, i) =>
  i % 3 === 0 ? `Why do most founders get pricing wrong in year ${i + 1}?` :
  i % 3 === 1 ? "The reason is simple because they never test it with real customers first." :
  "So the lesson is to charge more than feels comfortable and watch what happens.").join(" ");
const W = words(SAMPLE);
const ENV = new Float32Array(Math.ceil(W[W.length - 1].t1 / 100) + 10).fill(0.5);

test("sentences split on terminal punctuation", () => {
  const s = sentences(W);
  assert.equal(s.length, 30);
  assert.ok(/\?$/.test(W[s[0].i1].w));
});

test("windows start on sentence starts and never on a conjunction", () => {
  const ws = generateWindows(W, sentences(W), "auto", 500);
  assert.ok(ws.length > 0);
  for (const w of ws) {
    assert.ok(w.i0 === 0 || /[.?!]$/.test(W[w.i0 - 1].w), "starts at sentence start");
    assert.notEqual(W[w.i0].w.toLowerCase(), "so");
    const d = w.t1 - w.t0;
    assert.ok(d >= 15000 && d <= 90000);
  }
});

test("rejects unresolved pronoun openers", () => {
  const ws = words("He said the deal was off and nobody knew why it happened at all that day.");
  assert.equal(rejectReason(ws, { i0: 0, i1: ws.length - 1 }), "unresolved_pronoun");
});

test("self-containedness names the word that broke it", () => {
  const ws = words("They told me this would never work. Sarah disagreed with them completely.");
  const r = selfContainedness(ws, { i0: 0, i1: ws.length - 1, t0: ws[0].t0, t1: ws[ws.length - 1].t1 });
  assert.equal(r.unresolved, "they");
  assert.ok(r.score < 1);
});

test("MMR never selects two candidates overlapping ≥70%", () => {
  const ws = generateWindows(W, sentences(W), "auto", 500);
  const scored = ws.map((w) => heuristicScore(W, ENV, w, 3));
  const picked = selectMMR(scored, 10);
  for (let i = 0; i < picked.length; i++) for (let j = i + 1; j < picked.length; j++) {
    const a = picked[i], b = picked[j];
    const inter = Math.max(0, Math.min(a.t_out_ms, b.t_out_ms) - Math.max(a.t_in_ms, b.t_in_ms));
    assert.ok(inter / Math.min(a.t_out_ms - a.t_in_ms, b.t_out_ms - b.t_in_ms) < 0.7);
  }
  assert.ok(picked.every((c) => c.score >= 0 && c.score <= 100));
});

test("snapped boundaries never cut inside a word and respect 8–180 s", () => {
  const ws = generateWindows(W, sentences(W), "auto", 500);
  const snapped = snapBoundaries(selectMMR(ws.map((w) => heuristicScore(W, ENV, w, 3)), 8), W, ENV);
  for (const c of snapped) {
    for (const w of W) {
      assert.ok(!(c.t_in_ms > w.t0 && c.t_in_ms < w.t1), "in-point inside a word");
      assert.ok(!(c.t_out_ms > w.t0 && c.t_out_ms < w.t1), "out-point inside a word");
    }
    assert.ok(c.t_out_ms - c.t_in_ms >= 8000 && c.t_out_ms - c.t_in_ms <= 180000);
  }
});

test("target count scales with duration and respects caps", () => {
  assert.equal(targetCount(60 * 60_000, null, null), 15);
  assert.equal(targetCount(60 * 60_000, 3, null), 3);
  assert.equal(targetCount(10 * 60_000, null, null), 3);
});

test("caption lines: ≤5 words, ≤32 chars-ish, no orphan articles", () => {
  const ws = words("This is the best way to think about the future of the whole industry right now okay.");
  const lines = breakLines(ws);
  for (const l of lines) {
    assert.ok(l.words.length <= 5);
    const last = l.words[l.words.length - 1].w.toLowerCase();
    assert.ok(!["the", "a", "an", "of", "to"].includes(last), `orphan "${last}"`);
  }
  for (let i = 0; i + 1 < lines.length; i++) assert.ok(lines[i].t1 <= lines[i + 1].t0);
  assert.match(buildAss(ws, "karaoke_yellow", 1080, 1920), /Dialogue: 0,/);
});

test("crop path expression clamps to the frame", () => {
  const e = cropXExpr([{ t_ms: 0, cx: 0 }, { t_ms: 5000, cx: 1 }], 1920, 608);
  assert.match(e, /^if\(lt\(t/);
  assert.ok(e.includes("1312.0") && !e.includes("-304"), "clamped to [0, srcW - cropW]");
  assert.equal(cropXExpr([], 1920, 608), "656.0");
});

test("SSRF guard flags private addresses", () => {
  for (const ip of ["10.0.0.1", "127.0.0.1", "192.168.1.5", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.1.1.1"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
});

test("punctuation from segment text is copied onto words", () => {
  const out = alignPunctuation(
    [{ word: "hello", start: 0, end: 0.3 }, { word: "world", start: 0.3, end: 0.6 }, { word: "how", start: 1, end: 1.2 }, { word: "are", start: 1.2, end: 1.3 }, { word: "you", start: 1.3, end: 1.5 }],
    [{ id: 0, start: 0, end: 0.6, text: " Hello, world." }, { id: 1, start: 1, end: 1.5, text: " How are you?" }]);
  assert.deepEqual(out, ["Hello,", "world.", "How", "are", "you?"]);
});

test("working copy is a stream copy only for safe H.264/AAC sources", () => {
  const { canStreamCopy } = require("../dist/pipeline/transcode");
  const base = { durationMs: 1, hasVideo: true, hasAudio: true, width: 1920, height: 1080, fps: 30, rotation: 0, vcodec: "h264", acodec: "aac", pixFmt: "yuv420p" };
  assert.equal(canStreamCopy(base), true);
  assert.equal(canStreamCopy({ ...base, vcodec: "vp9" }), false);
  assert.equal(canStreamCopy({ ...base, acodec: "opus" }), false);
  assert.equal(canStreamCopy({ ...base, height: 2160, width: 3840 }), false);
  assert.equal(canStreamCopy({ ...base, rotation: 90 }), false);
  assert.equal(canStreamCopy({ ...base, pixFmt: "yuv420p10le" }), false);
  assert.equal(canStreamCopy({ ...base, hasVideo: false }), false);
});

test("reactions: loud non-speech gaps are detected, quiet ones aren't", () => {
  const { reactionEvents } = require("../dist/pipeline/scoring");
  const ws = [{ w: "joke.", t0: 0, t1: 1000, conf: 1, speaker: "A" }, { w: "next", t0: 3000, t1: 3300, conf: 1, speaker: "A" },
              { w: "quiet", t0: 6000, t1: 6300, conf: 1, speaker: "A" }];
  const env = new Float32Array(80).fill(0.2);
  for (let f = 12; f < 25; f++) env[f] = 1;       // laughter between 1.2 s and 2.5 s
  const ev = reactionEvents(ws, env);
  assert.equal(ev.length, 1);
  assert.ok(ev[0] >= 1100 && ev[0] <= 2500);
});

test("v2 heuristics reward a closed curiosity gap, emotion and a reaction at the payoff", () => {
  const { heuristicScore } = require("../dist/pipeline/scoring");
  const flat = words("We met on a Tuesday. The office was fine. We had some coffee and talked for a while. Then we went home. It was a normal day really.");
  const hot = words("Why do most founders fail? Nobody tells you this. The reason is insane, honestly. Turns out they never ask customers. That is the secret!");
  const env = new Float32Array(400).fill(0.3);
  const w = (ws) => ({ i0: 0, i1: ws.length - 1, t0: ws[0].t0, t1: ws[ws.length - 1].t1 });
  const a = heuristicScore(flat, env, w(flat), 3, []);
  const b = heuristicScore(hot, env, w(hot), 3, [hot[hot.length - 1].t1 + 500]);
  for (const k of ["structure", "emotion", "shareability", "reaction"]) assert.ok(b.subscores[k] > a.subscores[k], k);
  assert.ok(b.score > a.score);
  assert.ok(b.features.badges.length <= 3);
});

test("nomination pass keeps valid moments and drops out-of-range or too-short ones", async () => {
  const worker = require("../dist/lib/worker");
  const { nominateMoments } = require("../dist/pipeline/moments");
  const s = sentences(W);
  const real = worker.llm;
  worker.llm = async () => ({ model: "stub", text: JSON.stringify({ moments: [
    { start: 0, end: 5, category: "hot_take", hook: "Why do most founders get pricing wrong", why: "bold question, answered" },
    { start: 2, end: 2, category: "funny" },      // too short (< 8 s)
    { start: 0, end: 9999, category: "story" },   // out of range
  ] }) });
  try {
    const out = await nominateMoments(W, s);
    assert.equal(out.length, 1);
    assert.equal(out[0].category, "hot_take");
  } finally { worker.llm = real; }
});

test("judge blends 0-10 scores and trims a slow lead-in", async () => {
  const worker = require("../dist/lib/worker");
  const { refineWithLLM } = require("../dist/pipeline/llm-scoring");
  const { heuristicScore } = require("../dist/pipeline/scoring");
  const ws = generateWindows(W, sentences(W), "auto", 500);
  const c = heuristicScore(W, ENV, ws[0], 3, []);
  const before = { i0: c.i0, hook: c.subscores.hook };
  const real = worker.llm;
  worker.llm = async () => ({ model: "stub", text: JSON.stringify({ clips: [{ id: 0, hook: 10, payoff: 9, emotion: 8, shareability: 9, self_contained: 9, complete: 9, category: "hot_take", title: "Founders get pricing wrong", trim_start_words: 3, trim_end_words: 0, rationale: "bold claim answered fast" }] }) });
  try {
    const r = await refineWithLLM([c], W);
    assert.equal(r.refined, 1);
    assert.ok(c.subscores.hook > before.hook);
    assert.equal(c.i0, before.i0 + 3);
    assert.equal(c.features.category, "hot_take");
    assert.equal(c.features.title, "Founders get pricing wrong");
  } finally { worker.llm = real; }
});

test("judge re-asks for skipped clips, and unreviewed clips rank below reviewed ones", async () => {
  const worker = require("../dist/lib/worker");
  const { refineWithLLM } = require("../dist/pipeline/llm-scoring");
  const { heuristicScore, selectMMR } = require("../dist/pipeline/scoring");
  const ws = generateWindows(W, sentences(W), "auto", 500);
  const cands = ws.filter((_, i) => i % 7 === 0).slice(0, 14).map((w) => heuristicScore(W, ENV, w, 3, []));
  let calls = 0;
  const real = worker.llm;
  // First call judges only id 0 (like the live run); later calls judge everything they get except one.
  worker.llm = async (_s, user) => {
    calls++;
    const ids = [...user.matchAll(/### id (\d+)/g)].map((m) => Number(m[1]));
    const judged = calls === 1 ? [0] : ids.slice(1);
    return { model: "stub", text: JSON.stringify({ clips: judged.map((id) => ({ id, hook: 3, payoff: 3, emotion: 3, shareability: 3, self_contained: 5, complete: 5, title: "t", rationale: "r" })) }) };
  };
  try {
    await refineWithLLM(cands, W);
    assert.ok(calls >= 3, "skipped clips were asked again");
    const reviewed = cands.filter((c) => c.features.scorer === "llm");
    const unreviewed = cands.filter((c) => c.features.scorer !== "llm");
    assert.ok(reviewed.length > 1 && unreviewed.length >= 1);
    for (const u of unreviewed) assert.equal(u.features.score_factor, 0.85);
    selectMMR(cands, cands.length);
    // The penalty survives MMR's re-scoring.
    for (const u of unreviewed) assert.ok(Math.abs(u.score - Math.round(require("../dist/pipeline/scoring").composite(u.subscores) * 0.85 * 100) / 100) < 0.01);
  } finally { worker.llm = real; }
});

test("link download errors get a clear, honest message", () => {
  const { classifyYtDlpError } = require("../dist/pipeline/ingest");
  const blocked = classifyYtDlpError("ERROR: [youtube] x: Sign in to confirm you’re not a bot");
  assert.equal(blocked.code, "E_SOURCE_BLOCKED");
  assert.match(blocked.message, /upload the file/);
  assert.equal(classifyYtDlpError("ERROR: [youtube] x: Private video. Sign in if you've been granted access").code, "E_SOURCE_PRIVATE");
  assert.equal(classifyYtDlpError("ERROR: The uploader has not made this video available in your country").code, "E_SOURCE_GEO_BLOCKED");
  assert.equal(classifyYtDlpError("ERROR: Video unavailable").code, "E_SOURCE_PRIVATE");
});
