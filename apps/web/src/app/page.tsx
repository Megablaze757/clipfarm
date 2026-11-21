import React from 'react'
import Link from 'next/link'

/**
 * Landing page — what Clipper actually does, how it works, what it costs.
 * Every claim here is something the app does today (keep it that way).
 */
const FEATURES = [
  { icon: '🎯', title: 'Finds the moments worth posting', body: 'An AI editor reads the whole transcript and scores every moment on hook, payoff, emotion and shareability — then explains why each clip made the list.' },
  { icon: '💬', title: 'Reads the room on streams', body: 'For Twitch VODs it pulls the chat replay and finds where chat exploded — the laughs, the hype, the “no way” — even 48 hours in.' },
  { icon: '🧠', title: 'Headlines that give context', body: '“KAI CENAT CRASHES OUT AT FAST FOOD WORKER” — every clip gets an on-screen headline so strangers get it instantly, with three to choose from.' },
  { icon: '🎬', title: 'Framed on whoever’s talking', body: 'Face tracking keeps the speaker in frame; two people side by side become a stacked two-speaker layout.' },
  { icon: '✂️', title: 'Tight, punchy edits', body: 'Long pauses and “um”s cut out, jump-zoom punch-ins on the words that land, viral-style captions with the key words in colour.' },
  { icon: '🎮', title: 'Split-screen gameplay', body: 'Six original game loops (“Will it escape?”, Plinko, tower stack…) with satisfying sound — or your own gameplay recording.' },
  { icon: '🌍', title: 'One clip, many markets', body: 'Captions and headline in Spanish, Portuguese, French, German and more, timed to the speech.' },
  { icon: '📤', title: 'Post or schedule', body: 'Export the top clips in one zip, or post straight to YouTube Shorts, TikTok and Instagram Reels — now or scheduled.' },
]

const PLANS = [
  { name: 'Free', price: '$0', minutes: '60 min / month', extra: '3 clips per video · small watermark', cta: 'Start free', highlight: false },
  { name: 'Creator', price: '$19', minutes: '600 min / month', extra: 'No watermark · brand kit', cta: 'Go Creator', highlight: true },
  { name: 'Team', price: '$49', minutes: '3,000 min / month', extra: 'Invite editors · 10 jobs at once', cta: 'Go Team', highlight: false },
  { name: 'Agency', price: '$149', minutes: '15,000 min / month', extra: 'For clipping at volume', cta: 'Go Agency', highlight: false },
]

const FAQ = [
  { q: 'What can I upload?', a: 'Any video or audio file up to 15 GB and 6 hours (MP4, MOV, MKV, WebM, MP3, WAV…), or a link from Twitch, Kick, Vimeo, archive.org and most video sites. Long Twitch streams use a fast path that only downloads what it needs.' },
  { q: 'Can I paste a YouTube link?', a: 'YouTube blocks downloads from servers like ours, so upload the file instead — if it’s your video, YouTube Studio lets you download it (Content → ⋮ → Download).' },
  { q: 'How long does it take?', a: 'Roughly 10–15 minutes for an hour-long podcast; a 48-hour stream took about 25 minutes using its chat to find the hot spots. You get an email when your clips are ready.' },
  { q: 'What happens to my videos?', a: 'Uploads and clips are deleted automatically after 7 days, and exported MP4s 24 hours after they’re made. Download what you want to keep.' },
  { q: 'Do I own the clips?', a: 'Yes. Clip only what you have the rights to — your own content, or with the creator’s permission.' },
]

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden bg-slate-950 pb-24">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] max-w-full h-[400px] bg-gradient-to-tr from-indigo-600/20 via-purple-600/20 to-pink-600/10 blur-[120px] pointer-events-none -z-10 rounded-full" />

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 lg:pt-24 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold mb-8">
          ✂️ Podcasts, streams and long videos → ready-to-post clips
        </div>
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 leading-[1.08] max-w-5xl mx-auto text-white">
          Your best moments, <span className="gradient-text">clipped and captioned</span> for TikTok, Reels and Shorts
        </h1>
        <p className="text-slate-400 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          Drop in a long video. Clipper finds the moments people actually share, frames the speaker, writes the headline, adds captions — and hands you clips ready to post.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/login?mode=sign_up" className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white rounded-2xl text-base font-bold shadow-xl shadow-indigo-500/25 hover:scale-[1.02] transition-transform">
            Try it free — no card
          </Link>
          <Link href="/projects" className="w-full sm:w-auto px-8 py-4 glass-panel text-slate-200 rounded-2xl text-base font-semibold border border-slate-800 hover:border-slate-700">
            Open the app
          </Link>
        </div>
        <p className="text-xs text-slate-500 mt-4">60 free minutes every month. Upgrade any time.</p>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 mt-24">
        <h2 className="text-3xl font-extrabold text-white tracking-tight text-center mb-10">How it works</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            ['1', 'Add a video', 'Upload a file or paste a Twitch / video link. Add the stream’s chat log if you have one.'],
            ['2', 'Get a ranked shortlist', 'The best moments, scored and explained, each with a headline, captions and speaker framing.'],
            ['3', 'Polish and post', 'Tweak in the editor, export the top clips as a zip, or post them straight to your accounts.'],
          ].map(([n, t, b]) => (
            <div key={n} className="glass-panel rounded-2xl p-6 border border-slate-800">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 grid place-items-center font-black">{n}</div>
              <h3 className="font-bold text-white mt-4">{t}</h3>
              <p className="text-sm text-slate-400 mt-1 leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-24">
        <h2 className="text-3xl font-extrabold text-white tracking-tight text-center mb-3">Everything a viral clip needs</h2>
        <p className="text-slate-400 text-center max-w-xl mx-auto mb-10">Built from what actually spreads: a hook in the first line, a payoff, context for strangers, and an edit that never sits still.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass-panel rounded-2xl p-5 border border-slate-800/80">
              <div className="text-2xl">{f.icon}</div>
              <h3 className="font-bold text-white mt-3 text-sm">{f.title}</h3>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-24" id="pricing">
        <h2 className="text-3xl font-extrabold text-white tracking-tight text-center mb-10">Simple pricing</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-2xl p-6 border ${p.highlight ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-800 glass-panel'}`}>
              <div className="flex items-baseline justify-between">
                <h3 className="font-bold text-white">{p.name}</h3>
                {p.highlight && <span className="text-[10px] font-bold uppercase text-indigo-200">Most popular</span>}
              </div>
              <div className="mt-3 text-3xl font-black text-white">{p.price}<span className="text-sm font-medium text-slate-400">/mo</span></div>
              <div className="text-sm text-slate-300 mt-2">{p.minutes}</div>
              <div className="text-xs text-slate-400 mt-1">{p.extra}</div>
              <Link href={p.name === 'Free' ? '/login?mode=sign_up' : '/settings/billing'} className={`mt-5 block text-center px-4 py-2.5 rounded-xl text-sm font-bold ${p.highlight ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white' : 'border border-slate-700 text-slate-200 hover:bg-slate-800'}`}>{p.cta}</Link>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 text-center mt-4">Minutes are source minutes processed. Got a referral link? You both get 2 bonus hours.</p>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-24">
        <h2 className="text-3xl font-extrabold text-white tracking-tight text-center mb-8">Questions</h2>
        <div className="space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="glass-panel rounded-2xl p-5 border border-slate-800 group">
              <summary className="font-semibold text-white cursor-pointer list-none flex justify-between gap-4">{f.q}<span className="text-slate-500 group-open:rotate-45 transition-transform">+</span></summary>
              <p className="text-sm text-slate-400 mt-3 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-24 text-center">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">Your next viral clip is already in your last video.</h2>
        <Link href="/login?mode=sign_up" className="inline-block mt-8 px-8 py-4 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white rounded-2xl text-base font-bold shadow-xl shadow-indigo-500/25">
          Find it free
        </Link>
      </section>
    </div>
  )
}
