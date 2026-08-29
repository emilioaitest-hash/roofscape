import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Roofscape — every project a building, every hire a floor',
  description:
    'Roofscape runs companies of agents on your own machine. Break ground on a building for each project, staff it with agents, and read the whole operation off a skyline.',
}

/**
 * The paper colour, so the browser's own chrome sits on the page rather than
 * bracketing it in white. `light` because there is no dark Overprint — see
 * docs/decisions/0015. Saying so also stops the browser tinting form controls
 * and scrollbars for a scheme this page does not have.
 */
export const viewport: Viewport = {
  themeColor: '#f1ebdd',
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
