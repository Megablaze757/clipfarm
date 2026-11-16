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
