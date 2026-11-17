import type { Env } from "./env";

/** Spec §15.1. Kept in code (not the DB) so a deploy changes every tenant at once. */
export interface Plan {
  id: "free" | "creator" | "team" | "agency" | "enterprise";
  label: string;
  monthlyMinutes: number;
  concurrentJobs: number;
  clipsPerSource: number | null; // null = by duration (10–20 / source hour)
  watermark: boolean;
  maxSourceMinutes: number;
  priceUsd: number | null;
}

export const PLANS: Record<Plan["id"], Plan> = {
  free:       { id: "free",       label: "Free",       monthlyMinutes: 60,     concurrentJobs: 1,  clipsPerSource: 3,    watermark: true,  maxSourceMinutes: 360, priceUsd: 0 },
  creator:    { id: "creator",    label: "Creator",    monthlyMinutes: 600,    concurrentJobs: 3,  clipsPerSource: null, watermark: false, maxSourceMinutes: 360, priceUsd: 19 },
  team:       { id: "team",       label: "Team",       monthlyMinutes: 3000,   concurrentJobs: 10, clipsPerSource: null, watermark: false, maxSourceMinutes: 360, priceUsd: 49 },
  agency:     { id: "agency",     label: "Agency",     monthlyMinutes: 15000,  concurrentJobs: 40, clipsPerSource: null, watermark: false, maxSourceMinutes: 360, priceUsd: 149 },
  enterprise: { id: "enterprise", label: "Enterprise", monthlyMinutes: 100000, concurrentJobs: 40, clipsPerSource: null, watermark: false, maxSourceMinutes: 600, priceUsd: null },
};

export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id ?? "free") as Plan["id"]] ?? PLANS.free;
}

/** The shared no-account testing workspace. */
export const GUEST_TENANT = "00000000-0000-4000-8000-00000000c11b";
/** Testing account: no monthly minute cap, sources up to 48 h (jobs run on free GitHub runners). */
export const guestPlan = (): Plan => ({ ...planFor("creator"), label: "Guest (testing)", monthlyMinutes: 1_000_000, concurrentJobs: 5, maxSourceMinutes: 48 * 60 });
/** A tenant's plan — the guest workspace gets its testing limits everywhere, including on the runner. */
export const planForTenant = (tenantId: string, id: string | null | undefined): Plan => (tenantId === GUEST_TENANT ? guestPlan() : planFor(id));

export function priceFor(env: Env, plan: Plan["id"]): string | undefined {
  if (plan === "creator") return env.CLIPPER_PRICE_CREATOR;
  if (plan === "team") return env.CLIPPER_PRICE_TEAM;
  if (plan === "agency") return env.CLIPPER_PRICE_AGENCY;
  return undefined;
}

export function planForPrice(env: Env, priceId: string | null | undefined): Plan["id"] | null {
  if (!priceId) return null;
  for (const id of ["creator", "team", "agency"] as const) if (priceFor(env, id) === priceId) return id;
  return null;
}

/** FR-11.1 export presets. */
export const PRESETS: Record<string, { w: number; h: number; fps: number; label: string }> = {
  tiktok:   { w: 1080, h: 1920, fps: 30, label: "TikTok 9:16" },
  reels:    { w: 1080, h: 1920, fps: 30, label: "Reels 9:16" },
  shorts:   { w: 1080, h: 1920, fps: 30, label: "Shorts 9:16" },
  linkedin: { w: 1080, h: 1350, fps: 30, label: "LinkedIn 4:5" },
  square:   { w: 1080, h: 1080, fps: 30, label: "Square 1:1" },
  landscape:{ w: 1920, h: 1080, fps: 30, label: "Landscape 16:9" },
};
