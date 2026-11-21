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

test("snapped boundaries never cut inside a word and respect 15–180 s", () => {
  const ws = generateWindows(W, sentences(W), "auto", 500);
  const snapped = snapBoundaries(selectMMR(ws.map((w) => heuristicScore(W, ENV, w, 3)), 8), W, ENV);
  for (const c of snapped) {
    for (const w of W) {
      assert.ok(!(c.t_in_ms > w.t0 && c.t_in_ms < w.t1), "in-point inside a word");
      assert.ok(!(c.t_out_ms > w.t0 && c.t_out_ms < w.t1), "out-point inside a word");
    }
    assert.ok(c.t_out_ms - c.t_in_ms >= 15000 && c.t_out_ms - c.t_in_ms <= 180000);
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

test("clips never open on But / So / Um / I mean", () => {
  const { skipOpeners, snapBoundaries } = require("../dist/pipeline/boundaries");
  const ws = words("But look, I mean the real reason we failed was pricing. We charged too little for years and never noticed. Then a customer told us straight. Everything changed after that call. It was the best feedback we ever got.");
  assert.equal(ws[skipOpeners(ws, 0, ws.length - 1)].w, "the");
  const env = new Float32Array(400).fill(0.3);
  const [c] = snapBoundaries([{ i0: 0, i1: ws.length - 1, t_in_ms: ws[0].t0, t_out_ms: ws[ws.length - 1].t1, text: "", subscores: {}, score: 50, features: { badges: [], signals: [] }, rationale: "" }], ws, env);
  assert.notEqual(ws[c.i0].w.toLowerCase().replace(/[^a-z]/g, ""), "but");
  assert.ok(!["but", "look", "i", "so", "um"].includes(ws[c.i0].w.toLowerCase().replace(/[^a-z]/g, "")));
});

test("short moments are extended by whole sentences to at least 15 s", () => {
  const { extendToMin, MIN_CLIP_MS } = require("../dist/pipeline/boundaries");
  const s = sentences(W);
  // One sentence (~4 s) — too short on its own.
  const [i0, i1] = extendToMin(W, s[3].i0, s[3].i1);
  const dur = W[i1].t1 - W[i0].t0;
  assert.ok(dur >= MIN_CLIP_MS, `${dur} ms`);
  assert.ok(dur <= 35000);
  assert.ok(/[.?!]$/.test(W[i1].w), "ends on a sentence end");
  assert.ok(i0 === 0 || /[.?!]$/.test(W[i0 - 1].w), "starts on a sentence start");
});

test("background games: web copy matches, every game runs a minute cleanly and fast", async () => {
  const fs = require("node:fs"), path = require("node:path");
  const a = fs.readFileSync(path.join(__dirname, "../src/pipeline/games.ts"), "utf8");
  const b = fs.readFileSync(path.join(__dirname, "../../web/src/lib/games.ts"), "utf8");
  assert.equal(a, b, "apps/web/src/lib/games.ts must be a copy of apps/container/src/pipeline/games.ts");
  const { GAMES, GAME_W, GAME_H, renderGame } = require("../dist/pipeline/games");
  for (const id of Object.keys(GAMES)) {
    let frames = 0, lit = 0;
    const t0 = Date.now();
    await renderGame(id, 12345, 30, 30 * 60, (buf) => {
      assert.equal(buf.length, GAME_W * GAME_H * 3);
      if (++frames % 300 === 0) { let s = 0; for (let i = 0; i < buf.length; i += 97) s += buf[i]; lit += s > 0 ? 1 : 0; }
    });
    const ms = Date.now() - t0;
    assert.equal(frames, 1800, id);
    assert.ok(lit >= 5, `${id} draws something`);
    assert.ok(ms < 60_000, `${id} renders a minute in under real time (${ms} ms)`);
    console.log(`  ${id}: 60 s of footage in ${(ms / 1000).toFixed(1)} s`);
  }
});

test("chat: parses common chat-log formats", () => {
  const { parseChat } = require("../dist/pipeline/chat");
  const td = JSON.stringify({ comments: [{ content_offset_seconds: 12.5, message: { body: "KEKW" } }, { content_offset_seconds: 3, message: { body: "hi" } }] });
  assert.deepEqual(parseChat(td).map((m) => [m.t, m.text]), [[3000, "hi"], [12500, "KEKW"]]);
  const cd = JSON.stringify([{ time_in_seconds: 61, message: "W" }]);
  assert.deepEqual(parseChat(cd).map((m) => m.t), [61000]);
  const yt = JSON.stringify({ replayChatItemAction: { videoOffsetTimeMsec: "4200", actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text: "no way" }] } } } } }] } });
  assert.deepEqual(parseChat(yt + "\n" + yt).map((m) => [m.t, m.text]), [[4200, "no way"], [4200, "no way"]]);
  const txt = "[1:02:03] alice: LMAO\n00:00:05 bob: hello there\n12.5,carol,POG";
  assert.deepEqual(parseChat(txt).map((m) => m.t), [5000, 12500, 3723000]);
});

test("chat: finds a burst against the stream's own baseline and boosts that clip", () => {
  const { chatSpikes, chatSpikeIn } = require("../dist/pipeline/chat");
  const { heuristicScore } = require("../dist/pipeline/scoring");
  const msgs = [];
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 1_800_000; t += 400 + r() * 1600) msgs.push({ t, text: ["hi", "true", "what game is this", "lol", "nice"][Math.floor(r() * 5)] });
  for (let k = 0; k < 160; k++) msgs.push({ t: 905_000 + r() * 6000, text: k % 3 ? "KEKW" : "LMAOOO" }); // something funny at ~15:00
  msgs.sort((a, b) => a.t - b.t);
  const sig = chatSpikes(msgs, 1_800_000);
  assert.ok(sig.spikes.length >= 1);
  const top = [...sig.spikes].sort((a, b) => b.z - a.z)[0];
  assert.equal(top.kind, "laugh");
  assert.ok(Math.abs(top.peak - 911_000) < 4000, `peak ${top.peak}`);
  assert.ok(top.t < top.peak && top.peak - top.t <= 10_000);
  assert.ok(chatSpikeIn(sig, 880_000, 910_000));
  assert.equal(chatSpikeIn(sig, 100_000, 130_000), null);
  // The same words score higher with the chat spike than without.
  const words = []; for (let i = 0; i < 80; i++) words.push({ w: i % 10 === 9 ? "end." : "word", t0: 880_000 + i * 380, t1: 880_000 + i * 380 + 300, conf: 0.9 });
  const w = { i0: 0, i1: 79, t0: words[0].t0, t1: words[79].t1 };
  const env = new Float32Array(20_000).fill(0.2);
  const plain = heuristicScore(words, env, w, 2.6, [], null), withChat = heuristicScore(words, env, w, 2.6, [], sig);
  assert.ok(withChat.score > plain.score + 3, `${withChat.score} vs ${plain.score}`);
  assert.ok(withChat.features.badges.some((b) => b.includes("Chat")));
});

test("long streams: hot zones from chat, mapped back to stream time, no cross-zone clips", () => {
  const L = require("../dist/pipeline/longform");
  const H = 3_600_000;
  const chat = { messages: 1e5, spikes: [
    { t: 2 * H, peak: 2 * H + 8000, z: 12, ratio: 6, kind: "laugh", sample: [] },
    { t: 2 * H + 60_000, peak: 2 * H + 70_000, z: 8, ratio: 4, kind: "hype", sample: [] }, // merges with the first
    { t: 9 * H, peak: 9 * H + 6000, z: 9, ratio: 5, kind: "shock", sample: [] },
  ] };
  const zones = L.zonesFromChat(chat, 10 * H);
  assert.equal(zones.length, 2);
  assert.equal(zones[0].t0, 2 * H - 120_000);
  assert.equal(zones[0].t1, 2 * H + 70_000 + 45_000);
  assert.equal(L.zoneBudget(10 * H), 40);
  // A word 10 s into the stitched audio is 10 s into zone 1; one just past zone 1's length is in zone 2.
  const len0 = zones[0].t1 - zones[0].t0;
  const t = { words: [{ w: "a", t0: 10_000, t1: 10_400, conf: 1, speaker: "S1" }, { w: "b", t0: len0 + 5000, t1: len0 + 5300, conf: 1, speaker: "S1" }], segments: [], speakers: ["S1"], language: "en" };
  const m = L.remapTranscript(t, zones);
  assert.equal(m.words[0].t0, zones[0].t0 + 10_000);
  assert.equal(m.words[1].t0, zones[1].t0 + 5000);
  assert.ok(L.spansGap(m.words, 0, 1));
  assert.ok(!L.spansGap([{ t0: 0, t1: 300 }, { t0: 800, t1: 900 }], 0, 1));
  // Energy zones: a loud burst in a quiet stream is found.
  const env = new Float32Array(3 * 36_000).fill(0.05);
  for (let i = 50_000; i < 50_080; i++) env[i] = 0.9;
  const ez = L.zonesFromEnergy(env, 3 * H);
  assert.ok(ez.some((z) => z.t0 <= 5_000_000 && z.t1 >= 5_008_000));
  assert.equal(L.twitchVodId("https://www.twitch.tv/videos/2922436506"), "2922436506");
  assert.equal(L.twitchVodId("https://youtube.com/watch?v=x"), null);
});

test("chat: TwitchDownloader text export parses", () => {
  const { parseChat } = require("../dist/pipeline/chat");
  const txt = "[0:00:05] someuser: KEKW\n[12:03:45] other_user: W stream";
  assert.deepEqual(parseChat(txt).map((m) => [m.t, m.text]), [[5000, "KEKW"], [43425000, "W stream"]]);
});

test("background games open on a hook: first payoff lands within seconds", () => {
  const { makeGame, hookStartSteps, GAMES, GAME_HOOKS } = require("../dist/pipeline/games");
  for (const id of Object.keys(GAMES)) {
    assert.ok(GAME_HOOKS[id], `${id} has a challenge line`);
    for (const seed of [1, 42, 999]) {
      const g = makeGame(id, seed);
      if (!g.lead) continue;
      const start = hookStartSteps(id, seed, 30);
      for (let i = 0; i < start; i++) g.step(1 / 30);
      const e0 = g.events;
      let t = 0;
      while (g.events === e0 && t < 30 * 15) { g.step(1 / 30); t++; }
      const secs = t / 30;
      assert.ok(secs <= g.lead + 1.5, `${id}/${seed}: first payoff after ${secs.toFixed(1)} s (lead ${g.lead})`);
      console.log(`  ${id} seed ${seed}: payoff at ${secs.toFixed(1)} s`);
    }
  }
});

test("long streams: HLS playlist → exact segment times for clip downloads", () => {
  const { parseHlsPlaylist } = require("../dist/pipeline/longform");
  const pl = parseHlsPlaylist("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.000,\n0.ts\n#EXTINF:10.000,\n1-muted.ts\n#EXTINF:4.5,\n2.ts\n#EXT-X-ENDLIST\n",
    "https://cdn.example.com/abc/chunked/index-dvr.m3u8");
  assert.deepEqual(pl.segments.map((s) => [s.uri.split("/").pop(), s.t0, s.t1]), [["0.ts", 0, 10000], ["1-muted.ts", 10000, 20000], ["2.ts", 20000, 24500]]);
  assert.equal(pl.segments[0].uri, "https://cdn.example.com/abc/chunked/0.ts");
  const fmp4 = parseHlsPlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nseg1.m4s\n', "https://x.test/v/p.m3u8");
  assert.equal(fmp4.init, "https://x.test/v/init.mp4");
});

test("short stream moments grow to 15 s at a pause, never across a zone gap", () => {
  const { extendToMin, MIN_CLIP_MS } = require("../dist/pipeline/boundaries");
  // Run-on speech, no punctuation: 0.4 s words, a 300 ms pause every 12 words.
  const words = []; let t = 0;
  for (let i = 0; i < 200; i++) { words.push({ w: "yo", t0: t, t1: t + 300, conf: 0.9, speaker: "S1" }); t += 300 + (i % 12 === 11 ? 300 : 100); }
  const [a, b] = extendToMin(words, 100, 120); // ~8 s moment mid-stream
  const dur = words[b].t1 - words[a].t0;
  assert.ok(dur >= MIN_CLIP_MS && dur <= 35_000, `run-on: ${dur} ms`);
  assert.ok(b + 1 >= words.length || words[b + 1].t0 - words[b].t1 >= 250, "ends on a pause");
  // Moment at the END of a hot zone: the next words are an hour later → grow backwards.
  const zone = words.slice(0, 120).map((w) => ({ ...w }));
  for (let i = 0; i < 30; i++) zone.push({ w: "later", t0: 3_600_000 + i * 400, t1: 3_600_000 + i * 400 + 300, conf: 0.9, speaker: "S1" });
  const [c, d] = extendToMin(zone, 100, 119);
  assert.ok(d <= 119, "never crosses into the next zone");
  assert.ok(zone[d].t1 - zone[c].t0 >= MIN_CLIP_MS, `zone edge: ${zone[d].t1 - zone[c].t0} ms`);
});

test("context headline wraps into balanced lines; web copy matches", () => {
  const { wrapHeadline } = require("../dist/pipeline/render");
  const lines = wrapHeadline("KAI CENAT CRASHES OUT AT FAST FOOD WORKER", 22);
  assert.deepEqual(lines, ["KAI CENAT CRASHES OUT", "AT FAST FOOD WORKER"]);
  assert.ok(lines.every((l) => l.length <= 22));
  assert.deepEqual(wrapHeadline("SHORT ONE", 22), ["SHORT ONE"]);
  const fs = require("node:fs"), path = require("node:path");
  const web = fs.readFileSync(path.join(__dirname, "../../web/src/lib/headline.ts"), "utf8");
  assert.match(web, /cur\.length >= target && lines\.length < n - 1/);
});

test("headlines use the creator's real name, never a generic 'STREAMER'", () => {
  const { cleanHeadline, displayName } = require("../dist/pipeline/llm-scoring");
  assert.equal(displayName("KaiCenat"), "KAI CENAT");
  assert.equal(displayName("kai_cenat"), "KAI CENAT");
  const src = { creator: "KaiCenat" };
  assert.equal(cleanHeadline("Streamer orders crazy GTA meal 😂 #fyp", src), "KAI CENAT ORDERS CRAZY GTA MEAL");
  assert.equal(cleanHeadline("STREAMER'S MOM WALKS IN", src), "KAI CENAT'S MOM WALKS IN");
  assert.equal(cleanHeadline("Doctor explains sleep", {}), "DOCTOR EXPLAINS SLEEP");
});

test("auto-reframe: follows one face, finds two speakers, falls back without faces", () => {
  const { planReframe } = require("../dist/pipeline/facetrack");
  const words = []; for (let i = 0; i < 60; i++) words.push({ w: "hi", t0: i * 500, t1: i * 500 + 400, conf: 1, speaker: i < 30 ? "S1" : "S2" });
  const one = Array.from({ length: 60 }, (_, k) => ({ t: k * 500, faces: [{ cx: 0.62, cy: 0.4, w: 0.2, h: 0.3 }] }));
  const p1 = planReframe(one, words, 0, 30000, 16 / 9, 9 / 16);
  assert.equal(p1.mode, "manual"); assert.equal(p1.keyframes.length, 1); assert.ok(Math.abs(p1.keyframes[0].cx - 0.62) < 0.01); assert.equal(p1.two, null);
  // Two people side by side; S1 (left, bigger while talking) then S2 (right).
  const both = Array.from({ length: 60 }, (_, k) => ({ t: k * 500, faces: [
    { cx: 0.28, cy: 0.4, w: k < 30 ? 0.22 : 0.18, h: 0.3 }, { cx: 0.74, cy: 0.4, w: k < 30 ? 0.18 : 0.22, h: 0.3 }] }));
  const p2 = planReframe(both, words, 0, 30000, 16 / 9, 9 / 16);
  assert.ok(p2.two && Math.abs(p2.two.a - 0.28) < 0.01 && Math.abs(p2.two.b - 0.74) < 0.01, JSON.stringify(p2.two));
  assert.ok(p2.keyframes.length >= 2, "pans between the speakers");
  assert.ok(p2.keyframes[0].cx < 0.4 && p2.keyframes[p2.keyframes.length - 1].cx > 0.6);
  // No faces in a wide shot → letterbox.
  const none = Array.from({ length: 20 }, (_, k) => ({ t: k * 500, faces: [] }));
  assert.equal(planReframe(none, words, 0, 10000, 16 / 9, 9 / 16).mode, "fit");
});

test("game sounds: every game makes noise, synthesized into a clean WAV", async () => {
  const { renderGame, GAMES } = require("../dist/pipeline/games");
  const { synthSfx } = require("../dist/pipeline/sfx");
  for (const id of Object.keys(GAMES)) {
    const sounds = await renderGame(id, 7, 30, 30 * 12, () => {});
    assert.ok(sounds.length > 0, `${id} makes sounds`);
    const wav = synthSfx(sounds, 12, 3);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(24), 48000);
    let peak = 0, sum = 0; const n = (wav.length - 44) / 2;
    for (let i = 0; i < n; i++) { const v = Math.abs(wav.readInt16LE(44 + i * 2)); peak = Math.max(peak, v); sum += v; }
    assert.ok(peak > 2000 && peak <= 30000, `${id}: audible, never clipping (peak ${peak})`);
    assert.ok(sum / n < 6000, `${id}: a patter, not a wall of noise (mean ${Math.round(sum / n)})`);
  }
});

test("captions: power words get their own colour", () => {
  const { isPowerWord, buildAss } = require("../dist/pipeline/captions");
  for (const w of ["$500", "10", "3x", "90%", "NEVER", "insane!", "million,"]) assert.ok(isPowerWord(w), w);
  for (const w of ["the", "and", "really", "gym"]) assert.ok(!isPowerWord(w), w);
  const ass = buildAss([{ w: "this", t0: 0, t1: 300 }, { w: "is", t0: 300, t1: 500 }, { w: "insane", t0: 500, t1: 900 }], "karaoke_yellow", 1080, 1920);
  assert.match(ass, /\c&H0035F24A\}INSANE/);
});
