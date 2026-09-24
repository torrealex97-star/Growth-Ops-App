import { fetchAdAccounts, type MetaEnv } from '@/lib/meta/client'
import { comprobarSaludMeta } from '@/lib/meta/salud'
import { runMetaAdsSync, runMetaDailySync, runMetaSync } from '@/lib/meta/sync'

import type { Conector, ConnectorManifest, ContextoConector, ResultadoSync } from '../contrato'

// F2 — META SOBRE EL CONTRATO.
//
// Igual que GHL: ESTO NO REESCRIBE META. Envuelve el código que lleva meses en producción
// (`lib/meta/sync.ts` para las tres pasadas, `lib/meta/salud.ts` para el diagnóstico,
// `lib/meta/client.ts` para hablar con la Graph API). El criterio de graduación de F2 es literal —
// "GHL y Meta siguen produciendo los mismos datos"—, así que una segunda implementación "más
// limpia" aquí sería justo lo contrario de lo que se pide.
//
// LO QUE APORTA: que el manifiesto diga la verdad sobre Meta sin leer seis ficheros, y que el panel
// de salud pueda preguntarle a UN sitio por sus credenciales, sus cuentas y su última pasada.

const cfgMeta = (ctx: ContextoConector): MetaEnv => ctx.cfg as MetaEnv

export const manifest: ConnectorManifest = {
  provider: 'meta',
  version: '1.0',
  label: 'Meta Ads',
  authMode: 'api_key',
  // Solo el token es obligatorio, igual que en el catálogo de Integraciones: sin cuentas escritas a
  // mano se sincronizan TODAS las accesibles, y el App Secret únicamente si la app exige firma.
  requiredKeys: ['META_ACCESS_TOKEN'],
  supportedObjects: ['campaigns'],
  // NO declara 'incremental', y el motivo no es técnico sino de datos: Meta REESCRIBE el pasado. El
  // gasto y las conversiones de un día se ajustan durante días por la ventana de atribución, así que
  // un cursor "ya traído hasta aquí" congelaría cifras que después cambian. Por eso cada pasada
  // vuelve a pedir la ventana entera.
  syncModes: ['backfill', 'manual'],
  capabilities: {
    discover: true,
    backfill: true,
    healthCheck: true,
    // Sin webhook: Meta no empuja cambios de insights, hay que preguntarle.
    // Sin `executeAction`: esta app LEE gasto, no crea ni pausa campañas. Declararlo "por si acaso"
    // anunciaría permiso para tocar la inversión publicitaria de un cliente.
  },
  // 200 llamadas por hora y usuario es el presupuesto de la Graph API; el cliente ya pagina dentro.
  rateLimitPorMinuto: 3,
}

export const conector: Conector = {
  manifest,

  async discover(ctx) {
    const cfg = cfgMeta(ctx)
    const token = cfg.META_ACCESS_TOKEN?.trim()
    if (!token) return { objetos: [] }
    const cuentas = await fetchAdAccounts(token, cfg.META_API_VERSION || undefined, cfg.META_APP_SECRET)
    // `status` 1 = activa. Se marca en la etiqueta para no elegir a ciegas una cuenta cerrada o en
    // revisión, que devolvería cero gasto sin que eso signifique que no se gastó.
    return { objetos: cuentas.map((c) => ({ id: c.id, label: c.status === 1 ? c.name : `${c.name} (inactiva)` })) }
  },

  async healthCheck(ctx) {
    const v = await comprobarSaludMeta(cfgMeta(ctx))
    return { ok: v.ok, mensaje: v.message, codigo: v.code }
  },

  async backfill(ctx): Promise<ResultadoSync> {
    // Las TRES pasadas que hoy corren en tres crons distintos (campañas, diario y anuncios). Van
    // juntas porque el diario y los anuncios dependen del mapa de campañas que escribe la primera:
    // lanzarlas por separado y en otro orden dejaba `campaign_daily` vacía sin ningún error.
    const cfg = cfgMeta(ctx)
    const campanas = await runMetaSync(ctx.sb, ctx.tenantId, cfg)
    const diario = await runMetaDailySync(ctx.sb, ctx.tenantId, cfg)
    const anuncios = await runMetaAdsSync(ctx.sb, ctx.tenantId, cfg)
    return {
      escritos: campanas.synced + diario.daysSynced + anuncios.adsSynced,
      // Meta no trunca por tiempo aquí: el cliente pagina hasta agotar la ventana o falla.
      truncado: false,
      // Sin cursor A PROPÓSITO (ver el manifiesto): el pasado se reescribe.
      cursor: null,
      // Los fallos parciales viajan, no se tragan: una cuenta caída no puede parecer "0 campañas".
      incidencias: [...campanas.failures, ...diario.failures, ...anuncios.failures],
    }
  },
}
