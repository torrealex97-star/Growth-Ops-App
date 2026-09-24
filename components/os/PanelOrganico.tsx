'use client'

// PANEL DE ADQUISICIÓN ORGÁNICA — métricas OFICIALES de las cuentas del negocio.
// Los datos vienen de las APIs oficiales de cada plataforma vía la sync ya existente
// (Instagram Graph API → ig_media/ig_account_daily). NADA de scraping de las cuentas propias:
// Apify queda reservado a la investigación de TERCEROS (regla del brief del 21-sep).
// Fuente declarada en la UI; estados vacíos honestos (§25): si no hay sync oficial, se pide
// sincronizar, no se inventan ceros.

import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '@/lib/tenant-context'

type PlataformaOficial = {
  platform: string
  handle?: string
  followers?: number
  postsCount?: number
  lastSyncedAt?: string
  postsPeriodo: number
  likesPeriodo: number
  commentsPeriodo: number
  viewsPeriodo?: number
  reachPeriodo?: number
  sharesPeriodo?: number
  savedPeriodo?: number
  engagementRate?: number
  engagementFormula: string
  topContenidos: { url?: string; views?: number; likes?: number }[]
}

type Estado = {
  source: 'official'
  apis: { instagram: { disponible: boolean }; apify: { configurado: boolean; uso: string } }
  ultimaSync: string | null
  plataformas: PlataformaOficial[]
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

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/${tenant}/evergreen/organic`)
      if (!r.ok) return
      setEstado(await r.json())
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
      const r = await fetch(`/api/${tenant}/evergreen/organic`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setAviso(j.error || 'No se pudo lanzar la sincronización oficial')
      } else {
        setAviso('Sincronización oficial en marcha: los datos oficiales aparecen al terminar.')
        setTimeout(cargar, 10000)
      }
    } finally {
      setSincronizando(false)
    }
  }

  const instagram = estado?.plataformas?.find((p) => p.platform === 'instagram')
  const sinCredenciales = estado ? !estado.apis.instagram.disponible : false
  const sinDatos = estado && estado.apis.instagram.disponible && !instagram

  return (
    <section className="dashboard-card p-5 sm:p-6 space-y-4" aria-label="Adquisición orgánica">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Adquisición orgánica</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Métricas de las cuentas del negocio por sus{' '}
            <span className="font-medium text-foreground">APIs oficiales</span> (Instagram Graph API) — sin scraping de
            cuentas propias. Apify queda reservado a la investigación de terceros.
          </p>
        </div>
        <button
          onClick={sincronizar}
          disabled={sincronizando || cargando || sinCredenciales}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
        </button>
      </div>

      {cargando && <p className="text-sm text-muted-foreground">Cargando datos orgánicos…</p>}

      {!cargando && sinCredenciales && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
          Instagram no está conectado en esta subcuenta. Conecta la cuenta oficial en{' '}
          <strong>Configuración › Integraciones › Instagram</strong> — sus métricas se traen por la API oficial de Meta,
          nunca por scraping.
        </p>
      )}

      {!cargando && !sinCredenciales && aviso && (
        <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">{aviso}</p>
      )}

      {!cargando && !sinCredenciales && sinDatos && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Aún no hay datos oficiales sincronizados. Pulsa <strong>Sincronizar</strong> (o espera el cron diario) para
          traer el primer snapshot por la API oficial de Instagram.
        </div>
      )}

      {!cargando && instagram && (
        <>
          <div className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium capitalize">Instagram</span>
              <span className="text-xs text-muted-foreground">
                {instagram.handle ? `@${instagram.handle}` : 'cuenta conectada'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <div className="text-lg font-semibold">
                  {instagram.followers != null ? nf.format(instagram.followers) : '—'}
                </div>
                <div className="text-xs text-muted-foreground">Seguidores</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{nf.format(instagram.postsPeriodo)}</div>
                <div className="text-xs text-muted-foreground">Publicaciones del periodo</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{nf.format(instagram.likesPeriodo)}</div>
                <div className="text-xs text-muted-foreground">Me gusta</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{nf.format(instagram.commentsPeriodo)}</div>
                <div className="text-xs text-muted-foreground">Comentarios</div>
              </div>
              {instagram.reachPeriodo != null && (
                <div>
                  <div className="text-lg font-semibold">{nf.format(instagram.reachPeriodo)}</div>
                  <div className="text-xs text-muted-foreground">Alcance (oficial)</div>
                </div>
              )}
              {instagram.sharesPeriodo != null && (
                <div>
                  <div className="text-lg font-semibold">{nf.format(instagram.sharesPeriodo)}</div>
                  <div className="text-xs text-muted-foreground">Compartidos</div>
                </div>
              )}
              {instagram.savedPeriodo != null && (
                <div>
                  <div className="text-lg font-semibold">{nf.format(instagram.savedPeriodo)}</div>
                  <div className="text-xs text-muted-foreground">Guardados</div>
                </div>
              )}
              {instagram.engagementRate != null && (
                <div>
                  <div className="text-lg font-semibold">{(instagram.engagementRate * 100).toFixed(1)}%</div>
                  <div className="text-xs text-muted-foreground" title={instagram.engagementFormula}>
                    Engagement
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Última sincronización oficial: {fechaRel(instagram.lastSyncedAt)} ·{' '}
              <span title={instagram.engagementFormula}>fórmula del engagement visible</span>
            </p>
          </div>

          {instagram.topContenidos.length > 0 && (
            <div className="text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Top contenidos del periodo
              </p>
              <ul className="space-y-1">
                {instagram.topContenidos.map((c, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5"
                  >
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-foreground/90 hover:underline"
                    >
                      {c.url || '(sin enlace)'}
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {c.views ? `${nf.format(c.views)} views · ` : ''}
                      {nf.format(c.likes ?? 0)} likes
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
