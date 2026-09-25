import { idEventoGhl, propiedadesSinPii, tipoEventoGhl, type PayloadGhl } from '@/lib/eventos/ghl'
import { syncGhl } from '@/lib/integrations/citas-sync'

import type { Conector, ConnectorManifest, EventoNormalizado, ResultadoSync } from '../contrato'

// F2 — GHL SOBRE EL CONTRATO.
//
// ESTO NO REESCRIBE GHL. Envuelve el código que ya está en producción y probado
// (`lib/integrations/citas-sync.ts` para la sincronización, `lib/eventos/ghl.ts` para la
// normalización). El plan lo pide así — "refactorizar GHL y Meta al contrato SIN cambiar el
// comportamiento observable: adapters sobre el código probado" — y la graduación de F2 es
// exactamente eso: que sigan produciendo los mismos datos.
//
// LO QUE APORTA EL ENVOLTORIO: el manifiesto. Hasta ahora, para saber si GHL recibe webhooks, si
// tiene sincronización incremental o si puede escribir hacia fuera, había que leer tres ficheros.
// Ahora se declara, la suite comprueba que lo declarado existe, y el panel puede decir la verdad
// sobre cada integración sin inspeccionar código.

export const manifest: ConnectorManifest = {
  provider: 'ghl',
  version: '1.0',
  label: 'GoHighLevel',
  // Credenciales de naturaleza distinta, en campos distintos: token y ubicación para LEER su API,
  // secreto para VERIFICAR lo que él manda. Una subcuenta puede sincronizar perfectamente y tener
  // el webhook caído, y al revés: mezclarlas hacía que el panel diera un solo veredicto para dos
  // cosas que se rompen por separado.
  authMode: 'api_key',
  requiredKeys: ['GHL_API_TOKEN', 'GHL_LOCATION_ID'],
  webhookKeys: ['GHL_WEBHOOK_SECRET'],
  supportedObjects: ['contacts', 'appointments'],
  // NO declara 'incremental' a propósito. La API de GHL lista TODOS los contactos de la ubicación
  // antes de tocar eventos y no cabe en los 60 s de Vercel: dos pasadas en producción acabaron en
  // 504 y un run colgado (#112). Va por botón, y el webhook cubre el tiempo real.
  syncModes: ['webhook', 'manual'],
  capabilities: {
    ingestWebhook: true,
    backfill: true,
    healthCheck: true,
    // `executeAction` NO: hoy nada de esta app escribe hacia GHL, y declararlo "por si acaso"
    // anunciaría una capacidad que nadie ha revisado.
  },
  webhookPath: '/api/{tenant}/evergreen/webhooks/ghl',
  // GHL limita por ubicación; el número conservador que ya asumen las pasadas actuales.
  rateLimitPorMinuto: 100,
}

/**
 * PURO. Es la misma derivación que usa el webhook y el reprocesado (F1): una sola interpretación del
 * payload de GHL, no una copia para el conector que acabaría divergiendo.
 */
export function normalize(crudo: unknown): EventoNormalizado | null {
  if (!crudo || typeof crudo !== 'object') return null
  const payload = crudo as PayloadGhl
  const id = idEventoGhl(payload)
  if (!id) return null
  return {
    sourceEventId: id,
    tipo: tipoEventoGhl(payload),
    // GHL manda la fecha del hecho en varios nombres; la del sobre se resuelve en `hechoDesdeSobre`.
    // Aquí se conserva la que venga, y si no hay ninguna se declara vacío en vez de inventar "ahora".
    ocurridoEn:
      typeof payload.startTime === 'string'
        ? payload.startTime
        : typeof payload.dateUpdated === 'string'
          ? payload.dateUpdated
          : '',
    propiedades: propiedadesSinPii(payload),
  }
}

export const conector: Conector = {
  manifest,
  normalize,

  ingestWebhook(crudo) {
    // El webhook real hace mucho más (resuelve contacto, proyecta la cita, guarda el sobre). Esto es
    // la parte que el contrato promete: interpretar el payload. No escribe nada.
    return normalize(crudo)
  },

  async healthCheck(ctx) {
    const token = ctx.cfg.GHL_API_TOKEN
    const locationId = ctx.cfg.GHL_LOCATION_ID
    // Falta de credencial no es avería: es configuración pendiente. El código lo distingue para que
    // el panel no pinte en rojo una subcuenta que simplemente no usa GHL.
    if (!token || !locationId) {
      return { ok: false, mensaje: 'Faltan el token o el Location ID de GoHighLevel.', codigo: 'sin_credenciales' }
    }
    try {
      const r = await fetch(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}`, {
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      const j = (await r.json().catch(() => ({}))) as { location?: { name?: string }; message?: string }
      if (r.ok) return { ok: true, mensaje: `Subcuenta ${j.location?.name || locationId} conectada.` }
      return {
        ok: false,
        mensaje: j.message || `GoHighLevel respondió ${r.status}.`,
        codigo: r.status === 401 ? 'token_invalido' : r.status === 403 ? 'sin_permisos' : 'error',
      }
    } catch {
      return { ok: false, mensaje: 'GoHighLevel no respondió a tiempo.', codigo: 'sin_respuesta' }
    }
  },

  async backfill(ctx, rango): Promise<ResultadoSync> {
    // Delega en la implementación de producción. Una segunda implementación "más limpia" aquí
    // significaría dos comportamientos que divergen, que es justo lo que F2 viene a evitar.
    const resultado = (await syncGhl(ctx.sb, ctx.tenantId, ctx.cfg as Record<string, string>, {
      desdeInicio: rango.desde,
      deadlineMs: ctx.deadline,
      modo: 'completo',
    })) as { importados?: number; actualizados?: number; truncado?: boolean; incidencias?: string[] }

    const escritos = (resultado.importados ?? 0) + (resultado.actualizados ?? 0)
    return {
      escritos,
      truncado: resultado.truncado === true,
      // GHL no da un cursor estable entre pasadas: se reanuda por ventana de fechas, no por cursor.
      // Declararlo null es más honesto que devolver uno que la siguiente pasada no podría usar.
      cursor: null,
      incidencias: resultado.incidencias ?? [],
    }
  },
}
