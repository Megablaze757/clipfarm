"""
End-to-end timing through the LIVE app, as a guest (no account):
upload a file via the Worker's multipart API (exactly like the website),
create a project, then poll it and record when each stage starts.

    python3 e2e.py <video-file> [title]

Prints ::notice annotations with the timings (readable without logging in).
Uses only the standard library.
"""
import json
import os
import sys
import time
import urllib.request

API = os.environ.get("CLIPPER_API_URL", "https://apex-api.fitnessguru.workers.dev").rstrip("/")


def call(method, path, body=None, data=None, headers=None):
    hdrs = {"User-Agent": "clipper-e2e"}
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers or {})
    req = urllib.request.Request(API + path, data=data, method=method, headers=hdrs)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:400]
            if e.code < 500 or attempt == 4:
                raise SystemExit(f"{method} {path} -> {e.code}: {msg}")
        except Exception as e:  # network blip
            if attempt == 4:
                raise
        time.sleep(2 ** attempt)


def notice(msg):
    print(f"::notice title=Clipper 1-hour test::{msg}", flush=True)


def main():
    path = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else "E2E test (1 hour)"
    size = os.path.getsize(path)

    t_up = time.time()
    up = call("POST", "/v1/upload/create", {"filename": os.path.basename(path), "content_type": "video/mp4", "size": size})
    parts = []
    with open(path, "rb") as f:
        n = 1
        while True:
            chunk = f.read(up["part_size"])
            if not chunk:
                break
            q = f"/v1/upload/part?key={urllib.request.quote(up['key'])}&upload_id={urllib.request.quote(up['upload_id'])}&part={n}"
            res = call("PUT", q, data=chunk, headers={"Content-Type": "application/octet-stream"})
            parts.append({"part": n, "etag": res["etag"]})
            n += 1
    call("POST", "/v1/upload/complete", {"key": up["key"], "upload_id": up["upload_id"], "parts": parts})
    upload_s = time.time() - t_up
    notice(f"Uploaded {size / 1e9:.2f} GB in {upload_s:.0f} s ({size / 1e6 / max(upload_s, 1):.0f} MB/s)")

    t0 = time.time()
    proj = call("POST", "/v1/projects", {"title": title, "source": {"kind": "upload", "r2_key": up["key"]}},
                headers={"Idempotency-Key": f"e2e-{int(t0)}"})
    pid = proj["id"]
    print("project", pid, flush=True)

    seen, last = {}, None
    while time.time() - t0 < 60 * 60:
        p = call("GET", f"/v1/projects/{pid}")
        st = p["status"]
        if st != last:
            seen[st] = time.time() - t0
            print(f"{seen[st]:7.1f}s  {st}  progress={p.get('progress')}", flush=True)
            last = st
        if st in ("ready", "failed"):
            break
        time.sleep(3)

    total = time.time() - t0
    stages = " → ".join(f"{k} @{v:.0f}s" for k, v in seen.items())
    if last == "ready":
        notice(f"1-hour video: clips READY {total / 60:.1f} min after the project was created ({total:.0f} s). {p.get('candidate_count')} clips, top score {p.get('top_score')}.")
    else:
        notice(f"1-hour video: ended as {last} after {total:.0f} s — {p.get('error_code')}: {p.get('error_detail')}")
    notice(f"Stages: {stages}")
    notice(f"Model versions: {json.dumps(p.get('model_versions'))}")
    with open(os.environ.get("GITHUB_STEP_SUMMARY", os.devnull), "a") as f:
        f.write(f"## Clipper 1-hour test\n\n- Upload: {upload_s:.0f} s\n- Project → ready: {total:.0f} s ({total / 60:.1f} min)\n- Stages: {stages}\n- Result: {last}\n")
    if last != "ready":
        sys.exit(1)


if __name__ == "__main__":
    main()
