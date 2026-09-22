import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverColaboradorPorCodigo } from '@/lib/collaborators/scope'

// SEÑAL DE REFERIDO (?ref=) DEL COLABORADOR — reglas de negocio en UN sitio.
//
// Este módulo decide DOS cosas que antes vivían sueltas en el webhook de GHL:
//
// 1) DÓNDE puede venir el código del colaborador. Además del parámetro clásico
//    ?ref=CODIGO, el propietario quiere poder enviarlo por CAMPO PERSONALIZADO
//    de GHL (hay cuentas con varias colaboradoras y cada flujo etiqueta al suyo
//    como quiera). Se acepta cualquier campo cuyo nombre se parezca a
//    ref / referral / colaborador / código / tracking / affiliate, y el valor
//    tiene forma de código (letras y números). Da igual cómo GHL serialice el
//    campo: objeto customData, array customFields o preguntas y respuestas.
//
// 2) CUTOFF TEMPORAL (regla del propietario, 21-sep): un colaborador SOLO
//    atribuye contactos cuya fecha real — first_seen_at tal como llegó de GHL,
//    o created_at si faltara — es AGOSTO 2026 o posterior. Todo lo anterior
//    queda fuera AHORA Y SIEMPRE: ningún toque nuevo, backfill o trigger
//    futuro puede re-atribuir un contacto anterior al cutoff. La fecha es una
//    constante aquí y en la migración 20260921230000 (misma regla en la capa
//    de datos); cambiarla es una decisión consciente en ambos sitios.

/** Fecha del cutoff: contactos anteriores NO se atribuyen a colaboradores. */
export const COLLABORATOR_ATTRIBUTION_CUTOFF_ISO = '2026-08-01T00:00:00.000Z'

/**
 * ¿Es el contacto anterior al cutoff? Recibe la fila del contacto (o un
 * payload suelto con first_seen_at/created_at): lo que haya, la más antigua.
 * Sin fechas legibles NO se considera anterior (fail-open para contactos
 * nuevos, que es el caso normal) — el corte histórico lo garantiza la
 * migración, que sí parte de datos ya escritos.
 */
export function attributionDateBeforeCutoff(contact: {
  first_seen_at?: string | Date | null
  created_at?: string | Date | null
}): boolean {
  const raw = contact?.first_seen_at ?? contact?.created_at ?? null
  if (!raw) return false
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime()
  if (Number.isNaN(t)) return false
  return t < new Date(COLLABORATOR_ATTRIBUTION_CUTOFF_ISO).getTime()
}

/** Solo forma de código: letras y dígitos (los códigos son 8, mayúsculas). */
const FORMA_CODIGO = /^[A-Z0-9]{4,20}$/

/** Nombres de campo que reconocemos como "código de colaborador". */
const CLAVES_REF =
  /^(ref|referral|colaborador|colaboradora|codigo_colaborador|c[óo]digo|codigo|collaborator_code|collaborator|affiliate_code|affiliate|tracking_code|tracking|c)$/i

/** Claves de contenedores donde GHL mete los campos personalizados. */
const CONTENEDORES = [
  'customData',
  'custom_data',
  'customFields',
  'custom_fields',
  'questions_and_answers',
  'questionsAndAnswers',
] as const

function codigoDeValor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const code = v.trim().toUpperCase()
  return FORMA_CODIGO.test(code) ? code : null
}

/**
 * Extrae el código de referido del payload de un webhook, donde esté:
 * parámetros planos (ref=...) o cualquier campo personalizado cuyo nombre
 * pinte a referido. Devuelve el código NORMALIZADO (mayúsculas) o null.
 *
 * No resuelve nada contra la BD: eso es `resolverRefColaborador` (el código
 * nunca es identidad; se resuelve server-side al UUID del perfil).
 */
export function extraerCodigoRef(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>

  // 1) Parámetros planos (el camino ?ref= de siempre).
  for (const [k, v] of Object.entries(p)) {
    if (!CLAVES_REF.test(k)) continue
    const code = codigoDeValor(v)
    if (code) return code
  }

  // 2) Campos personalizados de GHL, en sus tres serializaciones:
  //    objeto {nombre: valor}, array [{name|label|key, value}] o
  //    preguntas [{question, answer}].
  for (const cont of CONTENEDORES) {
    const c = p[cont]
    if (Array.isArray(c)) {
      for (const it of c) {
        if (!it || typeof it !== 'object') continue
        const o = it as Record<string, unknown>
        const nombre = (o.name ?? o.label ?? o.key ?? o.question ?? o.q ?? '').toString()
        if (!CLAVES_REF.test(nombre.trim())) continue
        const code = codigoDeValor(o.value ?? o.answer ?? o.a)
        if (code) return code
      }
    } else if (c && typeof c === 'object') {
      for (const [nombre, v] of Object.entries(c as Record<string, unknown>)) {
        if (!CLAVES_REF.test(nombre)) continue
        const code = codigoDeValor(v)
        if (code) return code
      }
    }
  }

  return null
}

/**
 * Resuelve el código de referido del payload al perfil de colaborador ACTIVO
 * en la subcuenta. `null` si no hay código, si el perfil no existe o si está
 * inactivo — igual que hacía el webhook con ?ref=, ahora para todas las vías.
 * Devuelve también el código NORMALIZADO: el llamador lo escribe en
 * utm_content cuando el toque no trae uno, para que la capa de datos (triggers
 * de backfill, reporting) vea el código aunque llegara por campo personalizado.
 * Los errores de BD no tumban el webhook: se registran.
 */
export async function resolverRefColaborador(
  sb: SupabaseClient,
  tenantId: string,
  payload: unknown
): Promise<{ id: string; code: string } | null> {
  const code = extraerCodigoRef(payload)
  if (!code) return null
  try {
    const perfil = await resolverColaboradorPorCodigo(sb, tenantId, code)
    return perfil ? { id: perfil.id, code } : null
  } catch (e) {
    console.warn('[colaborador] no se pudo resolver el código de referido:', e instanceof Error ? e.message : e)
    return null
  }
}
