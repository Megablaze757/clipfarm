export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, idempotency-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, etag",
};

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...headers },
  });

/** Spec §10.4 error envelope. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
    public stage?: string,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown, requestId: string): Response {
  if (e instanceof ApiError) {
    return json({ error: { code: e.code, message: e.message, retryable: e.retryable, stage: e.stage, request_id: requestId } }, e.status);
  }
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[clipper] ${requestId} internal error: ${message}`);
  return json({ error: { code: "E_INTERNAL", message, retryable: true, request_id: requestId } }, 500);
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "E_VALIDATION", "request body must be JSON");
  }
}

export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function requireUuid(s: unknown, what = "id"): string {
  if (!isUuid(s)) throw new ApiError(404, "E_NOT_FOUND", `${what} not found`);
  return s;
}

/** Constant-time string compare for secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
