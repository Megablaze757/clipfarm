import { Container, getContainer } from "@cloudflare/containers";
import { apiUrl, internalSecret, type Env } from "./env";

/**
 * The FFmpeg Container (§12). One instance per job, named after the project or
 * render job, so a retry lands on the same instance and a job never shares CPU.
 *
 * Only used when CLIPPER_RUNNER = "container" (Workers Paid). The default is
 * free GitHub Actions runners running the same code (clipper-job.yml).
 *
 * The Container holds no provider keys: database, Groq and AI calls all go
 * through the Worker's /v1/internal routes, authenticated with this secret.
 */
export class FFmpegContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = {
      CLIPPER_API_URL: apiUrl(env),
      CLIPPER_INTERNAL_SECRET: internalSecret(env),
    };
  }

  /**
   * A long transcode gets no inbound requests for minutes at a time, and the
   * default reaction to `sleepAfter` passing is to stop the Container — which
   * would kill the job mid-way. Ask the server whether it is still working
   * and, if so, keep it alive.
   */
  override async onActivityExpired(): Promise<void> {
    try {
      const r = await this.containerFetch("http://container/busy");
      const { busy } = (await r.json()) as { busy?: boolean };
      if (busy) {
        this.renewActivityTimeout();
        return;
      }
    } catch {
      // Not answering: let it stop. The cron sweep re-dispatches stuck jobs.
    }
    await this.stop();
  }
}

/** Starts a job on its own Container. Resolves once the Container accepted it (202). */
export async function dispatchToContainer(env: Env, name: string, path: "/process" | "/render", payload: unknown): Promise<void> {
  const stub = getContainer(env.FFMPEG!, name);
  const r = await stub.fetch(new Request(`http://container${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
  if (!r.ok && r.status !== 409) throw new Error(`container ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
