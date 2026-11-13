import React from 'react'
import { Button } from '@/components/ui/button'

export default function BillingPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold text-white mb-2">Subscriptions & Billing</h1>
      <p className="text-slate-400 text-sm mb-8">Manage plan tiers and metered ingest minute usage via Stripe</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Free</h3>
            <div className="text-2xl font-extrabold text-slate-100 mb-4">$0 <span className="text-xs font-normal text-slate-400">/mo</span></div>
            <p className="text-xs text-slate-400 mb-4">60 source minutes / mo</p>
          </div>
          <Button variant="outline">Current Plan</Button>
        </div>

        <div className="bg-slate-900 border border-sky-500/50 rounded-xl p-6 flex flex-col justify-between relative shadow-lg shadow-sky-500/10">
          <div className="absolute -top-3 right-4 bg-sky-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            RECOMMENDED
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Creator</h3>
            <div className="text-2xl font-extrabold text-slate-100 mb-4">$19 <span className="text-xs font-normal text-slate-400">/mo</span></div>
            <p className="text-xs text-slate-400 mb-4">600 source minutes / mo</p>
          </div>
          <Button variant="primary">Upgrade to Creator</Button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-white mb-2">Team</h3>
            <div className="text-2xl font-extrabold text-slate-100 mb-4">$49 <span className="text-xs font-normal text-slate-400">/mo</span></div>
            <p className="text-xs text-slate-400 mb-4">3,000 source minutes / mo</p>
          </div>
          <Button variant="outline">Upgrade to Team</Button>
        </div>
      </div>
    </div>
  )
}
