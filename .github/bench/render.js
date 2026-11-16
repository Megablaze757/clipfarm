// A real final render through the pipeline's own code, for the benchmark.
const { renderFinal } = require(process.env.GITHUB_WORKSPACE + "/apps/container/dist/pipeline/render");

const words = [];
for (let t = 60000; t < 105000; t += 330) words.push({ w: "word", t0: t, t1: t + 280 });

renderFinal("/tmp/b/mezz_copy.mp4", {
  trim: { in_ms: 60000, out_ms: 105000 },
  crop: { mode: "path", keyframes: [{ t_ms: 0, cx: 0.4 }, { t_ms: 20000, cx: 0.6 }] },
  scale: { w: 1080, h: 1920 },
  captions: { mode: "burn", style_id: "karaoke_yellow", words },
  overlays: [{ type: "title", text: "Benchmark", t_ms: [0, 2500] }],
  watermark: true,
  audio: { loudnorm: { target_lufs: -14, tp: -1.5 } },
  encode: { crf: 20, preset: "medium", fps: 30 },
}, "/tmp/b", "/tmp/b/final.mp4").then(
  () => console.log("ok"),
  (e) => { console.error(e); process.exit(1); },
);
