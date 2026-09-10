import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Growth Ops',
  description: 'Sistema operativo comercial para crecer con claridad.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>
}
