'use client'

// Banner del modo "Ver como". Mientras el super admin navega como un colaborador, esta barra
// queda CLAVADA arriba de todo: identifica a quién se está viendo, cuánto queda de sesión y da
// la salida que restaura la sesión del super admin. Sin banner, el peligro es operar creyendo
// estar en tu cuenta — y una acción hecha ahí la firma el COLABORADOR, no tú.
//
// Doble candado anti-confusión (además del banner):
//   · TÍTULO DE PESTAÑA: mientras el modo está activo, document.title lleva el prefijo
//     "👁 VER COMO — " y se re-afirma cada segundo (cada página lo sobreescribe al navegar);
//     al salir se restaura el original.
//   · CHIP EN LA ESQUINA: indicador fijo abajo a la izquierda, por si algo tapa el banner
//     (modales a pantalla completa, scroll interno). Clic = subir arriba, donde está el banner.
import { useCallback, useEffect, useState } from 'react'
import { Eye, LogOut, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export type VerComoInfo = { nombre: string | null; email: string | null; expira: number; tenant: string }

const MARCA_TITULO = '👁 VER COMO — '

/** Marca la pestaña mientras el modo está activo y restaura el título original al salir. */
export function useMarcaTituloVerComo(info: VerComoInfo | null): void {
  const clave = info ? `${info.tenant}:${info.nombre || info.email || ''}` : ''
  useEffect(() => {
    if (!clave) return
    const original = document.title.startsWith(MARCA_TITULO)
      ? document.title.slice(MARCA_TITULO.length)
      : document.title
    const afirma = () => {
      const limpio = document.title.startsWith(MARCA_TITULO)
        ? document.title.slice(MARCA_TITULO.length)
        : document.title
      document.title = MARCA_TITULO + limpio
    }
    afirma()
    const t = setInterval(afirma, 1000)
    return () => {
      clearInterval(t)
      document.title = original
    }
  }, [clave])
}

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

/** Indicador fijo en la esquina: visible aunque el banner quede tapado o fuera de vista. */
function EsquinaVerComo({ info }: { info: VerComoInfo }) {
  return (
    <div
      role="status"
      aria-label="Modo ver como activo"
      title="Modo Ver como activo — el banner para volver a tu sesión está arriba"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-4 left-4 z-[80] flex cursor-pointer items-center gap-2 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-bold text-amber-950 shadow-lg ring-1 ring-amber-950/30"
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-950 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-950" />
      </span>
      <Eye className="h-3.5 w-3.5" aria-hidden />
      <span>VER COMO: {info.nombre || info.email || 'usuario'}</span>
    </div>
  )
}

export default function BannerVerComo({ info }: { info: VerComoInfo }) {
  const [saliendo, setSaliendo] = useState(false)
  const minutos = Math.max(0, Math.round((info.expira - Date.now()) / 60000))
  useMarcaTituloVerComo(info)

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
      // Navegación COMPLETA (no router.replace): el shim guarda `info` en estado y un refresh de
      // RSC no la limpia — el banner/título marcado quedarían colgados hasta la próxima navegación.
      window.location.assign(`/${info.tenant}/dashboard`)
    } catch {
      toast.error('Error de red al salir')
      setSaliendo(false)
    }
  }

  return (
    <>
      <div
        role="status"
        aria-label="Sesión ver como"
        className="sticky top-0 z-[70] flex flex-wrap items-center justify-center gap-2 bg-amber-400 px-3 py-1.5 text-center text-xs font-medium text-amber-950"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden />
        <span>
          Estás viendo como <strong>{info.nombre || info.email || 'usuario'}</strong>
          {info.email ? <span className="opacity-80"> ({info.email})</span> : null} — tus acciones se registran como
          esta persona.
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
      <EsquinaVerComo info={info} />
    </>
  )
}
