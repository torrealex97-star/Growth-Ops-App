'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CloserLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/lanzamiento/closer/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error || 'Error al iniciar sesión'); return }
    router.push('/lanzamiento/closer')
  }

  return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9477A">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white">Panel Closers</h1>
          <p className="text-sm text-[#4a4a6a] mt-1">IA WINNERS · Lanzamiento</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-xs text-[#94a3b8] mb-1.5">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@email.com" required
              className="w-full px-4 py-2.5 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors" />
          </div>
          <div>
            <label className="block text-xs text-[#94a3b8] mb-1.5">Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required
              className="w-full px-4 py-2.5 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors" />
          </div>
          {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors">
            {loading ? 'Entrando...' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </div>
  )
}
