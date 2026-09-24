// INVARIANTE DE AISLAMIENTO POR SUBCUENTA — detector puro.
//
// POR QUÉ UN MÓDULO APARTE. El invariante ya se comprobaba contra el esquema vivo
// (`tests/esquema-tenant-invariante.test.mjs`, vía OpenAPI de PostgREST), pero ese test se auto-salta
// sin credenciales y, sobre todo, NADIE HABÍA DEMOSTRADO QUE FALLE CUANDO DEBE. Un detector que solo
// se ejecuta contra un esquema que ya cumple no prueba nada: si mañana dejara de detectar, seguiría
// en verde. F-1 exige un test negativo, y para escribirlo hace falta poder alimentar al detector con
// un esquema roto a propósito. De ahí que la lógica viva aquí, sin dependencias, y que los tests la
// ejerzan con esquemas sintéticos además de con el real.
//
// Qué comprueba, para una tabla que pertenece a una subcuenta:
//   1. Tiene columna `tenant_id`.
//   2. Es NOT NULL — una columna nullable deja nacer filas huérfanas, que ninguna política alcanza.
//   3. Tiene RLS habilitada.
//   4. Tiene al menos una política. RLS sin políticas no es "abierto": es "cerrado para todos menos
//      el owner y service_role", que para una tabla de negocio es un fallo distinto pero igual de
//      real, porque obliga a saltarse RLS para usarla.

/** Estado observado de una tabla, venga del esquema vivo o de las migraciones. */
export type EstadoTabla = {
  tabla: string
  tieneTenantId: boolean
  tenantIdNotNull: boolean
  rlsHabilitada: boolean
  politicas: number
}

/**
 * Tablas globales de plataforma, sin `tenant_id`, cada una con su motivo.
 *
 * Es una lista CERRADA y con nombre propio: añadir una tabla aquí es una decisión que se ve en el
 * diff, no un efecto secundario. Espejo de la de `tests/esquema-tenant-invariante.test.mjs`.
 */
export const EXCEPCIONES_SIN_TENANT: Readonly<Record<string, string>> = {
  tenants: 'la propia tabla raíz de subcuentas: es lo que las demás referencian',
  users: 'identidad compartida entre subcuentas; la pertenencia vive en tenant_members',
  roles: 'catálogo de plataforma, intencionadamente global',
  resource_links: 'biblioteca de recursos global, no por subcuenta',
  resource_link_divisions: 'biblioteca de recursos global, no por subcuenta',
  event_types:
    'vocabulario de canonical_events.event_name: "una cita de GHL" significa lo mismo para todos los ' +
    'clientes. Sin tenant_id a propósito, y solo el rol de servicio escribe (F1)',
}

// NOTA PARA F0: `organizations` será la segunda tabla raíz sin tenant_id
// (`docs/plan/01-arquitectura-datos.md` §2). Cuando se cree, hay que añadirla arriba con su motivo;
// hasta entonces no se declara, porque una excepción para algo que no existe no protege nada y
// oculta que el invariante dejaría de cubrirla.
//
// `tenant_members` NO es excepción a propósito: tiene `tenant_id NOT NULL` y se comprueba como
// cualquier otra.

export type Violacion = { tabla: string; motivo: string }

/**
 * Devuelve las violaciones del invariante. Lista vacía = el esquema cumple.
 *
 * Las excepciones se saltan enteras: una tabla global no necesita ni tenant_id ni RLS por subcuenta.
 */
export function detectarViolacionesTenant(
  tablas: readonly EstadoTabla[],
  excepciones: Readonly<Record<string, string>> = EXCEPCIONES_SIN_TENANT
): Violacion[] {
  const violaciones: Violacion[] = []
  for (const t of tablas) {
    if (Object.hasOwn(excepciones, t.tabla)) continue
    if (!t.tieneTenantId) {
      violaciones.push({ tabla: t.tabla, motivo: 'sin columna tenant_id y sin excepción declarada' })
      continue
    }
    if (!t.tenantIdNotNull) {
      violaciones.push({ tabla: t.tabla, motivo: 'tenant_id admite NULL: una fila podría nacer huérfana' })
    }
    if (!t.rlsHabilitada) {
      violaciones.push({ tabla: t.tabla, motivo: 'sin RLS habilitada' })
    } else if (t.politicas === 0) {
      violaciones.push({ tabla: t.tabla, motivo: 'RLS habilitada pero sin ninguna política' })
    }
  }
  return violaciones
}

/** Formatea las violaciones para el mensaje de un assert, una por línea. */
export function formatearViolaciones(violaciones: readonly Violacion[]): string {
  return violaciones.map((v) => `  ${v.tabla}: ${v.motivo}`).join('\n')
}
