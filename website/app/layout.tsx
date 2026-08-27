import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Roofscape — every project a building, every hire a floor',
  description:
    'Roofscape runs a small service on your machine. Break ground on a building for each project you run, staff it with agents, and see at a glance where your effort actually sits.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
