import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { runTranscode } from './pipeline/transcode'
import { runASR } from './pipeline/asr'
import { generateCandidates } from './pipeline/candidates'
import { scoreCandidates } from './pipeline/scoring'
import { snapBoundaries } from './pipeline/boundaries'
import { renderProxies } from './pipeline/render'

const app = express()
app.use(express.json())

const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', engine: 'Cloudflare Containers FFmpeg v7.1' })
})

app.post('/process', async (req, res) => {
  const { projectId, tenantId, sourceUri } = req.body

  try {
    // 1. Update Project Status: Transcoding
    await supabase.from('projects').update({ status: 'transcoding' }).eq('id', projectId)
    const mezzaninePath = await runTranscode(sourceUri, projectId)

    // 2. ASR & Transcription
    await supabase.from('projects').update({ status: 'transcribing' }).eq('id', projectId)
    const transcript = await runASR(mezzaninePath)
    await supabase.from('transcripts').insert({
      project_id: projectId,
      words: transcript.words,
      segments: transcript.segments,
      speakers: transcript.speakers
    })

    // 3. Candidate Generation & Recall
    await supabase.from('projects').update({ status: 'candidates' }).eq('id', projectId)
    const rawCandidates = generateCandidates(transcript.words)

    // 4. Scoring via Groq / LLM
    await supabase.from('projects').update({ status: 'scoring' }).eq('id', projectId)
    const scoredCandidates = await scoreCandidates(rawCandidates, transcript.words)

    // 5. Boundary Snapping & Fine-tuning
    const snappedCandidates = snapBoundaries(scoredCandidates, transcript.words)

    // 6. Save Candidates & Render Proxies
    for (const cand of snappedCandidates) {
      const proxyUri = await renderProxies(mezzaninePath, cand, projectId)
      await supabase.from('candidates').insert({
        project_id: projectId,
        t_in_ms: cand.t_in_ms,
        t_out_ms: cand.t_out_ms,
        score: cand.score,
        subscores: cand.subscores,
        features: cand.features,
        rationale: cand.rationale,
        proxy_uri: proxyUri,
        scorer_version: 'v1.0.0'
      })
    }

    // 7. Mark Complete
    await supabase.from('projects').update({ status: 'ready' }).eq('id', projectId)

    // Record Usage Event
    await supabase.from('usage_events').insert({
      tenant_id: tenantId,
      project_id: projectId,
      kind: 'ingest',
      quantity: 30,
      idempotency_key: `${projectId}:ingest`
    })

    res.json({ success: true, projectId })
  } catch (err: any) {
    await supabase.from('projects').update({
      status: 'failed',
      error_code: 'E_CONTAINER_PROCESSING_FAILED',
      error_detail: err.message
    }).eq('id', projectId)

    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  console.log(`Clipper FFmpeg Container Service listening on port ${PORT}`)
})
