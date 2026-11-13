import React from 'react'
import Link from 'next/link'

export default function BillingPage() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
      <div className="border-b border-slate-800/80 pb-6">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Usage & Billing</h1>
        <p className="text-slate-400 text-sm mt-1">
          Manage Stripe subscription tiers, metered source video minutes, and Cloudflare egress quotas.
        </p>
      </div>

      {/* Usage Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Source Minutes Used</span>
          <div className="text-3xl font-black text-white">42 / 300 <span className="text-xs text-slate-400 font-normal">mins</span></div>
          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full w-[14%]"></div>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Active Plan</span>
          <div className="text-2xl font-black text-indigo-400">Pro Creator Tier</div>
          <p className="text-xs text-slate-400">Renews Dec 1, 2026 via Stripe</p>
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3 flex flex-col justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Stripe Customer Portal</span>
          <button className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl border border-slate-700 transition-colors text-center">
            Manage Billing Portal &rarr;
          </button>
        </div>
      </div>
    </div>
  )
}
