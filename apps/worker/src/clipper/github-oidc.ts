/**
 * Lets a GitHub Actions run prove it is OUR video-job workflow, with no shared
 * secret: the runner asks GitHub for an OIDC token (audience "apex-api"),
 * GitHub signs it, and we check the signature against GitHub's public keys
 * plus the claims that pin it to one workflow file on the default branch.
 *
 * So the Clipper repo needs no secrets at all, and nothing sensitive ever sits
 * in a public run log.
 */
const ISSUER = "https://token.actions.githubusercontent.com";
export const OIDC_AUDIENCE = "apex-api";
const WORKFLOW = ".github/workflows/clipper-job.yml";

let jwks: { at: number; keys: Map<string, CryptoKey> } | null = null;

async function key(kid: string): Promise<CryptoKey | null> {
  if (!jwks || Date.now() - jwks.at > 60 * 60 * 1000 || !jwks.keys.has(kid)) {
    const r = await fetch(`${ISSUER}/.well-known/jwks`);
    if (!r.ok) return null;
    const { keys } = (await r.json()) as { keys: (JsonWebKey & { kid: string })[] };
    const map = new Map<string, CryptoKey>();
    for (const k of keys) {
      if (k.kty !== "RSA") continue;
      map.set(k.kid, await crypto.subtle.importKey("jwk", { ...k, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    jwks = { at: Date.now(), keys: map };
  }
  return jwks.keys.get(kid) ?? null;
}

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

/** True when `token` is a valid OIDC token from `repo`'s clipper-job workflow on main. */
export async function verifyGithubRunner(token: string, repo: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64(parts[0]))) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return false;
    const k = await key(header.kid);
    if (!k) return false;
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", k, b64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return false;
    const c = JSON.parse(new TextDecoder().decode(b64(parts[1]))) as Record<string, unknown>;
    const now = Date.now() / 1000;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (c.iss !== ISSUER || !aud.includes(OIDC_AUDIENCE)) return false;
    if (typeof c.exp !== "number" || c.exp < now - 30) return false;
    if (typeof c.nbf === "number" && c.nbf > now + 30) return false;
    if (String(c.repository).toLowerCase() !== repo.toLowerCase()) return false;
    // Pinned to the one workflow file, on main — a branch or another workflow can't borrow it.
    return String(c.job_workflow_ref ?? "").toLowerCase() === `${repo}/${WORKFLOW}@refs/heads/main`.toLowerCase();
  } catch {
    return false;
  }
}
