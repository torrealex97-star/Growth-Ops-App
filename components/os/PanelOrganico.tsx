'use client'

// PANEL DE ADQUISICIÓN ORGÁNICA (prototipo) — métricas públicas de las cuentas del negocio
// (Instagram/TikTok) traídas por Apify. La UI consume NUESTROS datos normalizados vía
// /api/[tenant]/evergreen/organic (§16): nunca llama a Apify por pantalla. Cada número declara
// su fuente (§22): "Fuente: Apify · datos públicos" — sin promesas de seguridad ni de alcance
// que el dato público no da. Los estados vacíos son honestos (§25).

import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '@/lib/tenant-context'

type PlataformaOrganica = {
  platform: 'instagram' | 'tiktok'
  handle?: string
  followers?: number
  postsCount?: number
  lastCollectedAt?: string
  postsPeriodo: number
  likesPeriodo: number
  commentsPeriodo: number
  sharesPeriodo?: number
  viewsPeriodo?: number
  engagementRate?: number
  engagementFormula?: string
  topContenidos: { url?: string; views?: number; likes?: number }[]
}

type Estado = {
  config: Record<string, { enabled: boolean; actorConfigurado: boolean }>
  jobsEnMarcha: { id: string; platform: string; status: string }[]
  ultimaSync: string | null
  plataformas: PlataformaOrganica[]
}

const nf = new Intl.NumberFormat('es-ES')

function fechaRel(iso?: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const min = Math.round((Date.now() - t) / 60000)
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

export function PanelOrganico() {
  const tenant = useTenant()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [cargando, setCargando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [igHandle, setIgHandle] = useState('')
  const [ttHandle, setTtHandle] = useState('')

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/${tenant}/evergreen/organic`)
      if (!r.ok) return
      const j: Estado = await r.json()
      setEstado(j)
      const ig = j.plataformas.find((p) => p.platform === 'instagram')
      const tt = j.plataformas.find((p) => p.platform === 'tiktok')
      setIgHandle((v) => v || ig?.handle || '')
      setTtHandle((v) => v || tt?.handle || '')
    } finally {
      setCargando(false)
    }
  }, [tenant])

  useEffect(() => {
    cargar()
  }, [cargar])

  const sincronizar = async () => {
    setSincronizando(true)
    setAviso(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/organic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instagram: igHandle || undefined, tiktok: ttHandle || undefined }),
      })
      const j = await r.json()
      if (!r.ok) {
        const primerError = (Object.values(j.resultado || {}) as { error?: string }[]).find((e) => e?.error)?.error
        setAviso(j.error || primerError || 'No se pudo lanzar la sincronización')
      } else {
        setAviso('Sincronización en marcha: los datos aparecen al terminar (puedes seguir navegando).')
        // El job es asíncrono: refrescamos unos segundos después para coger el estado temprano.
        setTimeout(cargar, 8000)
      }
    } finally {
      setSincronizando(false)
    }
  }

  const config = estado?.config ?? {}
  const sinApify = Object.keys(config).length > 0 && Object.values(config).every((c) => !c.enabled)
  const hayJobEnMarcha = (estado?.jobsEnMarcha?.length ?? 0) > 0

  return (
    <section className="dashboard-card p-5 sm:p-6 space-y-4" aria-label="Adquisición orgánica">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Adquisición orgánica</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Contenido público de las cuentas del negocio.{' '}
            <span className="font-medium text-foreground">Fuente: Apify · datos públicos</span> — la cuenta conectada no
            participa en estas consultas (sus métricas oficiales viven en Mi cuenta).
          </p>
        </div>
        <button
          onClick={sincronizar}
          disabled={sincronizando || cargando || sinApify}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      </div>

      {cargando && <p className="text-sm text-muted-foreground">Cargando datos orgánicos…</p>}

      {!cargando && sinApify && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          Apify no configurado: añade el API Token y los Actors en{' '}
          <strong>Configuración › Integraciones › Apify</strong> para activar esta capa.
        </p>
      )}

      {!cargando && !sinApify && aviso && (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">{aviso}</p>
      )}

      {!cargando && !sinApify && hayJobEnMarcha && (
        <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm">
          Analizando cuentas… el resultado aparece aquí al terminar el job.
        </p>
      )}

      {!cargando && !sinApify && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(estado?.plataformas ?? []).map((p) => (
              <div key={p.platform} className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">{p.platform}</span>
                  <span className="text-xs text-muted-foreground">{p.handle ? `@${p.handle}` : '—'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-lg font-semibold">{p.followers != null ? nf.format(p.followers) : '—'}</div>
                    <div className="text-xs text-muted-foreground">Seguidores</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{nf.format(p.postsPeriodo)}</div>
                    <div className="text-xs text-muted-foreground">Publicaciones del periodo</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{nf.format(p.likesPeriodo)}</div>
                    <div className="text-xs text-muted-foreground">Me gusta</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{nf.format(p.commentsPeriodo)}</div>
                    <div className="text-xs text-muted-foreground">Comentarios</div>
                  </div>
                  {p.viewsPeriodo != null && (
                    <div>
                      <div className="text-lg font-semibold">{nf.format(p.viewsPeriodo)}</div>
                      <div className="text-xs text-muted-foreground">Reproducciones</div>
                    </div>
                  )}
                  {p.engagementRate != null && (
                    <div>
                      <div className="text-lg font-semibold">{(p.engagementRate * 100).toFixed(1)}%</div>
                      <div className="text-xs text-muted-foreground" title={p.engagementFormula}>
                        Engagement
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Última sincronización: {fechaRel(p.lastCollectedAt)}</p>
              </div>
            ))}
          </div>

          {(estado?.plataformas?.length ?? 0) === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Sin datos todavía. Escribe los handles públicos y pulsa <strong>Sincronizar</strong> para traer el primer
              snapshot (Instagram y TikTok se traen en paralelo).
            </div>
          )}

          {(estado?.plataformas?.length ?? 0) > 0 && (
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Handle de Instagram</span>
                <input
                  value={igHandle}
                  onChange={(e) => setIgHandle(e.target.value)}
                  placeholder="@cuenta"
                  className="w-44 rounded-md border border-input bg-background px-2 py-1.5 text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Handle de TikTok</span>
                <input
                  value={ttHandle}
                  onChange={(e) => setTtHandle(e.target.value)}
                  placeholder="@cuenta"
                  className="w-44 rounded-md border border-input bg-background px-2 py-1.5 text-foreground"
                />
              </label>
            </div>
          )}
        </>
      )}
    </section>
  )
}
