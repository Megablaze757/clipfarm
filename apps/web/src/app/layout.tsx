import React from 'react'
import '@/styles/globals.css'
import { Navbar } from '@/components/navbar'

export const metadata = {
  title: 'Clipper — Long-Form to Short-Form Auto-Clipping Platform',
  description: 'Turn podcasts, webinars, and long-form videos into viral, self-contained short clips automatically.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  )
}
