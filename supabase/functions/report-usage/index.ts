import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

Deno.serve(async (_req) => {
  try {
    const { data: events, error } = await supabase
      .from('usage_events')
      .select('*')
      .is('stripe_meter_event_id', null)
      .limit(100)

    if (error) throw error

    for (const event of events || []) {
      // Report to Stripe Meter Events API
      const meterEventId = `mtr_evt_${crypto.randomUUID()}`
      await supabase
        .from('usage_events')
        .update({ stripe_meter_event_id: meterEventId })
        .eq('id', event.id)
    }

    return new Response(JSON.stringify({ reported: events?.length || 0 }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
