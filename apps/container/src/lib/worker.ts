import { createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Client for the Worker's internal routes. The Container holds no R2 or AI
 * credentials of its own: storage goes through the Worker's R2 binding and AI
 * goes through the Worker's shared Groq -> OpenRouter -> NVIDIA ladder.
 */
const API = () => (process.env.CLIPPER_API_URL || "").replace(/\/$/, "");
const AUTH = () => ({ Authorization: `Bearer ${process.env.CLIPPER_INTERNAL_SECRET || ""}` });
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
    const r = await fetch(`${API()}/v1/internal/r2?key=${encodeURIComponent(key)}`, { headers: AUTH() });
    if (!r.ok || !r.body) throw new Error(`${r.status}`);
    await pipeline(Readable.fromWeb(r.body as any), createWriteStream(dest));
  });
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
          method: "PUT", headers: { ...AUTH(), "Content-Type": contentType }, body: buf,
        });
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      });
      return;
    }
    const start = await retry("multipart start", async () => {
      const r = await fetch(`${API()}/v1/internal/r2/multipart?key=${encodeURIComponent(key)}&content_type=${encodeURIComponent(contentType)}`, { method: "POST", headers: AUTH() });
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
          method: "PUT", headers: AUTH(), body: buf,
        });
        if (!r.ok) throw new Error(`${r.status}`);
        return (await r.json()) as { part: number; etag: string };
      });
      parts.push(done);
    }
    await retry("multipart complete", async () => {
      const r = await fetch(`${API()}/v1/internal/r2/complete?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { ...AUTH(), "Content-Type": "application/json" },
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
      headers: { ...AUTH(), "Content-Type": "application/json" },
      body: JSON.stringify({ system, user, max_tokens: maxTokens, json: true }),
      signal: AbortSignal.timeout(90_000),
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
  await fetch(`${API()}/v1/internal/projects/${projectId}/next`, { method: "POST", headers: AUTH() }).catch(() => {});
}

export function parseJsonObject<T>(text: string): T | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)) as T; } catch { return null; }
}
