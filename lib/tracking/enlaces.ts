// ENLACES DE REFERIDO DE COLABORADOR — convención única de parámetros, la misma que
// ya aplicaba buildTrackedUrl en /recursos/enlaces para el rol affiliate:
//
//   ?utm_content=<código>  → marketing/reporting (interoperabilidad con UTMs)
//   ?ref=<código>          → el identificador estructurado que los webhooks resuelven
//                            server-side al UUID del perfil y guardan como FK
//                            (contact_attributions.collaborator_id). El dinero va por FK.
//
// El destino (base_url de una campaña) es un activo del TENANT: la personalización
// la pone el `ref`, así que el enlace atribuye al colaborador aunque la campaña
// sea compartida. El código es identificador de presentación, nunca identidad (§43).
export function enlaceDeColaborador(baseUrl: string, code: string): string {
  try {
    const url = new URL(baseUrl)
    url.searchParams.set('utm_content', code)
    url.searchParams.set('ref', code)
    return url.toString()
  } catch {
    // base_url puede no ser una URL absoluta válida; append manual (mismo fallback que enlaces).
    const sep = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${sep}utm_content=${encodeURIComponent(code)}&ref=${encodeURIComponent(code)}`
  }
}
