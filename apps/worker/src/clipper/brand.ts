import type { Env } from "./env";
import type { Caller } from "./auth";
import { requireEditor } from "./auth";
import { dbJson, dbOne, dbPatch, dbInsert } from "./db";
import { ApiError, body, json } from "./http";

/**
 * BRAND KIT — one per workspace: a logo, caption colours, headline colours
 * and a default caption style, applied to every export.
 *
 * The logo is stored INSIDE the brand-kit row as a small data URL (the editor
 * shrinks it to ≤ 400 px first), not in the bucket — the bucket deletes files
 * after 7 days, and a brand kit has to last.
 */
export interface Brand {
  name?: string;
  logo?: string | null; // data:image/png;base64,… (≤ 350 KB)
  logo_position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  colors?: { active?: string; keyword?: string; headline_bg?: string; headline_text?: string };
  caption_style?: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const STYLES = ["karaoke_yellow", "bold_pop", "neon_box", "classic"];
type Row = { id: string; name: string; colors: Brand["colors"] & { logo_position?: string } | null; caption_style: { style_id?: string } | null; logo_uri: string | null };

export async function loadBrand(env: Env, tenantId: string): Promise<Brand | null> {
  const row = await dbOne<Row>(env, `brandkits?tenant_id=eq.${tenantId}&select=id,name,colors,caption_style,logo_uri&order=created_at.desc&limit=1`);
  if (!row) return null;
  const { logo_position, ...colors } = row.colors ?? {};
  return {
    name: row.name, logo: row.logo_uri, colors,
    logo_position: (["top-right", "top-left", "bottom-right", "bottom-left"].includes(String(logo_position)) ? logo_position : "top-right") as Brand["logo_position"],
    caption_style: row.caption_style?.style_id,
  };
}

/** GET /v1/brandkit */
export async function getBrand(env: Env, caller: Caller): Promise<Response> {
  return json({ brand: await loadBrand(env, caller.tenantId) });
}

/** PUT /v1/brandkit — validated, then saved as the workspace's one brand kit. */
export async function putBrand(req: Request, env: Env, caller: Caller): Promise<Response> {
  requireEditor(caller);
  const b = await body<Brand>(req);
  const colors: Record<string, string> = {};
  for (const k of ["active", "keyword", "headline_bg", "headline_text"] as const) {
    const v = b.colors?.[k];
    if (v == null || v === "") continue;
    if (!HEX.test(v)) throw new ApiError(400, "E_VALIDATION", `${k} must be a colour like #FFE100`);
    colors[k] = v.toLowerCase();
  }
  if (b.logo_position) colors.logo_position = b.logo_position;
  let logo: string | null = null;
  if (b.logo) {
    if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(b.logo)) throw new ApiError(400, "E_VALIDATION", "the logo must be a PNG, JPEG or WebP image");
    if (b.logo.length > 480_000) throw new ApiError(413, "E_VALIDATION", "the logo is too big — use a smaller image");
    logo = b.logo;
  }
  if (b.caption_style && !STYLES.includes(b.caption_style)) throw new ApiError(400, "E_VALIDATION", "unknown caption style");
  const row = {
    name: String(b.name ?? "My brand").slice(0, 80) || "My brand",
    colors, caption_style: b.caption_style ? { style_id: b.caption_style } : null, logo_uri: logo,
  };
  const existing = await dbOne<{ id: string }>(env, `brandkits?tenant_id=eq.${caller.tenantId}&select=id&order=created_at.desc&limit=1`);
  if (existing) await dbPatch(env, `brandkits?id=eq.${existing.id}&tenant_id=eq.${caller.tenantId}`, row);
  else await dbInsert(env, "brandkits", { tenant_id: caller.tenantId, ...row });
  return json({ brand: await loadBrand(env, caller.tenantId) });
}

// ---------------------------------------------------------------------------
// LEARN FROM RESULTS

/**
 * What this workspace's own results say about each kind of moment: clips
 * marked "did well" (or posted) lift their category, "flopped" / "not good"
 * lower it. Shrunk toward neutral until there's enough evidence, and capped
 * at ±20 % — a nudge to the ranking, never a veto.
 */
export async function tastes(env: Env, tenantId: string): Promise<Record<string, number>> {
  const clips = await dbJson<{ id: string; candidate_id: string }[]>(env,
    `clips?tenant_id=eq.${tenantId}&select=id,candidate_id&order=updated_at.desc&limit=400`).catch(() => []);
  if (!clips.length) return {};
  const fb = await dbJson<{ clip_id: string; signal: string }[]>(env,
    `feedback?clip_id=in.(${clips.map((c) => c.id).join(",")})&select=clip_id,signal&limit=2000`).catch(() => []);
  if (!fb.length) return {};
  const cands = await dbJson<{ id: string; features: { category?: string } | null }[]>(env,
    `candidates?id=in.(${[...new Set(clips.map((c) => c.candidate_id))].join(",")})&select=id,features`).catch(() => []);
  const catOfCand = new Map(cands.map((c) => [c.id, c.features?.category ?? null]));
  const catOfClip = new Map(clips.map((c) => [c.id, catOfCand.get(c.candidate_id) ?? null]));
  const W: Record<string, number> = { good: 1, published: 1, exported: 0.25, not_good: -1, flopped: -1 };
  const sum = new Map<string, { s: number; n: number }>();
  for (const f of fb) {
    const cat = catOfClip.get(f.clip_id);
    if (!cat || !(f.signal in W)) continue;
    const cur = sum.get(cat) ?? { s: 0, n: 0 };
    cur.s += W[f.signal]; cur.n += 1;
    sum.set(cat, cur);
  }
  const out: Record<string, number> = {};
  for (const [cat, { s, n }] of sum) {
    const lean = s / (n + 4); // shrink: 4 phantom neutral votes
    const factor = Math.max(0.8, Math.min(1.2, 1 + 0.4 * lean));
    if (Math.abs(factor - 1) >= 0.02) out[cat] = Math.round(factor * 100) / 100;
  }
  return out;
}
