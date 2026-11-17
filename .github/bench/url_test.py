"""
Submits a public video link to the LIVE app as a guest and logs each stage
until the project is ready, then prints the top clips.

    python3 url_test.py <video-url>
"""
import json
import os
import sys
import time
import urllib.request

API = os.environ.get("CLIPPER_API_URL", "https://apex-api.fitnessguru.workers.dev").rstrip("/")


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", "User-Agent": "clipper-url-test"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"null")


def main():
    p = call("POST", "/v1/projects", {"source": {"kind": "url", "url": sys.argv[1]}})
    pid = p["id"]
    t0 = time.time()
    print(f"P={pid}", flush=True)
    last = None
    while time.time() - t0 < 60 * 60:
        r = call("GET", f"/v1/projects/{pid}")
        key = (r["status"], r.get("progress"))
        if key != last:
            print(f"{time.time() - t0:7.0f}s  {r['status']} {r.get('progress')}", flush=True)
            last = key
        if r["status"] in ("ready", "failed"):
            break
        time.sleep(10)
    print(f"RESULT {r['status']} in {(time.time() - t0) / 60:.1f} min  {r.get('error_code') or ''} {r.get('error_detail') or ''}")
    if r["status"] == "ready":
        for c in call("GET", f"/v1/projects/{pid}/clips?limit=5")["candidates"]:
            print(f"- {c['score']:.2f}  {(c['t_out_ms'] - c['t_in_ms']) / 1000:.0f}s  {(c.get('text') or c.get('title') or '')[:160]!r}")


if __name__ == "__main__":
    main()
