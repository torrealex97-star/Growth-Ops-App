'use client'

// Banner del modo "Ver como". Mientras el super admin navega como un colaborador, esta barra
// queda CLAVADA arriba de todo: identifica a quién se está viendo, cuánto queda de sesión y da
// la salida que restaura la sesión del super admin. Sin banner, el peligro es operar creyendo
// estar en tu cuenta — y una acción hecha ahí la firma el COLABORADOR, no tú.
import { useCallback, useEffect, useState } from 'react'
import { Eye, LogOut, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

export type VerComoInfo = { nombre: string | null; email: string | null; expira: number; tenant: string }

/** Lee el estado del modo (el ticket es httpOnly: el navegador pregunta al servidor). */
export function useVerComo(tenant: string): { info: VerComoInfo | null; recargar: () => void } {
  const [info, setInfo] = useState<VerComoInfo | null>(null)
  const [marca, setMarca] = useState(0)
  useEffect(() => {
    const c = new AbortController()
    fetch(`/api/${tenant}/evergreen/admin/ver-como/estado`, { signal: c.signal })
      .then((r) => (r.ok ? r.json() : { activo: false }))
      .then((j) => setInfo(j.activo ? { nombre: j.nombre, email: j.email, expira: j.expira, tenant } : null))
      .catch(() => {})
    return () => c.abort()
  }, [tenant, marca])
  const recargar = useCallback(() => setMarca((n) => n + 1), [])
  return { info, recargar }
}

export default function BannerVerComo({ info }: { info: VerComoInfo }) {
  const router = useRouter()
  const [saliendo, setSaliendo] = useState(false)
  const minutos = Math.max(0, Math.round((info.expira - Date.now()) / 60000))

  async function salir() {
    setSaliendo(true)
    try {
      const r = await fetch(`/api/${info.tenant}/evergreen/admin/ver-como/salir`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo restaurar tu sesión')
        setSaliendo(false)
        return
      }
      toast.success('Sesión restaurada')
      router.replace(`/${info.tenant}/dashboard`)
      router.refresh()
    } catch {
      toast.error('Error de red al salir')
      setSaliendo(false)
    }
  }

  return (
    <div
      role="status"
      aria-label="Sesión ver como"
      className="sticky top-0 z-[70] flex flex-wrap items-center justify-center gap-2 bg-amber-400 px-3 py-1.5 text-center text-xs font-medium text-amber-950"
    >
      <Eye className="h-3.5 w-3.5" aria-hidden />
      <span>
        Estás viendo como <strong>{info.nombre || info.email || 'usuario'}</strong>
        {info.email ? <span className="opacity-80"> ({info.email})</span> : null} — tus acciones se registran como esta
        persona.
      </span>
      <span className="opacity-80">· quedan {minutos} min</span>
      <button
        type="button"
        onClick={salir}
        disabled={saliendo}
        className="ml-2 inline-flex items-center gap-1 rounded border border-amber-950/30 px-2 py-0.5 font-semibold hover:bg-amber-950/10 disabled:opacity-60"
      >
        {saliendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
        Volver a mi sesión
      </button>
    </div>
  )
}
