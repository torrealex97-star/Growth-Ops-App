'use client'

// PÁGINA INTERMEDIA de "Ver como": canjea el token del magic link en el NAVEGADOR del admin
// (setSession → cookies SSR de @supabase/ssr) y entra al panel del colaborador. El token llega
// por query porque el action_link de Supabase lleva la sesión en el #fragment, que nunca llega
// al server y aterrizaría en el Site URL (Vercel), no aquí.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export default function PaginaEntrarVerComo() {
  const router = useRouter()
  const [aviso, setAviso] = useState('Entrando…')
  const lanzado = useRef(false)

  useEffect(() => {
    if (lanzado.current) return
    lanzado.current = true
    const url = new URL(window.location.href)
    const token = url.searchParams.get('token_hash') || url.searchParams.get('token') || ''

    async function canjear() {
      const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      // El token enlazado (56 hex) va como `token_hash`, no como código de 6 dígitos.
      const { error } = await sb.auth.verifyOtp({ token_hash: token, type: 'magiclink' })
      if (error) {
        setAviso('El enlace ha caducado o ya se usó. Vuelve a "Ver como" y reintenta.')
        return
      }
      // El tenant llega por query: la página vive FUERA del namespace /[tenant] a propósito —
      // el layout del tenant exige sesión y esta página es la que la crea (punto muerto).
      const tenant = url.searchParams.get('tenant') || ''
      window.location.href = tenant ? `/${tenant}/dashboard` : '/'
    }

    void canjear()
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-300">
      <div className="text-center">
        <p>{aviso}</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="mt-4 rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
        >
          Volver
        </button>
      </div>
    </div>
  )
}
