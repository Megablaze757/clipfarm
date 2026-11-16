#!/usr/bin/env bash
# Times each heavy pipeline stage on /tmp/b/sample_*.{mp4,webm}. Never aborts:
# a failing stage prints its error and the rest still run.
set +e
cd /tmp/b
now() { date +%s.%N; }
r() { printf '%s|%s\n' "$1" "$2" >> results.txt; echo "$1: $2 s"; }
t() {
  local s; s=$(now)
  "$@" > /tmp/b/last.log 2>&1
  local rc=$?
  local e; e=$(now)
  if [ $rc -ne 0 ]; then echo "FAILED ($rc): $*" >&2; tail -20 /tmp/b/last.log >&2; fi
  echo "$e - $s" | bc
}
: > results.txt

r audio_extract "$(t ffmpeg -y -i sample_h264.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le audio.wav)"
r loudness "$(t ffmpeg -i audio.wav -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -)"
r copy_h264 "$(t ffmpeg -y -i sample_h264.mp4 -map 0:v:0 -map 0:a:0 -c copy -movflags +faststart mezz_copy.mp4)"
for p in veryfast superfast; do
  r "encode_$p" "$(t ffmpeg -y -i sample_vp9.webm -map 0:v:0 -map 0:a:0 \
    -vf "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2" \
    -c:v libx264 -profile:v high -crf 21 -preset "$p" -g 60 -keyint_min 60 -sc_threshold 0 -pix_fmt yuv420p -r 30 \
    -c:a aac -ar 48000 -ac 2 -b:a 160k -movflags +faststart "mezz_$p.mp4")"
done
ls -la mezz_*.mp4

# A 5-hour stream gets 20 clips: 20 clip previews (9:16, 30 s) and 20 editor
# previews (16:9 360p, clip ±60 s ≈ 150 s), three at a time like the pipeline.
s=$(now)
for i in $(seq 0 19); do
  ffmpeg -y -ss $(( (i*25) % 560 )) -i mezz_copy.mp4 -t 30 -vf "crop='min(iw,ih*9/16)':ih,scale=360:640,setsar=1" \
    -c:v libx264 -crf 30 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart "p$i.mp4" > /dev/null 2>&1 &
  if [ $(( (i+1) % 3 )) -eq 0 ]; then wait; fi
done
wait
r previews_20x30s "$(echo "$(now) - $s" | bc)"
s=$(now)
for i in $(seq 0 19); do
  ffmpeg -y -ss $(( (i*23) % 440 )) -i mezz_copy.mp4 -t 150 -vf scale=-2:360 -c:v libx264 -crf 30 -preset ultrafast -g 30 \
    -pix_fmt yuv420p -c:a aac -b:a 64k -ac 1 -movflags +faststart "e$i.mp4" > /dev/null 2>&1 &
  if [ $(( (i+1) % 3 )) -eq 0 ]; then wait; fi
done
wait
r edit_previews_20x150s "$(echo "$(now) - $s" | bc)"

# Built-in Whisper on the CPU, 2 minutes of speech per model.
ffmpeg -y -i audio.wav -t 120 -c:a flac chunk.flac > /dev/null 2>&1
r whisper_install "$(t "$WHISPER_PYTHON" -m pip install "faster-whisper>=1.1,<2")"
"$WHISPER_PYTHON" -c "import faster_whisper, ctranslate2; print('faster-whisper', faster_whisper.__version__, 'ctranslate2', ctranslate2.__version__)"
SCRIPT="$GITHUB_WORKSPACE/apps/container/scripts/whisper_local.py"
for m in base small; do
  echo "--- warm-up $m (downloads the model)"
  if ! WHISPER_MODEL=$m "$WHISPER_PYTHON" "$SCRIPT" chunk.flac en > /dev/null 2> "warm_$m.log"; then
    echo "WHISPER $m FAILED:"; tail -30 "warm_$m.log"; continue
  fi
  s=$(now)
  WHISPER_MODEL=$m "$WHISPER_PYTHON" "$SCRIPT" chunk.flac en > "w_$m.json" 2> "w_$m.log"
  r "whisper_${m}_per_120s" "$(echo "$(now) - $s" | bc)"
  echo "$m words: $(python3 -c "import json;print(len(json.load(open('w_$m.json'))['words']))" 2>&1)"
done

# A real final render through the pipeline's own code: 45 s, 1080x1920,
# karaoke captions, crop path, title, watermark, 2-pass loudnorm.
r final_render_45s "$(t node "$GITHUB_WORKSPACE/.github/bench/render.js")"
ls -la final.mp4
cat results.txt
exit 0
