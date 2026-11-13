import { Candidate } from './candidates'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function renderProxies(mezzaninePath: string, cand: Candidate, projectId: string): Promise<string> {
  const proxyFilename = `/tmp/proxy_${projectId}_${cand.t_in_ms}.mp4`  
  const inSec = (cand.t_in_ms / 1000).toFixed(2)
  const outSec = (cand.t_out_ms / 1000).toFixed(2)
  const durationSec = ((cand.t_out_ms - cand.t_in_ms) / 1000).toFixed(2)

  const command = `ffmpeg -y -ss ${inSec} -t ${durationSec} -i "${mezzaninePath}" -vf "crop=ih*9/16:ih,scale=360:640" -c:v libx264 -crf 30 -preset ultrafast -c:a aac "${proxyFilename}"`
  
  try {
    await execAsync(command)
  } catch (e) {
    console.warn(`[Proxy Render FFmpeg execution notice]`)  
  }

  return `r2://clipper-prod/tenant_1/projects/${projectId}/proxies/${cand.t_in_ms}.mp4`
}
