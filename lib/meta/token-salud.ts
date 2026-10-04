import { resumirAmbitos, type GrupoMeta } from '@/lib/meta/permisos'
import type { ResultadoInspeccion } from '@/lib/meta/token'

// VEREDICTO DE SALUD A PARTIR DEL TOKEN, EN UN SOLO SITIO.
//
// Convierte lo que Meta cuenta del token (`lib/meta/token.ts`) en un mensaje con arreglo para la
// pantalla de Integraciones. PURO: no toca red ni reloj (`ahora` es un parámetro), así que cada caso
// —token muerto, permiso que falta, token que caduca en dos horas— se prueba con una respuesta real.
//
// REGLA CLAVE: no poder inspeccionar el token NO empeora el veredicto. Solo se añade información;
// nunca se declara avería por no haberla podido obtener.

export type VeredictoToken = {
  /** `false` = el token no vale para esta integración. Solo si Meta lo ha dicho de forma explícita. */
  ok: boolean
  code?: 'token_invalido' | 'sin_permisos'
  /** Frase para la pantalla. Vacía si no hay nada que añadir. */
  mensaje: string
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })

function cuando(horas: number | null, iso: string | null): string {
  if (horas !== null && horas < 48) return `en ${Math.max(1, Math.round(horas))} h`
  return iso ? `el ${fecha(iso)}` : 'pronto'
}

export function veredictoDeToken(res: ResultadoInspeccion, grupo: GrupoMeta): VeredictoToken {
  if (res.estado !== 'ok') return { ok: true, mensaje: '' }
  const { info } = res

  if (!info.valido) {
    return {
      ok: false,
      code: 'token_invalido',
      mensaje:
        `Meta dice que el token ya no es válido${info.motivo ? ` (${info.motivo})` : ''}. ` +
        'Genera uno de System User —no caduca ni se invalida al cambiar una contraseña— y pégalo en Integraciones.',
    }
  }

  // Si Meta no lista ningún ámbito no se puede afirmar que falten: se trata como «no sé», no como «no tiene».
  if (info.ambitos.length > 0) {
    const r = resumirAmbitos(info.ambitos, grupo)
    if (r.faltanObligatorios.length > 0) {
      return {
        ok: false,
        code: 'sin_permisos',
        mensaje:
          `Al token le faltan permisos que esta integración necesita: ${r.faltanObligatorios.join(', ')}. ` +
          'Vuelve a generarlo marcándolos (Configuración del negocio › Usuarios del sistema › Generar token).',
      }
    }
  }

  const tipo = info.tipo === 'system_user' ? 'System User' : info.tipo
  if (info.duradero) {
    return { ok: true, mensaje: `Token que no caduca (${tipo}).` }
  }
  // Sin fecha y sin que Meta diga «no caduca»: no se sabe. Callar es más honesto que prometer.
  if (!info.caducaEl) return { ok: true, mensaje: '' }
  return {
    ok: true,
    mensaje:
      `Aviso: es un token de ${tipo === 'usuario' ? 'usuario' : tipo} y caduca ${cuando(info.horasRestantes, info.caducaEl)}. ` +
      'Genera uno de System User para que la sincronización no se detenga cuando caduque.',
  }
}
