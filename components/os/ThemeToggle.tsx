"use client"

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

// Toggle claro/oscuro. Persiste en localStorage ('iaw-theme') y aplica la clase
// `dark` en <html>. El estado inicial lo fija el script anti-flash del root layout.
export function ThemeToggle() {
  const [dark, setDark] = useState(true)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('iaw-theme', next ? 'dark' : 'light') } catch { /* ignore */ }
  }

  return (
    <button
      onClick={toggle}
      title={dark ? 'Cambiar a claro' : 'Cambiar a oscuro'}
      aria-label="Cambiar tema"
      className="press inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
