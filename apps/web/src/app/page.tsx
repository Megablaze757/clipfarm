import React from 'react'
import Link from 'next/link'

/**
 * Landing page — what Clipper actually does, how it works, what it costs.
 * Every claim here is something the app does today (keep it that way).
 */
const FEATURES = [
  { title: 'Finds the moments worth posting', body: 'An AI editor reads the whole transcript and scores every moment on hook, payoff, emotion and shareability, and says why each one made the list.' },
  { title: 'Reads the room on streams', body: 'For Twitch VODs it pulls the chat replay and finds where chat exploded, even 48 hours in.' },
  { title: 'Headlines that give context', body: 'Every clip gets an on-screen headline so strangers get it instantly. Pick from three, edit it, or switch it off.' },
  { title: 'Framed on whoever’s talking', body: 'Face tracking keeps the speaker in frame. Two people side by side become a stacked two-speaker layout.' },
  { title: 'Tight edits', body: 'Long pauses and “um”s cut out, punch-in zooms on the words that land, captions with key words in colour.' },
  { title: 'Split-screen gameplay', body: 'Six original game loops with sound under the speaker, or your own gameplay footage.' },
  { title: 'One clip, many markets', body: 'Captions and headline translated into Spanish, Portuguese, French, German and five more, timed to the speech.' },
  { title: 'Post or schedule', body: 'Download the top clips as a zip, or post to YouTube Shorts, TikTok and Instagram Reels, now or later.' },
]

const PLANS = [
  { name: 'Free', price: '$0', minutes: '60 min / month', extra: ['3 clips per video', 'Small watermark'], cta: 'Start free', highlight: false },
  { name: 'Creator', price: '$19', minutes: '600 min / month', extra: ['No watermark', 'Brand kit'], cta: 'Choose Creator', highlight: true },
  { name: 'Team', price: '$49', minutes: '3,000 min / month', extra: ['Invite editors', '10 jobs at once'], cta: 'Choose Team', highlight: false },
  { name: 'Agency', price: '$149', minutes: '15,000 min / month', extra: ['Clipping at volume'], cta: 'Choose Agency', highlight: false },
]

const FAQ = [
  { q: 'What can I upload?', a: 'Any video or audio file up to 15 GB and 6 hours (MP4, MOV, MKV, WebM, MP3, WAV…), or a link from Twitch, Kick, Vimeo, archive.org and most video sites. Long Twitch streams use a fast path that only downloads what it needs.' },
  { q: 'Can I paste a YouTube link?', a: 'YouTube blocks downloads from servers like ours, so upload the file instead. If it’s your video, YouTube Studio lets you download it (Content → ⋮ → Download).' },
  { q: 'How long does it take?', a: 'Roughly 15–20 minutes for an hour-long podcast; a 48-hour stream took about 25 minutes using its chat to find the hot spots. You get an email when your clips are ready.' },
  { q: 'What happens to my videos?', a: 'Uploads and clips are deleted automatically after 7 days, and exported MP4s 24 hours after they’re made. Download what you want to keep.' },
  { q: 'Do I own the clips?', a: 'Yes. Clip only what you have the rights to: your own content, or with the creator’s permission.' },
]

/** A clip as it comes out of the editor: headline boxes, a speaker, Hormozi-style caption. */
function PhoneMock() {
  return (
    <div className="relative w-[230px] sm:w-[260px] aspect-[9/16] rounded-[28px] border border-white/10 bg-[#111114] p-2 shadow-2xl shadow-black/60">
      <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[radial-gradient(120%_80%_at_50%_30%,#3a2a22_0%,#1a1513_55%,#0e0d0c_100%)]">
        {/* speaker silhouette */}
        <div className="absolute left-1/2 top-[34%] -translate-x-1/2 w-[46%] aspect-square rounded-full bg-[#2b211c]" />
        <div className="absolute left-1/2 top-[56%] -translate-x-1/2 w-[86%] h-[40%] rounded-t-[45%] bg-[#241c18]" />
        {/* headline */}
        <div className="absolute inset-x-3 top-[7%] flex flex-col items-center gap-[3px]">
          {['HOST REVEALS WHY HE', 'QUIT HIS DREAM JOB'].map((l) => (
            <span key={l} className="bg-white px-1.5 py-0.5 text-[11px] sm:text-[12px] leading-tight text-black" style={{ fontFamily: 'Montserrat, "Arial Black", sans-serif', fontWeight: 800 }}>{l}</span>
          ))}
        </div>
        {/* caption */}
        <div className="absolute inset-x-0 top-[66%] text-center text-[20px] sm:text-[22px] leading-none" style={{ fontFamily: 'Montserrat, "Arial Black", sans-serif', fontWeight: 900, WebkitTextStroke: '1px black', textShadow: '0 3px 0 #000' }}>
          <span className="text-white">I WAS </span><span className="text-[#ffd21f]">DONE</span>
        </div>
        {/* timeline */}
        <div className="absolute inset-x-4 bottom-4 h-1 rounded-full bg-white/15"><div className="h-full w-[38%] rounded-full bg-white/70" /></div>
      </div>
    </div>
  )
}

function ShortlistMock() {
  const rows = [
    { t: 'HOST REVEALS WHY HE QUIT HIS DREAM JOB', s: 92, d: '0:48', why: 'Question hook · clear payoff' },
    { t: 'GUEST’S MOM WALKS IN MID-STORY', s: 88, d: '0:34', why: 'Audience reaction · self-contained' },
    { t: 'THE $40K MISTAKE NOBODY TALKS ABOUT', s: 84, d: '1:02', why: 'Bold claim · strong ending' },
  ]
  return (
    <div className="w-[300px] sm:w-[340px] rounded-xl border border-white/10 bg-[#141417] shadow-2xl shadow-black/60">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <span className="text-xs font-semibold text-slate-200">Shortlist</span>
        <span className="text-[11px] text-slate-500">12 clips · 1 h 16 m source</span>
      </div>
      <ul>
        {rows.map((r, i) => (
          <li key={r.t} className="flex items-start gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0">
            <span className="mt-0.5 w-5 text-[11px] tabular-nums text-slate-500">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold text-slate-100">{r.t}</div>
              <div className="text-[11px] text-slate-500">{r.why} · {r.d}</div>
            </div>
            <span className="rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-indigo-300">{r.s}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="pb-24">
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 lg:pt-20 grid lg:grid-cols-[1.05fr_1fr] gap-12 items-center">
        <div>
          <p className="text-[13px] font-medium text-indigo-400 mb-5">For podcasts, streams and long videos</p>
          <h1 className="font-display text-[40px] sm:text-6xl font-bold leading-[1.02] tracking-tight text-white">
            Turn the long video into the clips people share.
          </h1>
          <p className="mt-6 text-lg text-slate-400 max-w-xl leading-relaxed">
            Clipper finds the moments worth posting, frames the speaker, writes the headline and burns in captions, so you get vertical clips ready for TikTok, Reels and Shorts.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3">
            <Link href="/login?mode=sign_up" className="px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[15px] font-semibold text-center">Start free, no card</Link>
            <Link href="/projects" className="px-6 py-3 rounded-lg border border-white/10 text-slate-200 hover:bg-white/[0.04] text-[15px] font-medium text-center">Open the app</Link>
          </div>
          <p className="mt-4 text-[13px] text-slate-500">60 free minutes every month.</p>
        </div>
        <div className="relative flex justify-center lg:justify-end min-h-[440px] sm:min-h-[480px]">
          <div className="relative">
            <PhoneMock />
            <div className="absolute -left-[300px] top-[18%] hidden lg:block"><ShortlistMock /></div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-28">
        <h2 className="text-2xl sm:text-3xl font-bold text-white">How it works</h2>
        <ol className="mt-8 grid md:grid-cols-3 gap-px bg-white/[0.06] rounded-xl overflow-hidden border border-white/[0.06]">
          {[
            ['Add a video', 'Upload a file or paste a Twitch or video link. Add the stream’s chat log if you have one.'],
            ['Get a ranked shortlist', 'The best moments, scored and explained, each with a headline, captions and speaker framing.'],
            ['Polish and post', 'Tweak in the editor, export the top clips as a zip, or post them straight to your accounts.'],
          ].map(([t, b], i) => (
            <li key={t} className="bg-slate-950 p-6">
              <span className="text-[13px] tabular-nums text-indigo-400 font-semibold">0{i + 1}</span>
              <h3 className="mt-3 font-semibold text-white">{t}</h3>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{b}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-28 grid lg:grid-cols-[1fr_2fr] gap-10">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white">What a clip needs to travel</h2>
          <p className="mt-3 text-slate-400 leading-relaxed">A hook in the first line, a payoff, context for strangers, and an edit that never sits still. Clipper does each of these for every clip.</p>
        </div>
        <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-8">
          {FEATURES.map((f) => (
            <div key={f.title} className="border-t border-white/[0.08] pt-4">
              <dt className="font-semibold text-white text-[15px]">{f.title}</dt>
              <dd className="mt-1.5 text-sm text-slate-400 leading-relaxed">{f.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-28" id="pricing">
        <h2 className="text-2xl sm:text-3xl font-bold text-white">Pricing</h2>
        <p className="mt-2 text-slate-400">Minutes are source minutes processed. Referral link? You both get 2 bonus hours.</p>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-xl p-6 border flex flex-col ${p.highlight ? 'border-indigo-500/60 bg-indigo-500/[0.06]' : 'border-white/[0.08] bg-[#141417]'}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-white">{p.name}</h3>
                {p.highlight && <span className="text-[11px] font-medium text-indigo-300">Most popular</span>}
              </div>
              <div className="mt-4 font-display text-4xl font-bold text-white">{p.price}<span className="text-sm font-normal text-slate-500"> /mo</span></div>
              <div className="mt-1 text-sm text-slate-300">{p.minutes}</div>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-400 flex-1">
                {p.extra.map((e) => <li key={e} className="flex gap-2"><span className="text-indigo-400">✓</span>{e}</li>)}
              </ul>
              <Link href={p.name === 'Free' ? '/login?mode=sign_up' : '/settings/billing'}
                className={`mt-6 block text-center px-4 py-2.5 rounded-lg text-sm font-semibold ${p.highlight ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'border border-white/10 text-slate-200 hover:bg-white/[0.04]'}`}>{p.cta}</Link>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 mt-28">
        <h2 className="text-2xl sm:text-3xl font-bold text-white">Questions</h2>
        <div className="mt-6 divide-y divide-white/[0.08] border-y border-white/[0.08]">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="font-medium text-white cursor-pointer list-none flex justify-between gap-4">
                {f.q}<span className="text-slate-500 group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="text-sm text-slate-400 mt-3 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 mt-28">
        <div className="rounded-2xl border border-white/[0.08] bg-[#141417] px-6 py-12 sm:px-12 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white max-w-lg">Your next clip is already in your last video.</h2>
          <Link href="/login?mode=sign_up" className="shrink-0 px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-center">Find it free</Link>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 mt-20 pt-8 border-t border-white/[0.06] flex items-center justify-between text-[13px] text-slate-500">
        <span>© {new Date().getFullYear()} Clipper</span>
        <Link href="/login" className="hover:text-slate-300">Sign in</Link>
      </footer>
    </div>
  )
}
