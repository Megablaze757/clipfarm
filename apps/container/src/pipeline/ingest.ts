import { createWriteStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { r2Download } from "../lib/worker";
import { run, StageError } from "../lib/proc";

const MAX_BYTES = 5 * 1024 ** 3;

/** Private, loopback, link-local, CGNAT, multicast… anything not the public internet. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
}

/** §14.5: resolve, refuse private targets, and pin the check to every hop. */
async function assertPublic(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) throw new StageError("E_SOURCE_PRIVATE", "Only http(s) links can be imported.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new StageError("E_SOURCE_PRIVATE", `Couldn't resolve ${host}.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new StageError("E_SOURCE_PRIVATE", "That address isn't reachable from the internet.");
}

const SITE_RE = /(^|\.)(youtube\.com|youtu\.be|twitch\.tv|vimeo\.com|x\.com|twitter\.com|tiktok\.com|instagram\.com|facebook\.com|kick\.com|rumble\.com|dailymotion\.com)$/i;

/** Gets the source onto local disk. Returns the path and, for site links, the page title. */
export async function fetchSource(source: { kind: "upload"; r2_key: string } | { kind: "url"; url: string }, dir: string): Promise<{ path: string; title?: string }> {
  if (source.kind === "upload") {
    const ext = source.r2_key.slice(source.r2_key.lastIndexOf("."));
    const path = join(dir, `source${ext}`);
    await r2Download(source.r2_key, path);
    return { path };
  }

  const url = new URL(source.url);
  await assertPublic(url);

  if (SITE_RE.test(url.hostname) || /\.m3u8($|\?)/i.test(url.pathname)) {
    try {
      const { stdout } = await run("yt-dlp", [
        "--no-playlist", "--no-progress", "--restrict-filenames",
        "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format", "mp4",
        "--max-filesize", "5G",
        "--print", "title", "--no-simulate",
        "-o", join(dir, "source.%(ext)s"),
        url.toString(),
      ], { timeoutMs: 45 * 60 * 1000 });
      const file = (await readdir(dir)).find((f) => f.startsWith("source.") && !f.endsWith(".part"));
      if (!file) throw new Error("yt-dlp produced no file");
      return { path: join(dir, file), title: stdout.trim().split("\n")[0]?.slice(0, 200) || undefined };
    } catch (e) {
      const msg = String((e as Error).message);
      if (/private|members-only|sign in|login required/i.test(msg)) throw new StageError("E_SOURCE_PRIVATE", "That video is private or needs a login. Download it and upload the file instead.");
      if (/not available in your country|geo/i.test(msg)) throw new StageError("E_SOURCE_GEO_BLOCKED", "That video is blocked in this region. Upload the file instead.");
      if (/confirm you.?re not a bot|429|too many requests/i.test(msg)) throw new StageError("E_SOURCE_PRIVATE", "The site blocked the download. Upload the file instead.", true);
      if (/drm/i.test(msg)) throw new StageError("E_SOURCE_DRM", "That video is DRM-protected.");
      throw new StageError("E_INGEST_CORRUPT", `Couldn't download that link: ${msg.slice(0, 200)}`);
    }
  }

  // Direct file link: follow redirects by hand so every hop is re-checked.
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(30 * 60 * 1000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      current = new URL(r.headers.get("location")!, current);
      await assertPublic(current);
      continue;
    }
    if (r.status === 403 || r.status === 401) throw new StageError("E_SOURCE_PRIVATE", `The link refused the download (${r.status}).`);
    if (r.status === 451) throw new StageError("E_SOURCE_GEO_BLOCKED", "That file is blocked in this region.");
    if (!r.ok || !r.body) throw new StageError("E_INGEST_CORRUPT", `The link returned ${r.status}.`);
    if (Number(r.headers.get("content-length")) > MAX_BYTES) throw new StageError("E_INGEST_TOO_LARGE", "Files are limited to 5 GB.");
    const path = join(dir, "source.bin");
    let seen = 0;
    const limit = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        cb(seen > MAX_BYTES ? new StageError("E_INGEST_TOO_LARGE", "Files are limited to 5 GB.") : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(r.body as any), limit, createWriteStream(path));
    return { path };
  }
  throw new StageError("E_INGEST_CORRUPT", "Too many redirects.");
}
