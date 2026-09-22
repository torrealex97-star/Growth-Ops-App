import type { SupabaseClient } from '@supabase/supabase-js'

// CAMPOS PERSONALIZADOS DE GHL → contacts.custom_fields.
//
// GHL trae sus campos personalizados en varias formas según el canal (webhook o API de
// contactos): objeto `{ "Nombre campo": valor }`, array `[{ id|key|name, value }]` o campos
// planos con prefijo `custom.`. Este módulo normaliza cualquiera de ellas a un mapa
// `{ "<field_key>": valor }` y lo convierte al jsonb de la app `{ "<custom_field_defs.id>": valor }`,
// creando en la subcuenta las definiciones que falten (texto por defecto; fecha/boolean/número
// cuando el valor es inequívoco).
//
// REGLA DE ORO: no se inventa estructura — lo que no se pueda tipar razonablemente entra como
// texto, y los valores vacíos nunca crean definiciones.

export type CustomFieldValue = string | number | boolean

/** Clave estable para un campo GHL: minúsculas, guiones bajos, sin acentos. */
export function slugGhlField(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

/** Extrae pares [nombre, valor] de cualquiera de las formas de GHL. Solo nombres no vacíos. */
export function extraerParesGhl(source: Record<string, unknown>): Array<[string, unknown]> {
  const pares: Array<[string, unknown]> = []
  const empujar = (nombre: unknown, valor: unknown) => {
    const n = typeof nombre === 'string' ? nombre.trim() : ''
    if (n && valor !== undefined && valor !== null && valor !== '') pares.push([n, valor])
  }

  // 1) customFields / custom_data / customData: objeto o array
  const cf = source.customFields ?? source.custom_data ?? source.customData
  if (Array.isArray(cf)) {
    for (const it of cf) {
      const obj = it as Record<string, unknown> | null
      empujar(obj?.name ?? obj?.label ?? obj?.key ?? obj?.id, obj?.value ?? obj?.val)
    }
  } else if (cf && typeof cf === 'object') {
    for (const [k, v] of Object.entries(cf as Record<string, unknown>)) empujar(k, v)
  }

  // 2) Campos planos con prefijo custom. (webhook: custom.mi_campo = valor)
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith('custom.')) empujar(k.slice('custom.'.length), v)
  }

  return pares
}

/** Tipo más específico que se puede defender del valor GHL (siempre texto como base). */
export function inferirTipo(valor: unknown): 'text' | 'number' | 'boolean' {
  if (typeof valor === 'boolean') return 'boolean'
  if (typeof valor === 'number') return 'number'
  if (typeof valor === 'string') {
    const v = valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
    if (/^(true|false|yes|no|si)$/.test(v)) return 'boolean'
    if (/^-?\d+(.\d+)?$/.test(v) && v.length <= 15) return 'number'
  }
  return 'text'
}

/** Convierte el valor GHL al tipo de la definición; null si no encaja (no se fuerza). */
export function convertirValor(valor: unknown, tipo: 'text' | 'number' | 'boolean' | 'date'): CustomFieldValue | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (tipo === 'boolean') {
    if (typeof valor === 'boolean') return valor
    const v = String(valor)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
    if (['true', 'yes', 'si'].includes(v)) return true
    if (['false', 'no'].includes(v)) return false
    return null
  }
  if (tipo === 'number') {
    const n = Number(typeof valor === 'string' ? valor.replace(',', '.') : valor)
    return Number.isFinite(n) ? n : null
  }
  const s = String(valor).trim()
  return s === '' ? null : s
}

/**
 * Tipo del catálogo de GHL → tipo de la app. GHL declara el tipo en su carpeta de campos
 * (GET /locations/{locationId}/customFields); lo que no sepamos mapearlo entra como texto.
 */
export function tipoDesdeGhl(tipoGhl: string | null | undefined): 'text' | 'number' | 'boolean' | 'date' {
  switch ((tipoGhl ?? '').toLowerCase()) {
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    case 'checkbox':
      return 'boolean'
    default:
      return 'text'
  }
}

export type MapeoGhl = {
  /** field_key (slug) → label original, para crear definiciones que falten. */
  definiciones: Map<string, { label: string; field_type: 'text' | 'number' | 'boolean' | 'date' }>
  /** field_key → valor ya tipado. */
  valores: Map<string, CustomFieldValue>
}

/**
 * Normaliza las custom fields de un contacto GHL al modelo de la app.
 * Las definiciones se proponen con el tipo inferido de la PRIMERA vez que se ve el campo;
 * re-run con otro tipo no reescribe la definición (merge hacia arriba: a texto siempre se deja).
 */
export function mapearCustomFieldsGhl(source: Record<string, unknown>): MapeoGhl {
  const definiciones = new Map<string, { label: string; field_type: 'text' | 'number' | 'boolean' | 'date' }>()
  const valores = new Map<string, CustomFieldValue>()

  for (const [label, raw] of extraerParesGhl(source)) {
    const key = slugGhlField(label)
    if (!key) continue
    const tipo = inferirTipo(raw)
    const previa = definiciones.get(key)
    if (!previa) {
      definiciones.set(key, { label, field_type: tipo })
    } else if (previa.field_type !== 'text' && tipo !== previa.field_type) {
      // Dos valores de tipos distintos → el denominador común es texto.
      definiciones.set(key, { ...previa, field_type: 'text' })
    }
    const convertido = convertirValor(raw, definiciones.get(key)!.field_type)
    if (convertido !== null) valores.set(key, convertido)
  }

  return { definiciones, valores }
}

/**
 * Aplica un mapeo a un contacto real: crea (o reutiliza) definiciones en la subcuenta y
 * devuelve el objeto `custom_fields` MERGEado para el PATCH del contacto. Idempotente por
 * construcción: re-ejecutar produce el mismo resultado.
 */
export async function aplicarCustomFieldsGhl(
  sb: SupabaseClient,
  tenantId: string,
  contactId: string,
  source: Record<string, unknown>,
  definicionesCache?: Map<string, Map<string, string>>,
  opts?: {
    /** slug de campo GHL → nombre legible del catálogo (definiciones nuevas lo usan como label). */
    nombresGhl?: Map<string, string>
    /** custom_fields ya cargados del contacto (ahorra un SELECT por contacto en el backfill). */
    customFieldsActuales?: Record<string, CustomFieldValue> | null
  }
): Promise<{ customFields: Record<string, CustomFieldValue> | null; creadas: number }> {
  const mapeo = mapearCustomFieldsGhl(source)
  if (mapeo.valores.size === 0) return { customFields: null, creadas: 0 }

  // Cache por tenant: field_key → id (evita N queries de definiciones por contacto).
  const cache = definicionesCache ?? new Map<string, Map<string, string>>()
  if (!cache.has('map')) cache.set('map', new Map())
  const keyToId = cache.get('map')!

  // 1) Asegurar definiciones (las que falten se crean; las existentes nunca se retipan).
  let creadas = 0
  for (const [fieldKey, def] of mapeo.definiciones) {
    if (keyToId.has(fieldKey)) continue
    const { data: existente } = await sb
      .from('custom_field_defs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('field_key', fieldKey)
      .maybeSingle()
    if (existente?.id) {
      keyToId.set(fieldKey, existente.id)
      continue
    }
    // El catálogo de GHL da el nombre legible; si no lo tenemos, el label original del contacto.
    const labelLegible = opts?.nombresGhl?.get(fieldKey) ?? def.label
    const { data: nueva, error } = await sb
      .from('custom_field_defs')
      .insert({
        tenant_id: tenantId,
        field_key: fieldKey,
        label: labelLegible,
        field_type: def.field_type,
      })
      .select('id')
      .single()
    // Otra pasada en paralelo pudo crearla: en unique violation se relee y se sigue.
    if (error) {
      const { data: releida } = await sb
        .from('custom_field_defs')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('field_key', fieldKey)
        .maybeSingle()
      if (!releida?.id) throw error
      keyToId.set(fieldKey, releida.id)
      continue
    }
    keyToId.set(fieldKey, nueva.id)
    creadas++
  }

  // 2) Merge con los valores ya guardados del contacto (nunca pisar con vacío).
  let actuales: Record<string, CustomFieldValue> | null = null
  if (opts?.customFieldsActuales !== undefined) {
    actuales = opts.customFieldsActuales
  } else {
    const { data: fila } = await sb
      .from('contacts')
      .select('custom_fields')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .single()
    actuales = (fila?.custom_fields as Record<string, CustomFieldValue> | null) ?? null
  }
  const merged: Record<string, CustomFieldValue> = { ...(actuales ?? {}) }
  for (const [fieldKey, valor] of mapeo.valores) {
    const id = keyToId.get(fieldKey)
    if (id) merged[id] = valor
  }
  return { customFields: merged, creadas }
}
