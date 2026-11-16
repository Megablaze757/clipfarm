import { internalSecret, type Env } from "./env";
import { ApiError, CORS, safeEqual } from "./http";

/**
 * Signed, expiring media URLs (FR-11.4, §11.2). The bucket stays private; the
 * Worker streams objects out of R2 when the signature checks. R2 has no egress
 * fee, so streaming through the Worker costs nothing extra.
 */
const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signedUrl(env: Env, key: string | null | undefined, ttlSeconds = 24 * 3600, download?: string): Promise<string | null> {
  if (!key) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmac(internalSecret(env), `${key}:${exp}`);
  const base = (env.CLIPPER_API_URL || "").replace(/\/$/, "");
  const dl = download ? `&dl=${encodeURIComponent(download)}` : "";
  return `${base}/v1/media?k=${encodeURIComponent(key)}&e=${exp}&s=${sig}${dl}`;
}

export async function serveMedia(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("k") ?? "";
  const exp = Number(url.searchParams.get("e"));
  const sig = url.searchParams.get("s") ?? "";
  if (!key || !Number.isFinite(exp) || exp < Date.now() / 1000) throw new ApiError(403, "E_LINK_EXPIRED", "this link has expired");
  if (!safeEqual(sig, await hmac(internalSecret(env), `${key}:${exp}`))) throw new ApiError(403, "E_FORBIDDEN", "bad signature");
  return streamObject(req, env, key, url.searchParams.get("dl"));
}

/** Streams an R2 object with HTTP Range support (video seeking needs it). */
export async function streamObject(req: Request, env: Env, key: string, download?: string | null): Promise<Response> {
  const head = await env.R2_BUCKET.head(key);
  if (!head) throw new ApiError(404, "E_NOT_FOUND", "media not found");
  const size = head.size;
  const range = parseRange(req.headers.get("Range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...CORS, "Content-Range": `bytes */${size}` } });
  }
  const obj = await env.R2_BUCKET.get(key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!obj) throw new ApiError(404, "E_NOT_FOUND", "media not found");
  const headers: Record<string, string> = {
    ...CORS,
    "Content-Type": head.httpMetadata?.contentType || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    ETag: head.httpEtag,
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^\w.\- ]/g, "_")}"`;
  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
    return new Response(obj.body, { status: 206, headers });
  }
  headers["Content-Length"] = String(size);
  return new Response(obj.body, { status: 200, headers });
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number, end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}
