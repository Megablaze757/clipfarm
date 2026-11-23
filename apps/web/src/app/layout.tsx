import React from 'react'
import '@/styles/globals.css'
import { Navbar } from '@/components/navbar'
import { ErrorReporter } from '@/components/error-reporter'

export const metadata = {
  title: 'Clipper — long videos into clips people share',
  description: 'Clipper finds the best moments in podcasts, streams and long videos and turns them into captioned vertical clips.',
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
        <link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=Inter+Tight:wght@600;700;800&family=Montserrat:wght@800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased selection:bg-indigo-500/30 selection:text-white">
        <ErrorReporter />
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  )
}
