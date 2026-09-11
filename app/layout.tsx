import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' })

export const metadata: Metadata = {
  title: 'Scalix Systems',
  description: 'Operating system de negocio Scalix Systems',
  robots: 'noindex, nofollow',
}

// Aplica el tema guardado (oscuro por defecto) antes de pintar, para evitar el flash.
const themeScript = `(function(){try{var t=localStorage.getItem('iaw-theme')||'dark';document.documentElement.classList.toggle('dark',t!=='light');document.documentElement.dataset.theme='os';}catch(e){document.documentElement.classList.add('dark');}})();`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className={`${inter.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}
