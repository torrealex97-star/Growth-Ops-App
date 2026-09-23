import crypto from 'crypto'

import { isDeprecatedMetaVersion, META_API_VERSION } from '@/lib/meta/api-version'
import { fetchAdAccounts, parseAccountIds, type MetaEnv } from '@/lib/meta/client'
import { classifyMetaError } from '@/lib/meta/errors'

// COMPROBACIÓN DE SALUD DE META, EN UN SOLO SITIO.
//
// Esto vivía dentro de `app/api/[tenant]/evergreen/settings/integraciones/route.ts`, encajado en el
// `probeGroup` de todas las integraciones. Sale aquí porque a partir de F2 hay un segundo interesado
// —el conector (`lib/conectores/meta`), que el panel de salud de datos consulta sin pasar por la
// pantalla de Integraciones— y dos comprobaciones distintas del mismo proveedor acaban dando dos
// veredictos distintos sobre la misma credencial. Es exactamente lo que el contrato viene a evitar.
//
// NO CAMBIA EL DIAGNÓSTICO: es el mismo código, con el mismo orden de comprobaciones, que ya
// distinguía versión deprecada, firma inválida, token y cuenta. Lo único que se añade es el código
// `sin_credenciales` cuando no hay token: una subcuenta que no usa Meta no está averiada, y sin esa
// distinción el historial la registraba como error (S0.7 §3.5).

/** Veredicto de una comprobación. `code` es una pista ESTABLE para elegir el arreglo a mostrar. */
export type VeredictoMeta = { ok: boolean; message: string; code?: string }

// Dos presupuestos distintos, los mismos que tenía el código original: la comprobación de firma
// puede encadenar dos llamadas, la de cada cuenta va en paralelo y no debe agotar la función.
const TIMEOUT_MS = 15_000
const TIMEOUT_CUENTA_MS = 10_000

/**
 * Firma `appsecret_proof` de una llamada a la Graph API. Devuelve cadena vacía si no hay secreto:
 * Meta solo la exige cuando la app activa "Require app secret".
 */
export function metaProof(token: string, appSecret?: string): string {
  // Se recortan los dos: un espacio o un salto de línea pegados al copiar rompen la firma y Meta
  // responde "Invalid appsecret_proof", que no señala en absoluto a un espacio invisible.
  const secret = appSecret?.trim()
  if (!secret) return ''
  return crypto.createHmac('sha256', secret).update(token.trim()).digest('hex')
}

/**
 * ¿Conecta Meta sin firmar? Se usa cuando la firma `appsecret_proof` falla, para poder decir si el
 * problema es SOLO el App Secret guardado.
 *
 * Meta exige la firma únicamente si la app tiene activado "Require app secret". Si sin firma responde
 * bien, la app NO la exige y el secreto guardado es basura que sobra; si sin firma también falla, hay
 * algo más (token, permisos) y decir "borra el secreto" sería mandar al sitio equivocado. Es la
 * diferencia entre diagnosticar y adivinar.
 */
async function conectaSinFirma(token: string, version: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${version}/me/adaccounts?limit=1&access_token=${encodeURIComponent(token.trim())}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    )
    const j = (await r.json().catch(() => ({}))) as { error?: unknown }
    return r.ok && !j.error
  } catch {
    return false
  }
}

/**
 * Comprueba credenciales y acceso a las cuentas publicitarias. NO escribe nada.
 *
 * Recibe la config ya descifrada en vez de leerla: es lo que permite probarla y lo que evita que el
 * bucle del cron arrastre el token de una subcuenta a la siguiente (ver `MetaEnv`).
 */
export async function comprobarSaludMeta(cfg: MetaEnv): Promise<VeredictoMeta> {
  const token = cfg.META_ACCESS_TOKEN
  // Falta de credencial NO es avería: es configuración pendiente. Sin el código, una subcuenta que
  // simplemente no usa Meta se pintaba en rojo y engordaba el recuento de errores.
  if (!token) return { ok: false, message: 'Falta el token de Meta.', code: 'sin_credenciales' }
  const ver = cfg.META_API_VERSION || META_API_VERSION
  // Meta retira versiones por calendario, no cuando te va mal: una subcuenta que fijó una versión
  // hace un año se entera de que está deprecada el día que dejan de responderle. Aquí se avisa
  // antes, aunque el token sea perfecto.
  if (isDeprecatedMetaVersion(cfg.META_API_VERSION)) {
    return {
      ok: false,
      message: `La versión de la API fijada en esta subcuenta (${cfg.META_API_VERSION}) está deprecada por Meta.`,
      code: 'version_deprecada',
    }
  }
  const proof = metaProof(token, cfg.META_APP_SECRET)
  const proofQs = proof ? `&appsecret_proof=${proof}` : ''
  // Si hay App Secret guardado, se comprueba ANTES que la firma que produce sea válida: es el fallo
  // que más veces bloquea esta integración, y disfrazado de "cuenta desconocida".
  if (proof) {
    const conFirma = await fetch(
      `https://graph.facebook.com/${ver}/me/adaccounts?limit=1&access_token=${encodeURIComponent(token.trim())}${proofQs}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    )
    const cuerpo = (await conFirma.json().catch(() => ({}))) as { error?: { message?: string } }
    if (/appsecret_proof/i.test(cuerpo.error?.message || '')) {
      const sinFirma = await conectaSinFirma(token, ver)
      return {
        ok: false,
        code: 'proof_invalido',
        message: sinFirma
          ? 'El App Secret guardado no es el de la app que generó el token. Sin él la conexión SÍ funciona: tu app de Meta no exige la firma, así que bórralo con el botón "Borrar" que hay junto al campo.'
          : 'El App Secret guardado no corresponde a la app que generó el token, y sin él Meta tampoco acepta el token: pega el App Secret de la MISMA app desde la que generaste el token.',
      }
    }
  }

  const accounts = parseAccountIds(cfg.META_AD_ACCOUNT_ID)
  // Sin cuentas explícitas → modo "todas": descubrir las accesibles por el token.
  if (accounts.length === 0) {
    try {
      const all = await fetchAdAccounts(token, ver, cfg.META_APP_SECRET)
      if (all.length === 0) {
        return { ok: false, message: 'El token es válido pero no ve ninguna cuenta publicitaria.', code: 'sin_cuentas' }
      }
      return { ok: true, message: `${all.length} cuenta(s) detectada(s): ${all.map((a) => a.name).join(', ')}` }
    } catch (e) {
      // El código lo pone el clasificador (lib/meta/errors.ts). Fijarlo a 'token_invalido' hacía que
      // un rate limit o una firma mal calculada propusieran "genera un token nuevo".
      return {
        ok: false,
        message: `No se pudieron listar las cuentas: ${(e as Error).message}`,
        code: (e as { code?: string }).code || 'respuesta_inesperada',
      }
    }
  }
  // Probar cada cuenta explícita; reportar OK solo si todas responden.
  const results = await Promise.all(
    accounts.map(async (acc) => {
      const url = `https://graph.facebook.com/${ver}/${acc}?fields=name,account_status&access_token=${encodeURIComponent(token)}${proofQs}`
      const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_CUENTA_MS) })
      const j = await r.json()
      return { acc, ok: r.ok && !j.error, name: j.name as string | undefined, body: j, status: r.status }
    })
  )
  const failed = results.filter((r) => !r.ok)
  if (failed.length > 0) {
    // El código de Meta dice si es el token, el permiso o el id de cuenta: tres arreglos distintos
    // que antes se resumían todos en "token_invalido".
    const causa = classifyMetaError(failed[0].body, failed[0].status)
    return { ok: false, message: `Cuenta ${failed.map((f) => f.acc).join(', ')}: ${causa.message}`, code: causa.code }
  }
  const names = results.map((r) => r.name || r.acc)
  return {
    ok: true,
    message: results.length === 1 ? `Cuenta: ${names[0]}` : `${results.length} cuentas OK: ${names.join(', ')}`,
  }
}
