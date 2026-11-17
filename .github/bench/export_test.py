"""
Times an MP4 export through the LIVE app as a guest: takes the top clip of a
project, starts a render, and polls until the MP4 is ready.

    python3 export_test.py <project-id> [preset]
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
                                 headers={"Content-Type": "application/json", "User-Agent": "clipper-export-test"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"null")


def main():
    pid = sys.argv[1]
    preset = sys.argv[2] if len(sys.argv) > 2 else "tiktok"
    cand = call("GET", f"/v1/projects/{pid}/clips?limit=1")["candidates"][0]
    clip = call("POST", "/v1/clips", {"candidate_id": cand["id"]})
    secs = (cand["t_out_ms"] - cand["t_in_ms"]) / 1000
    t0 = time.time()
    job = call("POST", f"/v1/clips/{clip['id']}/render", {"preset": preset})
    last = None
    while time.time() - t0 < 15 * 60:
        r = call("GET", f"/v1/renders/{job['id']}")
        if r["status"] != last:
            print(f"{time.time() - t0:6.1f}s  {r['status']}", flush=True)
            last = r["status"]
        if r["status"] in ("completed", "failed"):
            break
        time.sleep(2)
    total = time.time() - t0
    print(f"RESULT {r['status']}: {secs:.0f}s clip exported as {preset} in {total:.0f}s "
          f"(error: {r.get('error_code')} {str(r.get('error_detail'))[:200]})" if r["status"] != "completed"
          else f"RESULT completed: {secs:.0f}s clip exported as {preset} in {total:.0f}s")


if __name__ == "__main__":
    main()
