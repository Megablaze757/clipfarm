import express from "express";
import { processProject, renderJob, type ProcessJob, type RenderJob } from "./jobs";

const app = express();
app.use(express.json({ limit: "20mb" }));

/** One job per Container instance (the Worker names instances per job). */
let current: { id: string; kind: "process" | "render"; startedAt: number } | null = null;

app.get("/health", (_req, res) => res.json({ status: "ok", busy: !!current, job: current }));
// The Worker's Container class polls this before letting the instance sleep.
app.get("/busy", (_req, res) => res.json({ busy: !!current }));

app.post("/process", (req, res) => {
  const job = req.body as ProcessJob;
  if (!job?.projectId) return res.status(400).json({ error: "projectId required" });
  if (current) return res.status(current.id === job.projectId ? 202 : 409).json({ busy: current });
  current = { id: job.projectId, kind: "process", startedAt: Date.now() };
  res.status(202).json({ accepted: job.projectId });
  processProject(job).finally(() => { current = null; });
});

app.post("/render", (req, res) => {
  const job = req.body as RenderJob;
  if (!job?.jobId) return res.status(400).json({ error: "jobId required" });
  if (current) return res.status(current.id === job.jobId ? 202 : 409).json({ busy: current });
  current = { id: job.jobId, kind: "render", startedAt: Date.now() };
  res.status(202).json({ accepted: job.jobId });
  renderJob(job).finally(() => { current = null; });
});

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, () => console.log(`Clipper container listening on ${PORT}`));
