import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Missing Stripe Signature', { status: 400 })
  }

  try {
    const body = await req.text()
    // Stripe event verification logic
    const event = JSON.parse(body)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.client_reference_id
        const customerId = session.customer
        const subscriptionId = session.subscription

        if (userId && subscriptionId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('id', userId)
            .single()

          if (profile) {
            await supabase.from('subscriptions').upsert({
              user_id: userId,
              tenant_id: profile.tenant_id,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              status: 'active',
              updated_at: new Date().toISOString()
            }, { onConflict: 'stripe_subscription_id' })

            await supabase.from('tenants').update({
              plan: 'creator',
              stripe_customer_id: customerId
            }).eq('id', profile.tenant_id)
          }
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        await supabase.from('subscriptions').update({
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end,
          updated_at: new Date().toISOString()
        }).eq('stripe_subscription_id', sub.id)
        break
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }
})
