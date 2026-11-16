#!/usr/bin/env python3
"""
Built-in, free speech-to-text for the Clipper runner (no API key, no cost).

Used when Groq's free tier is rate-limited (or unavailable). Runs Whisper on
the runner's own CPU via faster-whisper and prints JSON in the same shape as
Groq's verbose_json, so the pipeline treats both the same:

    {"language": "en",
     "segments": [{"id", "start", "end", "text", "avg_logprob", "no_speech_prob"}],
     "words":    [{"word", "start", "end"}]}

    python3 whisper_local.py <audio-file> [language|auto]

Model: WHISPER_MODEL env var (default "base" — about 5-10x faster than real
time on a 4-core GitHub runner; "small" is more accurate and ~3x slower).
"""
import json
import os
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel


def load_audio(path: str) -> "np.ndarray":
    """Decode with FFmpeg to 16 kHz mono float32.

    faster-whisper's own decoder calls PyAV with an argument newer PyAV
    releases removed (`metadata_errors`), which crashes on every file. Handing
    it raw samples avoids that code path entirely — and FFmpeg is already on
    the runner.
    """
    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: whisper_local.py <audio> [language]", file=sys.stderr)
        sys.exit(2)
    audio = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] not in ("", "auto") else None
    model_name = os.environ.get("WHISPER_MODEL", "base")
    threads = int(os.environ.get("WHISPER_THREADS", str(os.cpu_count() or 4)))

    model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=threads)
    segments, info = model.transcribe(
        load_audio(audio),
        language=language,
        word_timestamps=True,
        vad_filter=True,  # skips silence, which is most of the speed-up on podcasts
        beam_size=1,
        temperature=0,
    )

    out_segments, out_words = [], []
    for i, seg in enumerate(segments):
        out_segments.append({
            "id": i,
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text,
            "avg_logprob": seg.avg_logprob,
            "no_speech_prob": seg.no_speech_prob,
        })
        for w in seg.words or []:
            out_words.append({"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})

    json.dump({"language": info.language, "segments": out_segments, "words": out_words}, sys.stdout)


if __name__ == "__main__":
    main()
