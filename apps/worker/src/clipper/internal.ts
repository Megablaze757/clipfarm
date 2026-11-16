import type { Env } from "./env";
import { completeWithFallbacks, modelChain } from "../pocketathlete/index";
import { ApiError, body, json } from "./http";

/**
 * The Container's door to the shared AI ladder.
 *
 * Scoring runs in the Container, but the model keys and the Groq -> OpenRouter
 * -> NVIDIA fallback logic live here, in PocketAthlete's `complete()`. So the
 * Container asks the Worker, and both apps get the same keys, the same
 * fallbacks and the same per-provider deadlines. If every model fails this
 * returns 503 and the Container scores with its built-in heuristics instead.
 */
export async function internalComplete(req: Request, env: Env): Promise<Response> {
  const b = await body<{ system?: string; user?: string; max_tokens?: number; json?: boolean }>(req);
  if (!b.system || !b.user) throw new ApiError(400, "E_VALIDATION", "system and user are required");
  if (!modelChain(env).length) {
    return json({ error: "no AI provider key set (GROQ_SECRET / OPENROUTER_API_KEY / NVIDIA_SECRET)" }, 503);
  }
  try {
    const out = await completeWithFallbacks(env, {
      system: b.system,
      user: b.user.slice(0, 60_000),
      maxTokens: Math.min(Math.max(Number(b.max_tokens) || 1500, 100), 4000),
      json: b.json !== false,
      // Paid rungs first: Clipper scoring is batch work and must not wait on
      // rate-limited free tiers.
      priority: true,
      validate: b.json === false ? undefined : (t) => {
        try { JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); return true; } catch { return false; }
      },
    });
    return json({ text: out.text, model: out.model, cost: out.cost });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 503);
  }
}
