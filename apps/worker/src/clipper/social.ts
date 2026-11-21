import { apiUrl, appUrl, internalSecret, type Env } from "./env";
import type { Caller } from "./auth";
import { requireEditor } from "./auth";
import { dbInsert, dbOne } from "./db";
import { ApiError, body, json, requireUuid } from "./http";
import { signedUrl } from "./media";

/**
 * POST TO YOUTUBE / TIKTOK / INSTAGRAM — through each platform's OFFICIAL API,
 * with the user's own account connected by OAuth. Nothing is posted without
 * the user choosing to, and every post can be scheduled.
 *
 *   YouTube Shorts  YouTube Data API v3, resumable upload to the user's channel.
 *   TikTok          Content Posting API, "upload to inbox": the video lands in
 *                   the user's TikTok drafts to finish posting in the app (what
 *                   TikTok allows apps before its audit; Direct Post needs one).
 *   Instagram Reels Graph API: Reels container from the clip's URL, then publish
 *                   (needs an Instagram professional account linked to a Page).
 *
 * Each needs the operator's developer app keys as Worker secrets:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET,
 *   META_APP_ID / META_APP_SECRET — with redirect URI <API>/v1/connect/<platform>/callback.
 *
 * Tokens are stored ENCRYPTED (AES-GCM, key derived from the Worker's internal
 * secret) in the private bucket, one file per workspace + platform.
 */
export const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];
const LABEL: Record<Platform, string> = { youtube: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram Reels" };

const v = (env: Env, k: string) => String((env as unknown as Record<string, unknown>)[k] ?? "").trim();
const creds = (env: Env, p: Platform) =>
  p === "youtube" ? { id: v(env, "GOOGLE_CLIENT_ID"), secret: v(env, "GOOGLE_CLIENT_SECRET") }
  : p === "tiktok" ? { id: v(env, "TIKTOK_CLIENT_KEY"), secret: v(env, "TIKTOK_CLIENT_SECRET") }
  : { id: v(env, "META_APP_ID"), secret: v(env, "META_APP_SECRET") };
const redirect = (env: Env, p: Platform) => `${apiUrl(env)}/v1/connect/${p}/callback`;

// --- crypto -------------------------------------------------------------------
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function aesKey(env: Env): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`clipper-social:${internalSecret(env)}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env: Env, data: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(JSON.stringify(data))));
  return `${b64(iv)}.${b64(ct)}`;
}
async function open<T>(env: Env, sealed: string): Promise<T> {
  const [iv, ct] = sealed.split(".");
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct)))) as T;
}
async function sign(env: Env, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(internalSecret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)))).replace(/[+/=]/g, "");
}

// --- token storage -----------------------------------------------------------
interface Conn { platform: Platform; access_token: string; refresh_token?: string; expires_at?: number; account?: string; account_id?: string; connected_at: string }
const connKey = (tenant: string, p: Platform) => `_clipper/connections/${tenant}/${p}.sealed`;
async function getConn(env: Env, tenant: string, p: Platform): Promise<Conn | null> {
  const o = await env.R2_BUCKET.get(connKey(tenant, p));
  return o ? open<Conn>(env, await o.text()) : null;
}
async function putConn(env: Env, tenant: string, c: Conn): Promise<void> {
  await env.R2_BUCKET.put(connKey(tenant, c.platform), await seal(env, c));
}

/** GET /v1/connections — what's connected, and which platforms the operator has set up. */
export async function listConnections(env: Env, caller: Caller): Promise<Response> {
  const out = await Promise.all(PLATFORMS.map(async (p) => {
    const c = await getConn(env, caller.tenantId, p).catch(() => null);
    return { platform: p, label: LABEL[p], available: !!(creds(env, p).id && creds(env, p).secret), connected: !!c, account: c?.account ?? null, connected_at: c?.connected_at ?? null };
  }));
  return json({ connections: out });
}

export async function disconnect(env: Env, caller: Caller, p: string): Promise<Response> {
  requireEditor(caller);
  if (!PLATFORMS.includes(p as Platform)) throw new ApiError(404, "E_NOT_FOUND", "unknown platform");
  await env.R2_BUCKET.delete(connKey(caller.tenantId, p as Platform));
  return json({ disconnected: true });
}

/** GET /v1/connect/:platform — the platform's consent page URL. */
export async function connectStart(env: Env, caller: Caller, p: string): Promise<Response> {
  requireEditor(caller);
  if (caller.guest) throw new ApiError(401, "E_UNAUTHORIZED", "sign in to connect your accounts");
  if (!PLATFORMS.includes(p as Platform)) throw new ApiError(404, "E_NOT_FOUND", "unknown platform");
  const platform = p as Platform, c = creds(env, platform);
  if (!c.id || !c.secret) throw new ApiError(503, "E_NOT_CONFIGURED", `${LABEL[platform]} isn't set up on this server yet (missing app keys).`);
  const payload = `${caller.tenantId}.${platform}.${Date.now() + 15 * 60_000}.${crypto.randomUUID().slice(0, 8)}`;
  const state = `${payload}.${await sign(env, payload)}`;
  const r = redirect(env, platform);
  const url = platform === "youtube"
    ? `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: c.id, redirect_uri: r, response_type: "code", access_type: "offline", prompt: "consent", include_granted_scopes: "true", scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly", state })}`
    : platform === "tiktok"
      ? `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: c.id, redirect_uri: r, response_type: "code", scope: "user.info.basic,video.upload", state })}`
      : `https://www.facebook.com/v19.0/dialog/oauth?${new URLSearchParams({ client_id: c.id, redirect_uri: r, response_type: "code", scope: "instagram_basic,instagram_content_publish,pages_show_list,business_management", state })}`;
  return json({ url });
}

/** GET /v1/connect/:platform/callback — the platform sends the user back here. */
export async function connectCallback(req: Request, env: Env, p: string): Promise<Response> {
  const u = new URL(req.url);
  const back = (q: string) => Response.redirect(`${appUrl(env)}/settings/connections?${q}`, 302);
  if (!PLATFORMS.includes(p as Platform)) return back("error=unknown");
  const platform = p as Platform;
  const state = u.searchParams.get("state") ?? "", code = u.searchParams.get("code") ?? "";
  if (u.searchParams.get("error") || !code) return back(`error=${encodeURIComponent(u.searchParams.get("error_description") ?? u.searchParams.get("error") ?? "cancelled")}`);
  const parts = state.split(".");
  const sig = parts.pop() ?? "", payload = parts.join(".");
  const [tenant, sp, exp] = parts;
  if (sp !== platform || Number(exp) < Date.now() || sig !== (await sign(env, payload))) return back("error=expired");
  const c = creds(env, platform), r = redirect(env, platform);
  try {
    let conn: Conn;
    if (platform === "youtube") {
      const t = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: r, grant_type: "authorization_code" }) })).json() as any;
      if (!t.access_token) throw new Error(t.error_description ?? t.error ?? "token exchange failed");
      const ch = await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${t.access_token}` } })).json() as any;
      conn = { platform, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, account: ch.items?.[0]?.snippet?.title ?? "YouTube channel", account_id: ch.items?.[0]?.id, connected_at: new Date().toISOString() };
    } else if (platform === "tiktok") {
      const t = await (await fetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: c.id, client_secret: c.secret, code, grant_type: "authorization_code", redirect_uri: r }) })).json() as any;
      if (!t.access_token) throw new Error(t.error_description ?? t.error ?? "token exchange failed");
      const me = await (await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name", { headers: { Authorization: `Bearer ${t.access_token}` } })).json() as any;
      conn = { platform, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in ?? 86400) * 1000, account: me.data?.user?.display_name ?? "TikTok account", account_id: t.open_id, connected_at: new Date().toISOString() };
    } else {
      const t = await (await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${new URLSearchParams({ client_id: c.id, client_secret: c.secret, redirect_uri: r, code })}`)).json() as any;
      if (!t.access_token) throw new Error(t.error?.message ?? "token exchange failed");
      // Long-lived user token (~60 days), then the Instagram account behind the user's Page.
      const ll = await (await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: c.id, client_secret: c.secret, fb_exchange_token: t.access_token })}`)).json() as any;
      const token = ll.access_token ?? t.access_token;
      const pages = await (await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=name,instagram_business_account{id,username}&access_token=${token}`)).json() as any;
      const ig = (pages.data ?? []).map((pg: any) => pg.instagram_business_account).find(Boolean);
      if (!ig) throw new Error("no Instagram professional account is linked to your Facebook Pages");
      conn = { platform, access_token: token, expires_at: Date.now() + (ll.expires_in ?? 5_184_000) * 1000, account: `@${ig.username}`, account_id: ig.id, connected_at: new Date().toISOString() };
    }
    await putConn(env, tenant, conn);
    return back(`connected=${platform}`);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
  }
}

/** A fresh access token (refreshing YouTube's / TikTok's when they've expired). */
async function token(env: Env, tenant: string, p: Platform): Promise<Conn> {
  const conn = await getConn(env, tenant, p);
  if (!conn) throw new Error(`${LABEL[p]} isn't connected`);
  if (!conn.expires_at || conn.expires_at > Date.now() + 120_000 || !conn.refresh_token) return conn;
  const c = creds(env, p);
  const t = p === "youtube"
    ? await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: conn.refresh_token, grant_type: "refresh_token" }) })).json() as any
    : await (await fetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: c.id, client_secret: c.secret, refresh_token: conn.refresh_token, grant_type: "refresh_token" }) })).json() as any;
  if (!t.access_token) throw new Error(`${LABEL[p]} needs reconnecting (${t.error_description ?? t.error ?? "refresh failed"})`);
  const next = { ...conn, access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000 };
  await putConn(env, tenant, next);
  return next;
}

// --- posts ---------------------------------------------------------------------
export interface Post {
  id: string; tenant_id: string; clip_id: string; media_key: string;
  platform: Platform; title: string; caption: string; privacy?: "public" | "unlisted" | "private";
  scheduled_for: string; status: "scheduled" | "posting" | "posted" | "failed"; result?: string; error?: string; created_at: string;
  /** Who posted it (feedback rows need a real user) and when it went live. */
  user_id?: string; posted_at?: string;
  /** Measured once, ~48 h after posting (measurePosts). */
  views?: number; measured_at?: string; verdict?: "good" | "flopped" | "neutral";
}
const postKey = (id: string) => `_clipper/posts/${id}.json`;
const mediaKey = (id: string) => `_clipper/postmedia/${id}.mp4`;

async function publish(env: Env, post: Post): Promise<string> {
  const conn = await token(env, post.tenant_id, post.platform);
  const obj = await env.R2_BUCKET.get(post.media_key);
  if (!obj) throw new Error("the clip file is gone (posts can be scheduled up to 6 days ahead)");
  const size = obj.size;
  if (post.platform === "youtube") {
    const title = post.title.slice(0, 95) + (/#shorts/i.test(post.title + post.caption) ? "" : " #Shorts");
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
      body: JSON.stringify({ snippet: { title: title.slice(0, 100), description: post.caption.slice(0, 4900), categoryId: "22" }, status: { privacyStatus: post.privacy ?? "public", selfDeclaredMadeForKids: false } }),
    });
    const loc = init.headers.get("location");
    if (!init.ok || !loc) throw new Error(`YouTube refused the upload (${init.status}): ${(await init.text()).slice(0, 200)}`);
    const up = await fetch(loc, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size) }, body: obj.body });
    const j = await up.json().catch(() => ({})) as any;
    if (!up.ok || !j.id) throw new Error(`YouTube upload failed (${up.status}): ${JSON.stringify(j).slice(0, 200)}`);
    return `https://youtube.com/shorts/${j.id}`;
  }
  if (post.platform === "tiktok") {
    const init = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
      method: "POST", headers: { Authorization: `Bearer ${conn.access_token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 } }),
    });
    const j = await init.json() as any;
    if (!init.ok || !j.data?.upload_url) throw new Error(`TikTok refused the upload: ${j.error?.message ?? init.status}`);
    const up = await fetch(j.data.upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` }, body: obj.body });
    if (!up.ok) throw new Error(`TikTok upload failed (${up.status})`);
    return "Sent to your TikTok inbox — open TikTok to add the caption and post";
  }
  // Instagram: the Graph API fetches the video from a URL, so hand it a signed one.
  await obj.body?.cancel();
  const url = await signedUrl(env, post.media_key, 3600);
  const create = await (await fetch(`https://graph.facebook.com/v19.0/${conn.account_id}/media`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", video_url: url, caption: `${post.title}\n\n${post.caption}`.slice(0, 2200), access_token: conn.access_token }),
  })).json() as any;
  if (!create.id) throw new Error(`Instagram refused the Reel: ${create.error?.message ?? "unknown error"}`);
  for (let i = 0; i < 40; i++) {
    const st = await (await fetch(`https://graph.facebook.com/v19.0/${create.id}?fields=status_code&access_token=${conn.access_token}`)).json() as any;
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR") throw new Error("Instagram couldn't process the video");
    await new Promise((r) => setTimeout(r, 3000));
  }
  const pub = await (await fetch(`https://graph.facebook.com/v19.0/${conn.account_id}/media_publish`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creation_id: create.id, access_token: conn.access_token }),
  })).json() as any;
  if (!pub.id) throw new Error(`Instagram didn't publish: ${pub.error?.message ?? "unknown error"}`);
  return `Posted to Instagram (${pub.id})`;
}

async function runPost(env: Env, post: Post): Promise<Post> {
  post.status = "posting";
  await env.R2_BUCKET.put(postKey(post.id), JSON.stringify(post));
  try { post.result = await publish(env, post); post.status = "posted"; post.posted_at = new Date().toISOString(); }
  catch (e) { post.status = "failed"; post.error = (e as Error).message.slice(0, 300); }
  await env.R2_BUCKET.put(postKey(post.id), JSON.stringify(post));
  return post;
}

/** POST /v1/clips/:id/posts {render_id, platforms[], title, caption, privacy?, schedule_at?} */
export async function createPosts(req: Request, env: Env, caller: Caller, clipId: string, ctx: ExecutionContext): Promise<Response> {
  requireEditor(caller);
  if (caller.guest) throw new ApiError(401, "E_UNAUTHORIZED", "sign in to post to your accounts");
  const b = await body<{ render_id?: string; platforms?: string[]; title?: string; caption?: string; privacy?: string; schedule_at?: string }>(req);
  const render = await dbOne<{ id: string; uri: string | null; status: string; tenant_id: string; clip_id: string }>(env,
    `render_jobs?id=eq.${requireUuid(b.render_id, "export")}&clip_id=eq.${requireUuid(clipId, "clip")}&tenant_id=eq.${caller.tenantId}&select=id,uri,status,tenant_id,clip_id`);
  if (!render?.uri || render.status !== "completed") throw new ApiError(409, "E_CONFLICT", "export the clip first (exports are kept 24 h)");
  const platforms = (b.platforms ?? []).filter((p): p is Platform => PLATFORMS.includes(p as Platform));
  if (!platforms.length) throw new ApiError(400, "E_VALIDATION", "pick at least one platform");
  const when = b.schedule_at ? new Date(b.schedule_at) : new Date();
  if (Number.isNaN(when.getTime())) throw new ApiError(400, "E_VALIDATION", "bad schedule time");
  if (when.getTime() > Date.now() + 6 * 86_400_000) throw new ApiError(400, "E_VALIDATION", "posts can be scheduled up to 6 days ahead");
  const out: Post[] = [];
  for (const platform of platforms) {
    if (!(await getConn(env, caller.tenantId, platform))) throw new ApiError(409, "E_NOT_CONNECTED", `connect ${LABEL[platform]} first (Settings → Connections)`);
    const id = crypto.randomUUID();
    // Its own copy of the MP4 — exports are deleted after 24 h, a scheduled post can't be.
    await env.R2_BUCKET.put(mediaKey(id), (await env.R2_BUCKET.get(render.uri))!.body, { httpMetadata: { contentType: "video/mp4" } });
    const post: Post = {
      id, tenant_id: caller.tenantId, clip_id: clipId, media_key: mediaKey(id), platform,
      title: String(b.title ?? "").slice(0, 100) || "New clip", caption: String(b.caption ?? "").slice(0, 2000),
      privacy: (["public", "unlisted", "private"].includes(String(b.privacy)) ? b.privacy : "public") as Post["privacy"],
      scheduled_for: when.toISOString(), status: "scheduled", created_at: new Date().toISOString(), user_id: caller.userId,
    };
    await env.R2_BUCKET.put(postKey(id), JSON.stringify(post));
    out.push(post);
  }
  const now = out.filter((p) => new Date(p.scheduled_for).getTime() <= Date.now() + 30_000);
  if (now.length) ctx.waitUntil(Promise.all(now.map((p) => runPost(env, p))).then(() => {}));
  return json({ posts: out.map(({ media_key: _m, ...p }) => p) }, 201);
}

/** GET /v1/clips/:id/posts — this clip's posts and their status. */
export async function listPosts(env: Env, caller: Caller, clipId: string): Promise<Response> {
  const listed = await env.R2_BUCKET.list({ prefix: "_clipper/posts/", limit: 1000 });
  const posts: Omit<Post, "media_key">[] = [];
  for (const o of listed.objects) {
    const p = (await (await env.R2_BUCKET.get(o.key))?.json().catch(() => null)) as Post | null;
    if (p && p.tenant_id === caller.tenantId && p.clip_id === clipId) { const { media_key: _m, ...rest } = p; posts.push(rest); }
  }
  return json({ posts: posts.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)) });
}

/** Cron: publish whatever is due; tidy up a week later. */
export async function runDuePosts(env: Env): Promise<void> {
  const listed = await env.R2_BUCKET.list({ prefix: "_clipper/posts/", limit: 1000 });
  for (const o of listed.objects) {
    const p = (await (await env.R2_BUCKET.get(o.key))?.json().catch(() => null)) as Post | null;
    if (!p) continue;
    const due = new Date(p.scheduled_for).getTime();
    if (p.status === "scheduled" && due <= Date.now()) await runPost(env, p);
    else if (p.status !== "scheduled" && due < Date.now() - 7 * 86_400_000) {
      await env.R2_BUCKET.delete([o.key, p.media_key]);
    }
  }
}

/**
 * AUTOMATIC RESULTS — ~48 h after a clip goes up on YouTube, fetch its views
 * (YouTube Data API, with the user's own connection) and turn them into the
 * same "did well" / "flopped" signal the editor's buttons give, judged
 * against that workspace's OTHER posted clips (a 300-view channel and a
 * 300k one are each judged against themselves). Measured once per post.
 */
export async function measurePosts(env: Env): Promise<void> {
  const listed = await env.R2_BUCKET.list({ prefix: "_clipper/posts/", limit: 1000 });
  const all: Post[] = [];
  for (const o of listed.objects) {
    const p = (await (await env.R2_BUCKET.get(o.key))?.json().catch(() => null)) as Post | null;
    if (p) all.push(p);
  }
  const due = all.filter((p) => p.platform === "youtube" && p.status === "posted" && !p.measured_at && p.posted_at
    && Date.now() - new Date(p.posted_at).getTime() > 48 * 3600_000 && /youtube\.com\/shorts\/[\w-]+/.test(p.result ?? ""));
  for (const p of due.slice(0, 50)) {
    try {
      const conn = await token(env, p.tenant_id, "youtube");
      const id = (p.result ?? "").split("/shorts/")[1];
      const j = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${conn.access_token}` } })).json() as any;
      const views = Number(j.items?.[0]?.statistics?.viewCount);
      if (!Number.isFinite(views)) continue;
      // Baseline: this workspace's other measured posts (median); until there
      // are 3, fixed bars stand in.
      const peers = all.filter((x) => x.tenant_id === p.tenant_id && x.id !== p.id && typeof x.views === "number").map((x) => x.views!).sort((a, b) => a - b);
      const median = peers.length >= 3 ? peers[Math.floor(peers.length / 2)] : null;
      const verdict: Post["verdict"] = median != null
        ? (views >= median * 1.5 ? "good" : views <= median * 0.5 ? "flopped" : "neutral")
        : (views >= 5000 ? "good" : views < 300 ? "flopped" : "neutral");
      p.views = views; p.measured_at = new Date().toISOString(); p.verdict = verdict;
      await env.R2_BUCKET.put(postKey(p.id), JSON.stringify(p));
      if (verdict !== "neutral" && p.user_id) {
        await dbInsert(env, "feedback", { clip_id: p.clip_id, user_id: p.user_id, signal: verdict, payload: { views, source: "youtube", median } }).catch(() => {});
      }
    } catch (e) {
      console.error(`[clipper measure] ${p.id}: ${String(e).slice(0, 200)}`);
    }
  }
}
