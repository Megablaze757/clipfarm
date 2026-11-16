// =============================================================================
// COMBINED CLOUDFLARE WORKER BUNDLE (PocketAthlete + Clipper Platform)
// =============================================================================
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// --- PocketAthlete Code Imports & Functions ---
function launchEmail({ appUrl, ref, unsubscribeUrl }) {
  const cta = ref ? `${appUrl}/?ref=${encodeURIComponent(ref)}` : `${appUrl}/`;
  const subject = "Pocket Athlete is live \u{1F525} you're in";
  const text = [
    "POCKET ATHLETE IS LIVE.",
    "",
    "You put your name down before there was anything to see. It's open now, and",
    "you're getting this before anyone else.",
    "",
    `Open it: ${cta}`,
    "",
    "Free to start. No card. About two minutes to your first four-week block.",
    "",
    "---",
    "",
    "MOST PLANS KNOW YOUR SPORT. THIS ONE KNOWS YOUR POSITION.",
    "",
    "A prop and a winger need different bodies, so they get different sessions.",
    "33 positions across 6 sports, each with their own movements, drills and",
    "challenges. Not one generic plan with your sport's name on the front.",
    "",
    "WHAT'S WAITING FOR YOU",
    "",
  253 /a0/usr/workdir/clipfarm/apps/worker/src/index.js
   63 /a0/usr/workdir/clipfarm/apps/worker/src/index.ts
  316 total
(venv) root@9d3485ac5a18:/a0/usr/workdir/clipfarm#
