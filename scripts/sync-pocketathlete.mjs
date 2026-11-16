#!/usr/bin/env node
// =============================================================================
// Copy the PocketAthlete Worker into the merged Worker.
//
// PocketAthlete and Clipper now ship as ONE Cloudflare Worker (apex-api), so
// both apps share the same AI keys and the same Groq -> OpenRouter -> NVIDIA
// fallback ladder. PocketAthlete's source of truth is still its own repo
// (FOOTBALLFITNESSGURU/cloudflare/src + lib). Run this after changing it there:
//
//   node scripts/sync-pocketathlete.mjs ../FOOTBALLFITNESSGURU
//
// It copies cloudflare/src/*.ts and every lib/*.ts they import (transitively)
// into apps/worker/src/pocketathlete/, rewrites "../../lib/x" to "./lib/x",
// and appends the export Clipper needs. Do not hand-edit the copied files.
// =============================================================================
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const paRoot = resolve(process.argv[2] ?? join(ROOT, "..", "FOOTBALLFITNESSGURU"));
const srcDir = join(paRoot, "cloudflare", "src");
const libDir = join(paRoot, "lib");
const outDir = join(ROOT, "apps", "worker", "src", "pocketathlete");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, "lib"), { recursive: true });

const libImports = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
const queue = [];
for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
  let text = readFileSync(join(srcDir, file), "utf8");
  queue.push(...libImports(text, /from "\.\.\/\.\.\/lib\/([a-z0-9-]+)"/g));
  text = text.replaceAll('"../../lib/', '"./lib/');
  if (file === "index.ts") {
    text += `
// --- Added by clipfarm/scripts/sync-pocketathlete.mjs -----------------------
// Clipper (apps/worker/src/clipper) borrows the same AI ladder, so both apps
// share one set of keys and one Groq -> OpenRouter -> NVIDIA fallback chain.
export { complete as completeWithFallbacks, modelChain };
`;
  }
  writeFileSync(join(outDir, file), text);
}

const seen = new Set();
while (queue.length) {
  const name = queue.pop();
  if (seen.has(name)) continue;
  seen.add(name);
  copyFileSync(join(libDir, `${name}.ts`), join(outDir, "lib", `${name}.ts`));
  queue.push(...libImports(readFileSync(join(libDir, `${name}.ts`), "utf8"), /from "\.\/([a-z0-9-]+)"/g));
}
console.log(`synced PocketAthlete worker + ${seen.size} lib files from ${paRoot}`);
