"""Turns the 10-minute stage timings into a 5-hour-stream estimate."""
import os
import sys

sample, target = int(os.environ["SAMPLE_MIN"]), int(os.environ["TARGET_MIN"])
r = {k: float(v) for k, v in (l.strip().split("|") for l in open(sys.argv[1]) if "|" in l and l.strip().split("|")[1])}

k = target / sample              # stages that scale with source length
w = target * 60 / 120            # Whisper was timed on 120 s of speech
setup = 75                       # checkout, cached tools, npm ci + build
ai = 6 * 60                      # nomination (30 blocks, 2 at a time) + judging, ~6 min
groq = 12 * target / 10          # ~10-15 s per 10-min chunk within the free allowance
uploads = 120                    # working copy + previews to R2


def total(mezz, asr):
    # The working copy encodes alongside transcription, so the slower one counts.
    return (setup + (r.get("audio_extract", 0) + r.get("loudness", 0)) * k + max(mezz, asr) + ai
            + r.get("previews_20x30s", 0) + r.get("edit_previews_20x150s", 0) + uploads)


mezz_long = r.get("encode_superfast", r.get("encode_veryfast", 0)) * k
rows = [("H.264 source, Groq transcribes", r.get("copy_h264", 0) * k, groq),
        ("VP9/other source, Groq transcribes", mezz_long, groq)]
for m in ("base", "small"):
    key = f"whisper_{m}_per_120s"
    if key in r:
        asr = r[key] * w + r.get("whisper_install", 0)
        rows.append((f"H.264 source, built-in Whisper {m} for ALL of it", r.get("copy_h264", 0) * k, asr))
        rows.append((f"VP9/other source, built-in Whisper {m} for ALL of it", mezz_long, asr))

lines = [f"Per {sample}-min sample: " + ", ".join(f"{a}={b:.1f}s" for a, b in r.items())]
if "whisper_base_per_120s" not in r:
    lines.append("Built-in Whisper did not run - see the 'Time each stage' log for the error.")
for name, mezz, asr in rows:
    mins = total(mezz, asr) / 60
    lines.append(f"5-hour stream, {name}: ~{mins:.0f} min ({'fits' if mins < 330 else 'EXCEEDS'} the 330-min job limit)")
lines.append(f"Final 45 s vertical export with captions: {r.get('final_render_45s', 0):.0f} s")

with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
    f.write("## Clipper benchmark\n\n" + "\n".join(f"- {l}" for l in lines) + "\n")
for l in lines:
    print(f"::notice title=Clipper benchmark::{l}")
