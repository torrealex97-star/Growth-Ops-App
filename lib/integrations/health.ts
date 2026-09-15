// Estado real de cada integración: la luz verde/gris/roja de Configuración › Integraciones.
//
// LA REGLA. "Conectada" (verde) significa que se ha hablado con la API de verdad y respondió bien,
// no que haya un token escrito en un campo. Un panel que pinte verde porque existe la credencial
// miente exactamente igual que el "Meta: conectado" que estuvo meses tapando que nadie ejecutaba sus
// crons (ver lib/ops/sync-health.ts). Por eso una integración configurada pero sin comprobar sale
// GRIS, no verde: no sabemos si funciona, y decirlo es más útil que adivinarlo.
//
// Tres luces, como se pidió, y cada una con su frase:
//   · verde  → comprobada contra su API y respondiendo, sin sincronizaciones rotas.
//   · gris   → no configurada, o configurada y sin comprobar (o con la comprobación caducada).
//   · roja   → la comprobación falló, o una de sus sincronizaciones no puede funcionar.
import { isRetryableCode } from '@/lib/integrations/sync-runs'
import { assessSync, SYNC_DEFS, type HealthFacts, type SyncHealth } from '@/lib/ops/sync-health'

// 'parcial' existe porque sin él la pantalla saltaba de verde a rojo sin que cambiara nada real:
// Meta tiene TRES sincronizaciones (meta, meta-daily, meta-ads) y bastaba que una topara con el
// límite de peticiones de la Graph API para pintar toda la integración en rojo; al siguiente cron se
// recuperaba y volvía a verde. Un fallo reintentable con el resto de sincronizaciones sanas no es
// "con error": es "parcial", y no hay nada que arreglar salvo esperar.
type IntegrationStatus = 'conectada' | 'parcial' | 'sin_configurar' | 'error'

/** Resultado de la última comprobación real contra la API, tal y como se guarda. */
export type LastCheck = {
  ok: boolean
  message: string
  checkedAt: string
  /** Pista estable para poder dar el arreglo concreto sin parsear el mensaje. */
  code?: string
}

/**
 * Una comprobación caduca a las 24 h. Pasado ese tiempo la integración vuelve a gris: los tokens
 * caducan, se revocan y se rotan sin avisar, así que un "verde" de la semana pasada no es
 * información sobre hoy. No se comprueban las 17 integraciones al abrir la pantalla (17 llamadas a
 * APIs externas por visita), se comprueba la que se abre y hay un botón para todas.
 */
export const CHECK_TTL_MS = 24 * 60 * 60 * 1000

export type IntegrationHealth = {
  id: string
  status: IntegrationStatus
  /** Etiqueta corta para la píldora. */
  headline: string
  /** Una frase que explica el estado. Nunca un código. */
  detail: string
  /** Qué hacer para arreglarlo, cuando hay algo que hacer. */
  fix?: string
  checkedAt: string | null
  stale: boolean
  missingKeys: string[]
  syncs: SyncHealth[]
}

/** Qué sincronizaciones pertenecen a cada integración del catálogo. */
export const SYNCS_BY_GROUP: Record<string, string[]> = {
  meta: ['meta', 'meta-daily', 'meta-ads'],
  instagram: ['instagram', 'reels'],
  youtube: ['youtube-backfill'],
  ai: ['analyze-calls', 'ai-insights'],
  sequra: ['sequra-morosos'],
  stripe: ['stripe-customers'],
  email: ['reminders'],
}

export function isStale(checkedAt: string | null | undefined, now: number): boolean {
  if (!checkedAt) return true
  const t = Date.parse(checkedAt)
  // Una fecha ilegible se trata como "no comprobada": inventarse que está fresca sería lo único peor.
  if (Number.isNaN(t)) return true
  return now - t > CHECK_TTL_MS
}

export function assessIntegration(
  group: { id: string; required?: string[]; requiredAny?: string[]; testable: boolean },
  args: { facts: HealthFacts; lastCheck?: LastCheck | null; now?: number }
): IntegrationHealth {
  const now = args.now ?? Date.now()
  const required = group.required ?? []
  const requiredAny = group.requiredAny ?? []
  const anyConfigured = requiredAny.length === 0 || requiredAny.some((k) => args.facts.configuredKeys.has(k))
  const missingKeys = [
    ...required.filter((k) => !args.facts.configuredKeys.has(k)),
    ...(anyConfigured ? [] : requiredAny),
  ]
  const syncs = (SYNCS_BY_GROUP[group.id] ?? [])
    .map((id) => SYNC_DEFS.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map((d) => assessSync(d, args.facts))
  const checkedAt = args.lastCheck?.checkedAt ?? null
  const stale = isStale(checkedAt, now)
  const base = { id: group.id, checkedAt, stale, missingKeys, syncs }

  if (missingKeys.length > 0) {
    return {
      ...base,
      status: 'sin_configurar',
      headline: 'Sin configurar',
      detail: !anyConfigured
        ? `Conecta al menos una alternativa: ${requiredAny.join(' o ')}.`
        : required.length === missingKeys.length
          ? 'Todavía no has conectado esta integración.'
          : `Falta rellenar ${missingKeys.length} de ${required.length} datos obligatorios.`,
      fix: !anyConfigured
        ? `Rellena ${requiredAny.join(' o ')} y pulsa Guardar.`
        : `Rellena ${missingKeys.join(', ')} y pulsa Guardar.`,
    }
  }

  // Una comprobación fallida manda sobre todo lo demás: si la API rechaza la credencial, lo que
  // digan las sincronizaciones es secundario.
  if (args.lastCheck && !args.lastCheck.ok) {
    return {
      ...base,
      status: 'error',
      headline: 'Con error',
      detail: args.lastCheck.message,
      fix: fixFor(args.lastCheck.code, group.id),
    }
  }

  // La última sincronización FALLÓ. Es rojo aunque las credenciales respondan al comprobarlas: el
  // usuario cree que tiene datos actualizados y no los tiene, y ahora sí sabemos por qué (el motivo
  // se guarda en integration_sync_runs en vez de perderse en los logs de Vercel).
  const fallidas = syncs.filter((s) => s.status === 'sync_fallido')
  if (fallidas.length > 0) {
    // PARCIAL, no error, cuando se cumplen las dos: queda alguna sincronización sana y TODOS los
    // fallos son reintentables (límite de peticiones, red, timeout). Ese caso se arregla solo en la
    // siguiente pasada, y pintarlo rojo manda a revisar credenciales que están perfectas.
    const sanas = syncs.filter((s) => s.status !== 'sync_fallido')
    const todosReintentables = fallidas.every((f) => isRetryableCode(f.lastErrorCode))
    const peor = fallidas.find((f) => !isRetryableCode(f.lastErrorCode)) ?? fallidas[0]
    if (sanas.length > 0 && todosReintentables) {
      return {
        ...base,
        status: 'parcial',
        headline: `${fallidas.length} de ${syncs.length} sincronizaciones con problemas temporales`,
        detail: `${peor.detail} Las otras ${sanas.length} funcionan, así que tus credenciales están bien.`,
        fix: fixFor(peor.lastErrorCode ?? undefined, group.id),
      }
    }
    return {
      ...base,
      status: 'error',
      headline:
        fallidas.length === syncs.length
          ? 'La última sincronización falló'
          : `${fallidas.length} de ${syncs.length} sincronizaciones fallaron`,
      detail: peor.detail,
      fix: fixFor(peor.lastErrorCode ?? undefined, group.id),
    }
  }

  // Credenciales bien y API respondiendo, pero hay una sincronización que NO puede funcionar (nadie
  // la ejecuta). Eso es rojo: el usuario cree que tiene datos y no le van a llegar.
  const roto = syncs.find((s) => s.status === 'sin_planificador')
  if (roto) {
    return {
      ...base,
      status: 'error',
      headline: 'Conectada pero sin sincronizar',
      detail: roto.detail,
      fix: 'Es un problema de configuración del servidor, no de tus credenciales: avisa a quien administra la plataforma.',
    }
  }

  if (!args.lastCheck || stale) {
    return {
      ...base,
      status: 'sin_configurar',
      headline: args.lastCheck ? 'Sin comprobar hoy' : 'Sin comprobar',
      detail: args.lastCheck
        ? 'Los datos están puestos, pero la última comprobación es de hace más de un día y los tokens caducan sin avisar.'
        : 'Los datos están puestos, pero todavía no se ha comprobado contra su API.',
      fix: group.testable
        ? 'Pulsa "Comprobar" para hablar con la API y ver si responde.'
        : 'Esta integración no tiene comprobación automática: se verá en la primera sincronización.',
    }
  }

  // Verde. Que aún no haya datos NO baja la luz: una integración recién conectada está bien
  // conectada, y decir lo contrario haría que el usuario tocara credenciales que están perfectas.
  const sinDatos = syncs.filter((s) => s.status === 'sin_datos')
  return {
    ...base,
    status: 'conectada',
    headline: 'Conectada',
    detail:
      sinDatos.length > 0
        ? `${args.lastCheck.message} Todavía no ha traído datos: ${sinDatos[0].detail}`
        : args.lastCheck.message,
  }
}

/**
 * Arreglo concreto por tipo de fallo. Se busca primero por código porque el mensaje lo escribe la
 * API externa y cambia sin avisar; el código lo pone nuestro comprobador.
 */
export function fixFor(code: string | undefined, groupId: string): string | undefined {
  if (code && code in FIXES) return FIXES[code]
  return FIXES[`${groupId}:generico`]
}

export const FIXES: Record<string, string> = {
  token_invalido:
    'La credencial ya no vale: se ha caducado, rotado o revocado. Genera una nueva en el panel del proveedor, pégala aquí y vuelve a comprobar.',
  token_incompleto:
    'Vuelve a copiar el token ENTERO desde Meta (son más de 150 caracteres y es fácil dejarse el final) y pégalo de nuevo. Debajo del campo verás cuántos caracteres hay guardados: si son muchos menos, se cortó al pegar.',
  token_caducado: 'El token ha caducado. Genera uno que no expire (en Meta, un token de System User) y pégalo aquí.',
  sin_permisos:
    'La credencial es válida pero no tiene permisos para lo que necesitamos. Revisa los permisos en el panel del proveedor y vuelve a generarla.',
  sin_cuentas:
    'La credencial funciona pero no ve ninguna cuenta. Da acceso a la cuenta desde el panel del proveedor y vuelve a comprobar.',
  dominio_no_verificado:
    'El dominio del remitente no está verificado, así que los correos no saldrían. Verifícalo en el panel del proveedor y vuelve a comprobar.',
  proof_invalido:
    'Vacía el campo "App Secret" en opciones avanzadas y vuelve a comprobar: solo hace falta si tu app de Meta exige la firma appsecret_proof. Si la exige, pega el App Secret de LA MISMA app que generó el token (Meta for Developers › Configuración › Básica).',
  cuenta_incorrecta:
    'El identificador de la cuenta publicitaria no le suena a Meta. Bórralo y usa "Buscar cuentas" para elegirla de la lista en vez de escribirlo a mano.',
  limite_de_uso:
    'El proveedor ha limitado las peticiones durante un rato. No hay nada que arreglar: vuelve a comprobar en unos minutos.',
  respuesta_inesperada:
    'El proveedor respondió algo que no esperábamos. Vuelve a comprobar; si sigue igual, copia este mensaje y mándalo a soporte.',
  sin_saldo:
    'La clave es válida pero la cuenta no tiene saldo. Recarga en el panel del proveedor: no hace falta tocar la credencial.',
  modelo_no_disponible:
    'Borra el modelo predeterminado en opciones avanzadas para usar el de por defecto, o escribe uno al que tu cuenta sí tenga acceso.',
  version_deprecada:
    'Borra el campo "Versión de la API" para usar la que la aplicación mantiene al día. Solo hace falta fijarla a mano para probar una versión nueva.',
  red: 'No se pudo llegar a la API. Suele ser temporal: vuelve a comprobar en un minuto. Si sigue, revisa si el proveedor tiene una incidencia abierta.',
  'meta:generico':
    'Revisa el token en Meta Business (Configuración del negocio › Usuarios del sistema) y que tenga permiso ads_read sobre la cuenta publicitaria.',
  'stripe:generico': 'Revisa la clave secreta en Stripe › Desarrolladores › Claves de API.',
  'calendly:generico': 'Revisa el token personal en Calendly › Integraciones › Tu token de API.',
}
