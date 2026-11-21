import { apiUrl, appUrl, stripeKey, type Env } from "./env";
import type { Caller } from "./auth";
import { dbJson, dbOne, dbPatch } from "./db";
import { ApiError, body, json } from "./http";
import { PLANS, type Plan } from "./plans";
import { planForStripePrice, stripePrice, stripeWebhookSecret, updateSettings, getSettings } from "./settings";

/**
 * Stripe for Clipper (§15). Everything Clipper puts on a Stripe object is
 * tagged metadata[app]=clipper and keyed by tenant_id — never metadata[user_id]
 * — so if Clipper and PocketAthlete share a Stripe account, PocketAthlete's own
 * webhook (which keys on user_id) ignores Clipper's events and vice versa.
 */
async function stripe<T = any>(env: Env, path: string, params?: Record<string, string>, method?: string): Promise<T> {
  const key = stripeKey(env);
  if (!key) throw new ApiError(503, "E_NOT_CONFIGURED", "Stripe is not configured on the Worker");
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: method ?? (params ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const j = (await r.json()) as any;
  if (!r.ok) throw new ApiError(502, "E_STRIPE", `stripe ${r.status}: ${j?.error?.message ?? "error"}`, r.status >= 500);
  return j as T;
}

async function customerFor(env: Env, caller: Caller): Promise<string> {
  const tenant = await dbOne<{ stripe_customer_id: string | null; name: string }>(
    env, `tenants?id=eq.${caller.tenantId}&select=stripe_customer_id,name`);
  if (tenant?.stripe_customer_id) return tenant.stripe_customer_id;
  const customer = await stripe<{ id: string }>(env, "customers", {
    email: caller.email,
    name: tenant?.name ?? caller.email,
    "metadata[app]": "clipper",
    "metadata[tenant_id]": caller.tenantId,
  });
  await dbPatch(env, `tenants?id=eq.${caller.tenantId}`, { stripe_customer_id: customer.id });
  return customer.id;
}

export async function checkout(req: Request, env: Env, caller: Caller): Promise<Response> {
  if (caller.guest) throw new ApiError(401, "E_UNAUTHORIZED", "sign in to upgrade — guest mode is for testing");
  if (caller.role !== "owner") throw new ApiError(403, "E_FORBIDDEN", "only the workspace owner can change the plan");
  const { plan } = await body<{ plan?: Plan["id"] }>(req);
  const price = plan ? await stripePrice(env, plan) : undefined;
  if (!plan || !price) throw new ApiError(400, "E_VALIDATION", `payments aren't set up for the "${plan}" plan yet — an admin can do it in Admin → Payments`);
  const live = await dbOne<{ id: string }>(env,
    `subscriptions?tenant_id=eq.${caller.tenantId}&status=in.(active,trialing,past_due)&select=id`);
  if (live) throw new ApiError(409, "E_ALREADY_SUBSCRIBED", "this workspace already has a subscription — change it from the billing portal");

  const customer = await customerFor(env, caller);
  const app = appUrl(env);
  const params: Record<string, string> = {
    mode: "subscription",
    customer,
    client_reference_id: caller.tenantId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${app}/settings/billing?checkout=success`,
    cancel_url: `${app}/settings/billing?checkout=cancelled`,
    "metadata[app]": "clipper",
    "metadata[tenant_id]": caller.tenantId,
    "metadata[plan]": plan,
    "subscription_data[metadata][app]": "clipper",
    "subscription_data[metadata][tenant_id]": caller.tenantId,
    "subscription_data[metadata][plan]": plan,
    "subscription_data[metadata][user]": caller.userId,
  };
  if (env.CLIPPER_PRICE_METERED) params["line_items[1][price]"] = env.CLIPPER_PRICE_METERED; // metered: no quantity
  const session = await stripe<{ url: string }>(env, "checkout/sessions", params);
  return json({ url: session.url });
}

export async function portal(env: Env, caller: Caller): Promise<Response> {
  if (caller.guest) throw new ApiError(401, "E_UNAUTHORIZED", "sign in to manage billing");
  const tenant = await dbOne<{ stripe_customer_id: string | null }>(env, `tenants?id=eq.${caller.tenantId}&select=stripe_customer_id`);
  if (!tenant?.stripe_customer_id) throw new ApiError(404, "E_NO_BILLING_ACCOUNT", "no billing account yet — upgrade first");
  const app = appUrl(env);
  const session = await stripe<{ url: string }>(env, "billing_portal/sessions", {
    customer: tenant.stripe_customer_id,
    return_url: `${app}/settings/billing?billing=return`,
  });
  return json({ url: session.url });
}

// --- Webhook (§15.3) ---------------------------------------------------------

async function verifyStripe(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts["t"];
  const sigs = header.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((v1) => {
    if (v1.length !== hex.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  });
}

export async function webhook(req: Request, env: Env): Promise<Response> {
  const secret = await stripeWebhookSecret(env);
  if (!secret) return json({ error: "payments aren't set up yet (Admin → Payments)" }, 503);
  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!(await verifyStripe(payload, sig, secret))) return new Response("bad signature", { status: 400 });
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: any } };
  const obj = event.data.object;
  try {
    if (event.type === "checkout.session.completed" && obj.metadata?.app === "clipper" && obj.subscription) {
      await upsertSubscription(env, await stripe(env, `subscriptions/${obj.subscription}`));
    } else if (event.type.startsWith("customer.subscription.") && obj.metadata?.app === "clipper") {
      await upsertSubscription(env, obj);
    }
  } catch (e) {
    // 500 makes Stripe retry (for up to 3 days); the upsert is idempotent.
    console.error(`[clipper stripe] ${event.type} ${event.id} failed: ${String(e)}`);
    return json({ error: String(e) }, 500);
  }
  return json({ received: true });
}

async function upsertSubscription(env: Env, sub: any): Promise<void> {
  const tenantId = sub.metadata?.tenant_id;
  if (!tenantId) return;
  const item = (sub.items?.data ?? []).find((i: any) => i.price?.recurring?.usage_type !== "metered") ?? sub.items?.data?.[0];
  const plan = (await planForStripePrice(env, item?.price?.id)) ?? sub.metadata?.plan ?? "creator";
  const active = ["active", "trialing", "past_due"].includes(sub.status);
  const periodEnd = sub.current_period_end ?? item?.current_period_end;
  await dbJson(env, "subscriptions?on_conflict=stripe_subscription_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      tenant_id: tenantId,
      user_id: sub.metadata?.user ?? null,
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: item?.price?.id ?? null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    }]),
  });
  await dbPatch(env, `tenants?id=eq.${tenantId}`, { plan: active ? plan : "free", stripe_customer_id: sub.customer });
}

// --- Metered usage (§15.4) ----------------------------------------------------

/** Reports unreported ingest minutes to Stripe's Meter Events API. Idempotent via `identifier`. */
export async function reportUsage(env: Env): Promise<void> {
  if (!stripeKey(env)) return;
  const events = await dbJson<{ id: string; tenant_id: string; quantity: number; idempotency_key: string }[]>(env,
    "usage_events?kind=eq.ingest&stripe_meter_event_id=is.null&select=id,tenant_id,quantity,idempotency_key&order=created_at.asc&limit=200");
  if (!events.length) return;
  const tenants = await dbJson<{ id: string; stripe_customer_id: string | null; plan: string }[]>(env,
    `tenants?id=in.(${[...new Set(events.map((e) => e.tenant_id))].join(",")})&select=id,stripe_customer_id,plan`);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const eventName = env.CLIPPER_METER_EVENT || "clipper_source_minutes";
  for (const ev of events) {
    const t = byId.get(ev.tenant_id);
    let marker: string;
    if (!t?.stripe_customer_id || t.plan === "free" || !env.CLIPPER_PRICE_METERED) {
      marker = "not_billed"; // free tier, or metering not switched on — included in plan
    } else {
      try {
        const r = await stripe<{ identifier: string }>(env, "billing/meter_events", {
          event_name: eventName,
          identifier: ev.idempotency_key,
          "payload[stripe_customer_id]": t.stripe_customer_id,
          "payload[value]": String(Math.ceil(Number(ev.quantity))),
        });
        marker = r.identifier ?? ev.idempotency_key;
      } catch (e) {
        console.error(`[clipper usage] ${ev.id}: ${String(e)}`);
        continue; // retried next run
      }
    }
    await dbPatch(env, `usage_events?id=eq.${ev.id}`, { stripe_meter_event_id: marker });
  }
}

// --- One-click setup (Admin → Payments) --------------------------------------

/**
 * Creates Clipper's product and one monthly price per paid plan in the Stripe
 * account the Worker already holds a key for, plus the webhook endpoint that
 * keeps plans in sync — and stores the IDs and webhook secret in the Worker's
 * settings. Safe to run again: existing prices/webhook are reused.
 */
export async function setupStripe(env: Env): Promise<Record<string, unknown>> {
  const key = stripeKey(env);
  if (!key) throw new ApiError(503, "E_NOT_CONFIGURED", "no Stripe secret key on the Worker (STRIPE_SECRET_KEY)");
  const mode = key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : "test";
  const current = (await getSettings(env)).stripe ?? {};
  let productId = current.product_id;
  if (!productId) {
    const product = await stripe<{ id: string }>(env, "products", {
      name: "Clipper", description: "Long videos and streams into viral short clips", "metadata[app]": "clipper",
    });
    productId = product.id;
  }
  const prices = { ...(current.prices ?? {}) };
  for (const id of ["creator", "team", "agency"] as const) {
    if (prices[id]) continue;
    const plan = PLANS[id];
    if (!plan.priceUsd) continue;
    const price = await stripe<{ id: string }>(env, "prices", {
      product: productId, currency: "usd", unit_amount: String(Math.round(plan.priceUsd * 100)),
      "recurring[interval]": "month", nickname: `Clipper ${plan.label}`,
      "metadata[app]": "clipper", "metadata[plan]": id, lookup_key: `clipper_${id}_monthly`,
    });
    prices[id] = price.id;
  }
  let webhookId = current.webhook_id, webhookSecret = current.webhook_secret;
  if (!webhookId || !webhookSecret) {
    const wh = await stripe<{ id: string; secret: string }>(env, "webhook_endpoints", {
      url: `${apiUrl(env)}/v1/webhooks/stripe`,
      description: "Clipper subscriptions",
      "enabled_events[0]": "checkout.session.completed",
      "enabled_events[1]": "customer.subscription.created",
      "enabled_events[2]": "customer.subscription.updated",
      "enabled_events[3]": "customer.subscription.deleted",
      "metadata[app]": "clipper",
    });
    webhookId = wh.id; webhookSecret = wh.secret;
  }
  await updateSettings(env, (s) => ({
    ...s,
    stripe: { mode, product_id: productId, prices, webhook_id: webhookId, webhook_secret: webhookSecret, set_up_at: new Date().toISOString() },
  }));
  return { mode, product_id: productId, prices, webhook_id: webhookId };
}

/** Clipper's subscriptions as Stripe sees them (for the admin Money tab). */
export async function stripeOverview(env: Env): Promise<Record<string, unknown>> {
  const key = stripeKey(env);
  const s = (await getSettings(env)).stripe ?? {};
  return {
    key_present: !!key,
    mode: key ? (key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : "test") : null,
    set_up: !!(s.prices?.creator && s.webhook_secret) || !!(env.CLIPPER_PRICE_CREATOR && env.CLIPPER_STRIPE_WEBHOOK_SECRET),
    prices: { creator: await stripePrice(env, "creator") ?? null, team: await stripePrice(env, "team") ?? null, agency: await stripePrice(env, "agency") ?? null },
    webhook_id: s.webhook_id ?? null,
    set_up_at: s.set_up_at ?? null,
  };
}
