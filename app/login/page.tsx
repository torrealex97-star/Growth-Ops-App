'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function signIn(event: FormEvent) {
    event.preventDefault(); setLoading(true); setMessage('')
    const { error } = await createClient().auth.signInWithPassword({ email, password })
    if (error) { setMessage(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos.' : error.message); setLoading(false); return }
    window.location.assign('/dashboard')
  }
  async function sendMagicLink() {
    if (!email) return setMessage('Introduce primero tu email.')
    setLoading(true)
    const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
    setMessage(error ? error.message : 'Te hemos enviado un enlace seguro de acceso.'); setLoading(false)
  }

  return <main className="shell" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '40px 0' }}>
    <section className="glass" style={{ width: 'min(460px, 100%)', borderRadius: 26, padding: 'clamp(26px, 6vw, 44px)' }}>
      <Link href="/" className="eyebrow">← Growth Ops</Link>
      <h1 style={{ fontSize: 38, margin: '28px 0 8px', letterSpacing: '-.05em' }}>Bienvenido</h1>
      <p style={{ color: '#95a2b7', margin: '0 0 30px', lineHeight: 1.6 }}>Accede al centro de operaciones de tu negocio.</p>
      <form onSubmit={signIn} style={{ display: 'grid', gap: 14 }}>
        <label style={{ display: 'grid', gap: 7, color: '#c7d0df', fontSize: 14 }}>Email<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label style={{ display: 'grid', gap: 7, color: '#c7d0df', fontSize: 14 }}>Contraseña<input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        <button className="button" disabled={loading}>{loading ? 'Conectando…' : 'Entrar'}</button>
        <button className="button secondary" type="button" onClick={sendMagicLink} disabled={loading}>Recibir enlace por email</button>
      </form>
      {message && <p role="status" style={{ margin: '18px 0 0', color: '#b9c8dc', lineHeight: 1.5 }}>{message}</p>}
    </section>
  </main>
}
