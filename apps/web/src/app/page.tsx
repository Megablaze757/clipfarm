import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function LandingPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-20 text-center">
      <div className="inline-block bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-semibold px-3 py-1 rounded-full mb-6">
        Clipper Specification v1.0 • Supabase + Cloudflare Containers + Stripe
      </div>
      <h1 className="text-5xl font-extrabold tracking-tight mb-6 bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
        Long-Form to Short-Form Auto-Clipping Platform
      </h1>
      <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
        Turn 60+ hours of video into a ranked queue of self-contained, high-watchability platform-native clips — with zero-touch automation.
      </p>
      <div className="flex justify-center space-x-4">
        <Link href="/projects">
          <Button variant="primary" className="text-base px-6 py-3">Go to Dashboard</Button>
        </Link>
        <Link href="/login">
          <Button variant="outline" className="text-base px-6 py-3">Sign In</Button>
        </Link>
      </div>
    </div>
  )
}
