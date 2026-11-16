import type { Env } from "./env";
import { dbJson } from "./db";
import { dispatchProject, dispatchRender, failStale } from "./jobs";
import { reportUsage } from "./billing";

/** Must match the third entry in wrangler.toml [triggers].crons. */
export const CLIPPER_CRON = "*/10 * * * *";

/**
 * Every ten minutes:
 *  - start queued projects whose tenant now has a free job slot, and re-send
 *    any whose dispatch was lost (the Container never picked it up);
 *  - re-send queued renders;
 *  - fail jobs whose Container died;
 *  - report metered minutes to Stripe.
 */
export async function clipperScheduled(env: Env, _ctx: ExecutionContext): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const jobs: [string, () => Promise<unknown>][] = [
    ["projects", async () => {
      const lost = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const queued = await dbJson<{ id: string }[]>(env,
        `projects?status=eq.queued&deleted_at=is.null&or=(dispatched_at.is.null,dispatched_at.lt.${lost})&select=id&order=created_at.asc&limit=50`);
      for (const p of queued) await dispatchProject(env, p.id).catch((e) => console.error(`dispatch ${p.id}: ${String(e)}`));
    }],
    ["renders", async () => {
      const lost = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const queued = await dbJson<{ id: string }[]>(env,
        `render_jobs?status=eq.queued&queued_at=lt.${lost}&select=id&limit=50`);
      for (const r of queued) await dispatchRender(env, r.id).catch((e) => console.error(`render ${r.id}: ${String(e)}`));
    }],
    ["stale", () => failStale(env)],
    ["usage", () => reportUsage(env)],
  ];
  for (const [name, job] of jobs) {
    try { await job(); } catch (e) { console.error(`[clipper cron] ${name}: ${String(e)}`); }
  }
}
