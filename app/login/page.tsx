'use client'

import { useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/dashboard'

  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Contraseña incorrecta')
        return
      }

      router.push(from)
      router.refresh()
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f0f1a] px-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#C9477A] opacity-10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#C9477A]/20 border border-[#C9477A]/30 mb-4">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path
                d="M16 4L28 10V22L16 28L4 22V10L16 4Z"
                stroke="#C9477A"
                strokeWidth="2"
                fill="none"
              />
              <circle cx="16" cy="16" r="4" fill="#C9477A" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            [tenant]
          </h1>
          <p className="text-[#94a3b8] text-sm mt-1">
            Dashboard Lanzamiento — Mayo 2026
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-1">
            Acceso restringido
          </h2>
          <p className="text-[#94a3b8] text-sm mb-6">
            Introduce la contraseña para acceder al dashboard.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[#e2e8f0] mb-2"
              >
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                autoFocus
                className="w-full px-4 py-3 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] focus:outline-none focus:border-[#C9477A] focus:ring-1 focus:ring-[#C9477A] transition-colors"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <svg
                  className="w-4 h-4 text-red-400 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                  />
                </svg>
                <span className="text-red-400 text-sm">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 px-4 bg-[#C9477A] hover:bg-[#E8729A] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors duration-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Verificando...
                </>
              ) : (
                'Entrar al dashboard'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[#4a4a6a] text-xs mt-6">
          the[tenant].es &copy; 2026
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0f0f1a]" />}>
      <LoginForm />
    </Suspense>
  )
}
