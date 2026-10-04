import type { SupabaseClient } from '@supabase/supabase-js'

import type { LastCheck } from '@/lib/integrations/health'

// ÚLTIMO VEREDICTO DE «COMPROBAR AHORA» POR INTEGRACIÓN.
//
// Vivía dentro de la ruta de Integraciones y solo se escribía cuando alguien pulsaba «Probar». Resultado:
// toda integración que nadie hubiera probado a mano salía «Sin comprobar» para siempre, aunque llevara
// semanas sincronizando bien, o semanas rota sin que la pantalla se enterara. Sale a `lib/` para que
// los crons guarden el veredicto cada vez que corren, con la misma función que usa la pantalla.

export const HEALTH_KEY = 'INTEGRATION_HEALTH'

export type VeredictoGuardable = { ok: boolean; message: string; code?: string }

/** Lee el JSON guardado, descartando cualquier entrada que no tenga la forma esperada. */
export function parseLastChecks(raw: string | null | undefined): Record<string, LastCheck> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, LastCheck> = {}
    for (const [group, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<LastCheck>
      if (typeof v?.ok !== 'boolean' || typeof v?.checkedAt !== 'string') continue
      out[group] = {
        ok: v.ok,
        message: typeof v.message === 'string' ? v.message : '',
        checkedAt: v.checkedAt,
        code: typeof v.code === 'string' ? v.code : undefined,
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Guarda el último veredicto de una integración. NUNCA lanza: un fallo al guardar el estado no puede
 * tumbar ni la comprobación ni la sincronización que la llama; como mucho la luz seguirá gris («sin
 * comprobar»), que es lo honesto si no se pudo registrar.
 */
export async function guardarComprobacion(
  sb: SupabaseClient,
  tenantId: string,
  group: string,
  result: VeredictoGuardable
): Promise<void> {
  if (!group) return
  try {
    const { data } = await sb
      .from('integration_settings')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', HEALTH_KEY)
      .maybeSingle()
    const actual = parseLastChecks((data as { value: string | null } | null)?.value)
    actual[group] = { ok: result.ok, message: result.message, code: result.code, checkedAt: new Date().toISOString() }
    const { error } = await sb.from('integration_settings').upsert(
      {
        tenant_id: tenantId,
        key: HEALTH_KEY,
        value: JSON.stringify(actual),
        is_secret: false,
        label: 'Último resultado de comprobación por integración',
      },
      { onConflict: 'tenant_id,key' }
    )
    if (error) console.warn(`[comprobaciones] no se pudo guardar el estado de ${group}:`, error.message)
  } catch (e) {
    console.warn(`[comprobaciones] no se pudo guardar el estado de ${group}:`, e instanceof Error ? e.message : e)
  }
}

/**
 * Ejecuta una comprobación y guarda su veredicto, con un TOPE de tiempo.
 *
 * Los crons recorren todas las subcuentas dentro de una función de 60 s: una comprobación lenta no
 * puede comerse el presupuesto de la sincronización. Si no responde a tiempo, no se guarda nada (la
 * luz sigue como estaba) en vez de guardar un «fallo» que no lo es. Nunca lanza.
 */
export async function comprobarYGuardar(
  sb: SupabaseClient,
  tenantId: string,
  group: string,
  comprobar: () => Promise<VeredictoGuardable>,
  limiteMs = 12_000
): Promise<void> {
  try {
    const veredicto = await Promise.race<VeredictoGuardable | null>([
      comprobar(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), limiteMs)),
    ])
    if (veredicto) await guardarComprobacion(sb, tenantId, group, veredicto)
  } catch (e) {
    console.warn(`[comprobaciones] la comprobación de ${group} falló:`, e instanceof Error ? e.message : e)
  }
}
