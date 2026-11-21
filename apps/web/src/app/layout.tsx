import React from 'react'
import '@/styles/globals.css'
import { Navbar } from '@/components/navbar'
import { ErrorReporter } from '@/components/error-reporter'

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
      <head>
        {/* Caption fonts, so the editor preview matches the exported MP4. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Anton&family=Montserrat:wght@800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        <ErrorReporter />
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  )
}
