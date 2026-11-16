import type { Env } from "./env";
import type { Caller } from "./auth";
import { ApiError, body, json } from "./http";

/**
 * Resumable uploads straight into R2 via the Worker's R2 binding (§11.4).
 *
 * R2 multipart through the binding gives the same resumability as TUS without
 * any S3 API credentials: the browser sends the file in parts, each part is
 * retried on its own, and an interrupted upload resumes by skipping the parts
 * it already has (the client keeps the etags). Parts must be ≥5 MiB except the
 * last; the Worker body limit is 100 MB, so the client uses 50 MiB parts.
 */
export const PART_SIZE = 50 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 ** 3; // FR-1.1
const ALLOWED = /\.(mp4|mov|mkv|webm|mp3|wav|m4a|flac)$/i;

const ownKey = (caller: Caller, key: unknown): string => {
  if (typeof key !== "string" || !key.startsWith(`${caller.tenantId}/uploads/`) || key.includes("..")) {
    throw new ApiError(403, "E_FORBIDDEN", "not your upload");
  }
  return key;
};

export async function uploadCreate(req: Request, env: Env, caller: Caller): Promise<Response> {
  const { filename, content_type, size } = await body<{ filename?: string; content_type?: string; size?: number }>(req);
  const name = String(filename ?? "").trim();
  if (!ALLOWED.test(name)) {
    throw new ApiError(400, "E_INGEST_UNSUPPORTED_CODEC", "upload an mp4, mov, mkv, webm, mp3, wav, m4a or flac file");
  }
  if (Number(size) > MAX_UPLOAD_BYTES) throw new ApiError(400, "E_INGEST_TOO_LARGE", "files are limited to 5 GB");
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const key = `${caller.tenantId}/uploads/${crypto.randomUUID()}/source${ext}`;
  const upload = await env.R2_BUCKET.createMultipartUpload(key, {
    httpMetadata: { contentType: content_type || "application/octet-stream" },
    customMetadata: { filename: name.slice(0, 200), user: caller.userId },
  });
  return json({ key, upload_id: upload.uploadId, part_size: PART_SIZE });
}

export async function uploadPart(req: Request, env: Env, caller: Caller): Promise<Response> {
  const url = new URL(req.url);
  const key = ownKey(caller, url.searchParams.get("key"));
  const uploadId = url.searchParams.get("upload_id") ?? "";
  const part = Number(url.searchParams.get("part"));
  if (!uploadId || !Number.isInteger(part) || part < 1 || part > 10000) throw new ApiError(400, "E_VALIDATION", "bad part");
  if (!req.body) throw new ApiError(400, "E_VALIDATION", "empty part");
  const upload = env.R2_BUCKET.resumeMultipartUpload(key, uploadId);
  const done = await upload.uploadPart(part, req.body);
  return json({ part: done.partNumber, etag: done.etag });
}

export async function uploadComplete(req: Request, env: Env, caller: Caller): Promise<Response> {
  const b = await body<{ key?: string; upload_id?: string; parts?: { part: number; etag: string }[] }>(req);
  const key = ownKey(caller, b.key);
  const parts = (b.parts ?? []).map((p) => ({ partNumber: Number(p.part), etag: String(p.etag) })).sort((a, z) => a.partNumber - z.partNumber);
  if (!b.upload_id || !parts.length) throw new ApiError(400, "E_VALIDATION", "upload_id and parts required");
  const obj = await env.R2_BUCKET.resumeMultipartUpload(key, b.upload_id).complete(parts);
  return json({ key, size: obj.size });
}

export async function uploadAbort(req: Request, env: Env, caller: Caller): Promise<Response> {
  const b = await body<{ key?: string; upload_id?: string }>(req);
  const key = ownKey(caller, b.key);
  if (b.upload_id) await env.R2_BUCKET.resumeMultipartUpload(key, b.upload_id).abort().catch(() => {});
  return json({ aborted: true });
}

// --- Same operations for the Container (internal secret, any tenant prefix) ---

export async function internalR2(req: Request, env: Env, op: string): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  if (!key || key.includes("..")) throw new ApiError(400, "E_VALIDATION", "key required");

  if (op === "object" && req.method === "PUT") {
    if (!req.body) throw new ApiError(400, "E_VALIDATION", "empty body");
    const obj = await env.R2_BUCKET.put(key, req.body, {
      httpMetadata: { contentType: req.headers.get("Content-Type") || "application/octet-stream" },
    });
    return json({ key, size: obj?.size ?? 0 });
  }
  if (op === "object" && req.method === "DELETE") {
    await env.R2_BUCKET.delete(key);
    return json({ deleted: key });
  }
  if (op === "multipart" && req.method === "POST") {
    const up = await env.R2_BUCKET.createMultipartUpload(key, {
      httpMetadata: { contentType: url.searchParams.get("content_type") || "application/octet-stream" },
    });
    return json({ upload_id: up.uploadId });
  }
  if (op === "part" && req.method === "PUT") {
    if (!req.body) throw new ApiError(400, "E_VALIDATION", "empty part");
    const done = await env.R2_BUCKET.resumeMultipartUpload(key, url.searchParams.get("upload_id") ?? "")
      .uploadPart(Number(url.searchParams.get("part")), req.body);
    return json({ part: done.partNumber, etag: done.etag });
  }
  if (op === "complete" && req.method === "POST") {
    const b = await body<{ upload_id: string; parts: { part: number; etag: string }[] }>(req);
    const obj = await env.R2_BUCKET.resumeMultipartUpload(key, b.upload_id)
      .complete(b.parts.map((p) => ({ partNumber: p.part, etag: p.etag })));
    return json({ key, size: obj.size });
  }
  throw new ApiError(404, "E_NOT_FOUND", "unknown internal r2 op");
}
