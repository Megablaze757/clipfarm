import { createWriteStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { r2Download } from "../lib/worker";
import { run, StageError } from "../lib/proc";

const MAX_BYTES = 15 * 1024 ** 3; // a 5-6 h 1080p stream is often 5-10 GB

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
/** A site yt-dlp handles (YouTube, Twitch, Kick, …) rather than a direct file link. */
export function isSiteUrl(u: string): boolean {
  try { return SITE_RE.test(new URL(u).hostname); } catch { return false; }
}

export async function fetchSource(source: { kind: "upload"; r2_key: string } | { kind: "url"; url: string }, dir: string): Promise<{ path: string; title?: string; creator?: string }> {
  if (source.kind === "upload") {
    const ext = source.r2_key.slice(source.r2_key.lastIndexOf("."));
    const path = join(dir, `source${ext}`);
    await r2Download(source.r2_key, path);
    return { path };
  }

  const url = new URL(source.url);
  await assertPublic(url);

  if (SITE_RE.test(url.hostname) || /\.m3u8($|\?)/i.test(url.pathname)) {
    return downloadWithYtDlp(url, dir);
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
    if (Number(r.headers.get("content-length")) > MAX_BYTES) throw new StageError("E_INGEST_TOO_LARGE", "Files are limited to 15 GB.");
    const path = join(dir, "source.bin");
    let seen = 0;
    const limit = new Transform({
      transform(chunk, _enc, cb) {
        seen += chunk.length;
        cb(seen > MAX_BYTES ? new StageError("E_INGEST_TOO_LARGE", "Files are limited to 15 GB.") : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(r.body as any), limit, createWriteStream(path));
    return { path };
  }
  throw new StageError("E_INGEST_CORRUPT", "Too many redirects.");
}

/**
 * YouTube often refuses downloads from data-centre IPs (GitHub's runners,
 * Cloudflare) with "Sign in to confirm you're not a bot". We make one normal
 * attempt and, if YouTube says no, tell the user plainly to upload the file —
 * we don't try to get around YouTube's bot detection.
 */
export function classifyYtDlpError(msg: string): StageError {
  if (/confirm you.?re not a bot|sign in to confirm|429|too many requests|HTTP Error 403|po.?token/i.test(msg)) {
    return new StageError("E_SOURCE_BLOCKED",
      "YouTube didn't allow the download from our servers. Download the video yourself and upload the file instead.");
  }
  if (/private video|members-only|join this channel|login required|age.?restricted|confirm your age/i.test(msg)) {
    return new StageError("E_SOURCE_PRIVATE", "That video is private, members-only or age-restricted. Download it and upload the file instead.");
  }
  if (/available in your country|geo.?restrict|blocked it in your country/i.test(msg)) {
    return new StageError("E_SOURCE_GEO_BLOCKED", "That video is blocked in this region. Upload the file instead.");
  }
  if (/drm/i.test(msg)) return new StageError("E_SOURCE_DRM", "That video is DRM-protected.");
  if (/video unavailable|has been removed|does not exist/i.test(msg)) {
    return new StageError("E_SOURCE_PRIVATE", "That video is unavailable (removed or the link is wrong).");
  }
  return new StageError("E_INGEST_CORRUPT", `Couldn't download that link: ${msg.slice(-300)}`);
}

async function downloadWithYtDlp(url: URL, dir: string): Promise<{ path: string; title?: string; creator?: string }> {
  const bin = process.env.YTDLP_BIN || "yt-dlp";
  const common = [
    "--no-playlist", "--no-progress", "--restrict-filenames",
    // H.264 + AAC first: browsers play it as-is, so no working copy is needed.
    "-f", "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/b[vcodec^=avc1][height<=1080]/bv*[height<=1080]+ba/b[height<=1080]/b",
    "--merge-output-format", "mp4",
    "--max-filesize", "15G",
    "--concurrent-fragments", "8",
    "--retries", "3",
    "--print", "title", "--print", "%(uploader,channel,creator|)s", "--no-simulate",
    "-o", join(dir, "source.%(ext)s"),
  ];
  try {
    const { stdout } = await run(bin, [...common, url.toString()], { timeoutMs: 45 * 60 * 1000 });
    const file = (await readdir(dir)).find((f) => f.startsWith("source.") && !f.endsWith(".part"));
    if (!file) throw new Error("yt-dlp produced no file");
    const [t, who] = stdout.trim().split("\n");
    return { path: join(dir, file), title: t?.slice(0, 200) || undefined, creator: who?.trim().slice(0, 80) || undefined };
  } catch (e) {
    const msg = String((e as Error).message);
    console.warn(`yt-dlp failed: ${msg.slice(-400)}`);
    throw classifyYtDlpError(msg);
  }
}
