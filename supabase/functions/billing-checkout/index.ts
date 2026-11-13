import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const authHeader = req.headers.get('Authorization')!
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { priceId } = await req.json()

    // In real env, calls Stripe Checkout API session creation
    const checkoutUrl = `https://checkout.stripe.com/pay/cs_test_mock?client_reference_id=${user.id}&price=${priceId}`

    return new Response(JSON.stringify({ url: checkoutUrl }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      status: 200
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 400 })
  }
})
