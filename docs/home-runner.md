# Run Clipper jobs on your own computer

YouTube blocks downloads from GitHub's servers, but not from a normal home
connection. If you register your own computer as a **GitHub self-hosted
runner**, Clipper can send YouTube links (or every job) to it instead.

Your computer has to be **on and running the runner** for those jobs to start —
otherwise they wait in the queue (up to 24 hours) until it comes back.

## What you need

- A Linux machine, or Windows with **WSL** (Ubuntu). The job scripts use bash.
- ~20 GB free disk, a decent CPU (transcription runs on it if Groq isn't set up).

## 1. Install WSL (Windows only)

In PowerShell as administrator:

```powershell
wsl --install -d Ubuntu
```

Restart, open **Ubuntu**, create your Linux user. Then inside Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y curl unzip git python3 python3-pip
```

## 2. Register the runner

1. Open https://github.com/Megablaze757/clipfarm/settings/actions/runners/new
2. Choose **Linux** / **x64**.
3. Copy the commands GitHub shows (download, `./config.sh --url … --token …`) and
   run them in your Ubuntu terminal. Accept the default labels — Clipper uses
   the `self-hosted` label.
4. Start it: `./run.sh` (or `sudo ./svc.sh install && sudo ./svc.sh start` to
   run it in the background, starting with the computer).

GitHub's runners page should now show your computer as **Idle**.

## 3. Turn it on in Clipper

Admin → **Settings** → **Run jobs on my computer**:

- **YouTube links only** — everything else stays on GitHub's runners (recommended).
- **All jobs** — every processing and export job goes to your computer.
- **Off** — back to GitHub's runners only.

## Notes

- Jobs install their own tools (FFmpeg, yt-dlp, Whisper, OpenCV) into your
  home folder and cache them, so the first run takes a few extra minutes.
- The runner only runs this repository's `clipper-job.yml` workflow.
- To stop: switch it **Off** in Admin, then stop `./run.sh` (or `sudo ./svc.sh stop`).
