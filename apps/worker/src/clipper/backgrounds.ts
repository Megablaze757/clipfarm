import type { Env } from "./env";
import type { Caller } from "./auth";
import { requireEditor } from "./auth";
import { ApiError, json } from "./http";
import { signedUrl } from "./media";

/**
 * Split-screen background footage: the speaker on top, moving footage below,
 * captions on the seam — the "gameplay under a podcast" layout.
 *
 * Built-ins are generated at render time — game simulations we wrote, or FFmpeg patterns (no stock files, nothing
 * licensed): they're free to use anywhere. For real gameplay, the user uploads
 * their own recording — we never fetch game footage from other sites.
 */
export const BUILTIN_BACKGROUNDS: Record<string, string> = {
  // Our own game simulations (apps/container/src/pipeline/games.ts)
  escape_rings: "Will it escape?",
  grow_ball: "Growing ball",
  ring_bounce: "Ball multiplier",
  plinko: "Plinko drop",
  runner: "Neon runner",
  stacker: "Tower stack",
  // FFmpeg pattern generators
  neon_life: "Neon cells",
  fractal_zoom: "Fractal zoom",
  colour_flow: "Colour flow",
  pixel_rain: "Pixel rain",
};

export type Background = { kind: "none" } | { kind: "builtin"; id: string } | { kind: "upload"; key: string };

const MAX_BYTES = 95 * 1024 * 1024; // Worker request bodies stop at 100 MB
const prefix = (tenantId: string) => `${tenantId}/backgrounds/`;

/** Validates a background choice from the editor (or returns undefined = unchanged). */
export async function checkBackground(env: Env, caller: Caller, b: unknown): Promise<Background | undefined> {
  if (b == null) return undefined;
  const v = b as Record<string, unknown>;
  if (v.kind === "none") return { kind: "none" };
  if (v.kind === "builtin" && typeof v.id === "string" && BUILTIN_BACKGROUNDS[v.id]) return { kind: "builtin", id: v.id };
  if (v.kind === "upload" && typeof v.key === "string" && v.key.startsWith(prefix(caller.tenantId)) && !v.key.includes("..")) {
    if (!(await env.R2_BUCKET.head(v.key))) throw new ApiError(404, "E_NOT_FOUND", "that background video is gone — upload it again");
    return { kind: "upload", key: v.key };
  }
  throw new ApiError(400, "E_VALIDATION", `background must be none, an uploaded video, or one of ${Object.keys(BUILTIN_BACKGROUNDS).join(", ")}`);
}

/** PUT /v1/backgrounds?name=… — body is the video file itself (≤ 95 MB). */
export async function uploadBackground(req: Request, env: Env, caller: Caller): Promise<Response> {
  requireEditor(caller);
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^video\/(mp4|quicktime|webm|x-matroska)$/.test(type)) throw new ApiError(415, "E_INGEST_UNSUPPORTED_CODEC", "upload an MP4, MOV, WebM or MKV video");
  const size = Number(req.headers.get("content-length") ?? "0");
  if (!(size > 0)) throw new ApiError(411, "E_VALIDATION", "content-length required");
  if (size > MAX_BYTES) throw new ApiError(413, "E_INGEST_TOO_LARGE", "background videos must be under 95 MB — trim it to a minute or two");
  const name = (new URL(req.url).searchParams.get("name") ?? "background").replace(/[^\w .-]/g, "").slice(0, 60) || "background";
  const ext = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv" }[type];
  const key = `${prefix(caller.tenantId)}${crypto.randomUUID()}.${ext}`;
  await env.R2_BUCKET.put(key, req.body, { httpMetadata: { contentType: type }, customMetadata: { name } });
  return json({ key, name }, 201);
}

/** GET /v1/backgrounds — built-ins plus this workspace's uploads. */
export async function listBackgrounds(env: Env, caller: Caller): Promise<Response> {
  const listed = env.R2_BUCKET ? await env.R2_BUCKET.list({ prefix: prefix(caller.tenantId), limit: 50, include: ["customMetadata"] } as R2ListOptions) : { objects: [] as R2Object[] };
  const uploads = await Promise.all(listed.objects.map(async (o) => ({
    kind: "upload" as const, key: o.key, name: o.customMetadata?.name ?? "Uploaded video", size: o.size, uploaded: o.uploaded,
    preview_url: await signedUrl(env, o.key, 3600),
  })));
  return json({
    builtin: Object.entries(BUILTIN_BACKGROUNDS).map(([id, name]) => ({ kind: "builtin", id, name })),
    uploads,
  });
}

/**
 * PUT /v1/chat?name=… — a stream's chat log (JSON or timestamped text, ≤ 50 MB),
 * attached to a project as options.chat_key for chat analysis.
 */
export async function uploadChat(req: Request, env: Env, caller: Caller): Promise<Response> {
  requireEditor(caller);
  const size = Number(req.headers.get("content-length") ?? "0");
  if (!(size > 0)) throw new ApiError(411, "E_VALIDATION", "content-length required");
  if (size > 50 * 1024 * 1024) throw new ApiError(413, "E_INGEST_TOO_LARGE", "chat logs must be under 50 MB");
  const name = (new URL(req.url).searchParams.get("name") ?? "chat").replace(/[^\w .-]/g, "").slice(0, 60) || "chat";
  const key = `${caller.tenantId}/chat/${crypto.randomUUID()}.log`;
  await env.R2_BUCKET.put(key, req.body, { httpMetadata: { contentType: "text/plain; charset=utf-8" }, customMetadata: { name } });
  return json({ key, name }, 201);
}
