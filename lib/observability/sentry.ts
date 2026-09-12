import * as Sentry from '@sentry/nextjs'

/**
 * Etiqueta el scope activo de Sentry con el contexto mínimo útil para depurar un error de API
 * sin loguear PII: tenant_id, route y un request_id generado por request. Llamar al inicio de
 * cada route handler, justo después de resolver requireTenant() (o antes si el error es previo).
 */
export function tagRequestScope(params: { tenantId?: string | null; route: string; requestId?: string }) {
  const requestId = params.requestId ?? crypto.randomUUID()
  Sentry.getCurrentScope().setTags({
    tenant_id: params.tenantId ?? 'unknown',
    route: params.route,
    request_id: requestId,
  })
  return requestId
}

export { Sentry }
