export interface Env {
  FFMPEG_CONTAINER: any
  R2_BUCKET: R2Bucket
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS handling
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
        }
      })
    }

    // Presign upload URL for R2
    if (url.pathname === '/v1/upload/presign' && request.method === 'POST') {
      const { tenantId, filename } = await request.json() as { tenantId: string; filename: string }
      const key = `${tenantId}/projects/${crypto.randomUUID()}/source/${filename}`
      
      // Dispatch presigned put or key acknowledgment
      return new Response(JSON.stringify({
        r2_key: key,
        upload_url: `https://storage.clipper.video/${key}`
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    // Dispatch video processing jobs to Cloudflare Container
    if (url.pathname === '/v1/jobs/process' && request.method === 'POST') {
      const payload = await request.json()
      const containerId = env.FFMPEG_CONTAINER.idFromName(crypto.randomUUID())
      const containerStub = env.FFMPEG_CONTAINER.get(containerId)
      
      // Asynchronous dispatch to container
      containerStub.fetch('http://container/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      return new Response(JSON.stringify({
        status: 'accepted',
        message: 'Processing enqueued in Container'
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    return new Response(JSON.stringify({ message: 'Clipper Worker API' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
}
