import { createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Client for the Worker's internal routes. The runner holds no credentials of
 * its own: storage goes through the Worker's R2 binding, database writes and
 * Groq transcription through Worker proxies, and AI through the Worker's shared
 * Groq -> OpenRouter -> NVIDIA ladder.
 *
 * Identity: on Cloudflare Containers, a shared secret the Worker passes in as
 * an env var. On GitHub Actions, a GitHub-signed OIDC token minted on demand —
 * no secret stored anywhere.
 */
const API = () => (process.env.CLIPPER_API_URL || "").replace(/\/$/, "");

let oidc: { token: string; at: number } | null = null;
export async function AUTH(): Promise<Record<string, string>> {
  const secret = process.env.CLIPPER_INTERNAL_SECRET;
  if (secret) return { Authorization: `Bearer ${secret}` };
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const reqToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !reqToken) throw new Error("no CLIPPER_INTERNAL_SECRET and not on GitHub Actions with id-token: write");
  // GitHub's tokens are short-lived; mint a fresh one every few minutes.
  if (!oidc || Date.now() - oidc.at > 4 * 60 * 1000) {
    const r = await fetch(`${url}&audience=apex-api`, { headers: { Authorization: `Bearer ${reqToken}` } });
    if (!r.ok) throw new Error(`GitHub OIDC token request failed (${r.status})`);
    oidc = { token: ((await r.json()) as { value: string }).value, at: Date.now() };
  }
  return { Authorization: `Bearer ${oidc.token}` };
}
const PART = 64 * 1024 * 1024; // < Worker's 100 MB body limit, ≥ R2's 5 MiB minimum

async function retry<T>(what: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw new Error(`${what} failed: ${(last as Error)?.message ?? last}`);
}

export async function r2Download(key: string, dest: string): Promise<void> {
  await retry(`download ${key}`, async () => {
    const r = await fetch(`${API()}/v1/internal/r2?key=${encodeURIComponent(key)}`, { headers: await AUTH() });
    if (!r.ok || !r.body) throw new Error(`${r.status}`);
    await pipeline(Readable.fromWeb(r.body as any), createWriteStream(dest));
  });
}

export async function r2Delete(key: string): Promise<void> {
  const r = await fetch(`${API()}/v1/internal/r2?key=${encodeURIComponent(key)}`, { method: "DELETE", headers: await AUTH() });
  if (!r.ok) throw new Error(`delete ${key}: ${r.status}`);
}

export async function r2Upload(key: string, path: string, contentType: string): Promise<void> {
  const size = (await stat(path)).size;
  const fh = await open(path, "r");
  try {
    if (size <= PART) {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      await retry(`upload ${key}`, async () => {
        const r = await fetch(`${API()}/v1/internal/r2?key=${encodeURIComponent(key)}`, {
          method: "PUT", headers: { ...(await AUTH()), "Content-Type": contentType }, body: buf,
        });
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      });
      return;
    }
    const start = await retry("multipart start", async () => {
      const r = await fetch(`${API()}/v1/internal/r2/multipart?key=${encodeURIComponent(key)}&content_type=${encodeURIComponent(contentType)}`, { method: "POST", headers: await AUTH() });
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as { upload_id: string };
    });
    const parts: { part: number; etag: string }[] = [];
    for (let offset = 0, n = 1; offset < size; offset += PART, n++) {
      const len = Math.min(PART, size - offset);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      const done = await retry(`part ${n}`, async () => {
        const r = await fetch(`${API()}/v1/internal/r2/part?key=${encodeURIComponent(key)}&upload_id=${encodeURIComponent(start.upload_id)}&part=${n}`, {
          method: "PUT", headers: await AUTH(), body: buf,
        });
        if (!r.ok) throw new Error(`${r.status}`);
        return (await r.json()) as { part: number; etag: string };
      });
      parts.push(done);
    }
    await retry("multipart complete", async () => {
      const r = await fetch(`${API()}/v1/internal/r2/complete?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { ...(await AUTH()), "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: start.upload_id, parts }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    });
  } finally {
    await fh.close();
  }
}

/** One completion through the shared AI ladder. Null when every provider failed. */
export async function llm(system: string, user: string, maxTokens = 1500): Promise<{ text: string; model: string } | null> {
  try {
    const r = await fetch(`${API()}/v1/internal/complete`, {
      method: "POST",
      headers: { ...(await AUTH()), "Content-Type": "application/json" },
      body: JSON.stringify({ system, user, max_tokens: maxTokens, json: true }),
      signal: AbortSignal.timeout(420_000), // the Worker runs "patient" for batch work (up to ~6 min)
    });
    if (!r.ok) {
      console.warn(`AI ladder unavailable (${r.status}): ${(await r.text()).slice(0, 300)}`);
      return null;
    }
    return (await r.json()) as { text: string; model: string };
  } catch (e) {
    console.warn(`AI ladder unreachable: ${(e as Error).message}`);
    return null;
  }
}

/** Tells the Worker a job slot freed up so the tenant's next queued project starts. */
export async function notifyNext(projectId: string): Promise<void> {
  try { await fetch(`${API()}/v1/internal/projects/${projectId}/next`, { method: "POST", headers: await AUTH() }); } catch { /* best effort */ }
}

export function parseJsonObject<T>(text: string): T | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)) as T; } catch { return null; }
}

// --- Database writes through the Worker (no service-role key on the runner) ---

type DbResult = Promise<{ error: { message: string } | null }>;
async function dbCall(payload: Record<string, unknown>): DbResult {
  try {
    return await retry(`db ${payload.op} ${payload.table}`, async () => {
      const r = await fetch(`${API()}/v1/internal/db`, {
        method: "POST",
        headers: { ...(await AUTH()), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.status >= 500) throw new Error(`${r.status}`);
      if (!r.ok) return { error: { message: `${r.status} ${(await r.text()).slice(0, 200)}` } };
      return (await r.json()) as { error: { message: string } | null };
    }, 3);
  } catch (e) {
    return { error: { message: (e as Error).message } };
  }
}

/** Just the slice of supabase-js the pipeline uses, so the job code reads the same. */
export const db = {
  from(table: string) {
    return {
      insert: (values: unknown) => dbCall({ table, op: "insert", values }),
      upsert: (values: unknown, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) =>
        dbCall({ table, op: "upsert", values, onConflict: opts.onConflict, ignoreDuplicates: !!opts.ignoreDuplicates }),
      update: (values: unknown) => ({ eq: (col: string, val: string | number) => dbCall({ table, op: "update", values, match: { [col]: val } }) }),
      delete: () => ({ eq: (col: string, val: string | number) => dbCall({ table, op: "delete", match: { [col]: val } }) }),
    };
  },
};

/** Groq Whisper via the Worker. Returns the raw Response so ASR can honour 429 / Retry-After. */
export async function transcribeViaWorker(audio: Blob, language: string | null): Promise<Response> {
  const lang = language && language !== "auto" ? `?language=${encodeURIComponent(language)}` : "";
  return fetch(`${API()}/v1/internal/transcribe${lang}`, {
    method: "POST",
    headers: { ...(await AUTH()), "Content-Type": "audio/flac" },
    body: audio,
    signal: AbortSignal.timeout(180_000),
  });
}

/** GitHub runners fetch their job by id. null = already taken / not queued (skip quietly). */
export async function fetchJob<T>(kind: "process" | "render", id: string): Promise<T | null> {
  const r = await fetch(`${API()}/v1/internal/jobs/${kind}/${id}`, { headers: await AUTH() });
  if (r.status === 409) { console.log(`skipping: ${(await r.text()).slice(0, 200)}`); return null; }
  if (!r.ok) throw new Error(`could not fetch ${kind} job ${id}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

/** URL FFmpeg can read an R2 object from (via the Worker, with HTTP Range seeking). */
export const r2Url = (key: string) => `${API()}/v1/internal/r2?key=${encodeURIComponent(key)}`;

/**
 * FFmpeg/ffprobe input options that authenticate to the Worker. Placed before
 * `-i <r2Url>`, they let FFmpeg stream/seek a stored video instead of
 * downloading all of it — an export reads only the seconds it cuts.
 */
export async function ffAuthArgs(): Promise<string[]> {
  const { Authorization } = (await AUTH()) as { Authorization: string };
  return ["-headers", `Authorization: ${Authorization}\r\n`];
}

/**
 * Fast download of a stored object: N parallel HTTP Range requests, each
 * written straight into its slot of the file. One connection through the
 * Worker measured ~20 MB/s (a 1-hour 1080p upload took ~2.5 min to read);
 * eight run several times faster. Falls back to a single stream if the size
 * can't be read.
 */
export async function r2DownloadParallel(key: string, dest: string, connections = 8, chunkBytes = 32 * 1024 * 1024): Promise<number> {
  const head = await fetch(r2Url(key), { headers: { ...(await AUTH()), Range: "bytes=0-0" } });
  const total = Number((head.headers.get("content-range") || "").split("/")[1]);
  await head.body?.cancel().catch(() => {});
  if (!Number.isFinite(total) || total <= 0) { await r2Download(key, dest); return 0; }
  const fh = await open(dest, "w");
  try {
    await fh.truncate(total);
    let next = 0;
    const lane = async () => {
      while (next < total) {
        const start = next;
        const end = Math.min(total, start + chunkBytes) - 1;
        next = end + 1;
        await retry(`range ${start}-${end}`, async () => {
          const r = await fetch(r2Url(key), { headers: { ...(await AUTH()), Range: `bytes=${start}-${end}` } });
          if (r.status !== 206 && r.status !== 200) throw new Error(`${r.status}`);
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length !== end - start + 1) throw new Error(`short read ${buf.length}/${end - start + 1}`);
          await fh.write(buf, 0, buf.length, start);
        });
      }
    };
    await Promise.all(Array.from({ length: connections }, lane));
  } finally {
    await fh.close();
  }
  return total;
}
