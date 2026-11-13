import React from 'react'
import '@/styles/globals.css'

export const metadata = {
  title: 'Clipper — Long-Form to Short-Form Auto-Clipping',
  description: 'Turn podcasts and videos into viral short-form clips automatically.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
