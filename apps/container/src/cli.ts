/**
 * GitHub Actions entry point (.github/workflows/clipper-job.yml):
 *
 *   node dist/cli.js process <projectId>
 *   node dist/cli.js render  <renderJobId>
 *
 * The dispatch event only carries the id. The job itself is fetched from the
 * Worker, which checks this run's GitHub OIDC token — so the public run log
 * never contains anything sensitive, and the repo needs no secrets.
 */
import { fetchJob } from "./lib/worker";
import { processProject, renderJob, type ProcessJob, type RenderJob } from "./jobs";

async function main() {
  const [kind, id] = process.argv.slice(2);
  if ((kind !== "process" && kind !== "render") || !/^[0-9a-f-]{36}$/i.test(id ?? "")) {
    console.error("usage: cli.js process|render <uuid>");
    process.exit(2);
  }
  if (!process.env.CLIPPER_API_URL) throw new Error("CLIPPER_API_URL is not set");
  if (kind === "process") {
    const job = await fetchJob<ProcessJob>("process", id);
    if (job) await processProject(job);
  } else {
    const job = await fetchJob<RenderJob>("render", id);
    if (job) await renderJob(job);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
