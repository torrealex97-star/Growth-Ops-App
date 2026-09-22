// SNAPSHOT DE CONVERSACIONES IG (respaldo stale).
// El endpoint de conversaciones de Meta es el más inestable de la Graph API para esta página
// (error #1, timeouts de 30s+). Cuando no responde, la pestaña no puede quedarse vacía: se
// sirve el ÚLTIMO resultado correcto (guardado en BD tras cada descarga buena) con su edad
// declarada. Los datos cacheados tienen fecha: nunca se presentan como frescos.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { IgConversation } from '@/lib/instagram/client'

export type SnapshotConversaciones = {
  conversaciones: IgConversation[]
  guardado: string // ISO-8601
}

const KEY = 'ig_conversaciones_snapshot'

// Igual que lib/config.ts: cliente de servicio (RLS bypaseado) — la ruta ya autenticó al usuario.
function cliente(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Edad en minutos legible: "hace 3 min", "hace 2 h 5 min", "hace 1 d 3 h".
export function edadLegible(iso: string, ahora = Date.now()): string {
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000))
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return `hace ${h} h ${m ? `${m} min` : ''}`.trim()
  const d = Math.floor(h / 24)
  return `hace ${d} d ${h % 24 ? `${h % 24} h` : ''}`.trim()
}

// Guarda (upsert) el snapshot tras una descarga buena. Un fallo al guardar NO rompe la carga:
// la función devuelve silenciosamente y la próxima descarga buena volverá a intentarlo.
export async function guardarSnapshot(tenantId: string, conversaciones: IgConversation[]): Promise<void> {
  try {
    const sb = cliente()
    await sb
      .from('integration_settings')
      .upsert(
        {
          tenant_id: tenantId,
          key: KEY,
          value: JSON.stringify({ conversaciones, guardado: new Date().toISOString() }),
          is_secret: false,
          label: 'Snapshot del listado de conversaciones de Instagram (respaldo cuando Meta no responde)',
        },
        { onConflict: 'tenant_id,key' }
      )
      .select('key')
  } catch {
    // Silencioso por diseño: el snapshot es una optimización, no un requisito.
  }
}

// Lee el snapshot. `null` si nunca hubo descarga buena (o lectura imposible).
export async function leerSnapshot(tenantId: string): Promise<SnapshotConversaciones | null> {
  try {
    const sb = cliente()
    const { data } = await sb
      .from('integration_settings')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', KEY)
      .maybeSingle()
    if (!data?.value) return null
    const j = JSON.parse((data as { value: string }).value) as SnapshotConversaciones
    if (!Array.isArray(j.conversaciones) || typeof j.guardado !== 'string') return null
    return j
  } catch {
    return null
  }
}
