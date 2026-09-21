// FIXTURES SINTÉTICOS TENANT A Y TENANT B (F-1).
//
// Existen desde F-1 para que cualquier prueba de aislamiento tenga dos subcuentas que comparar,
// aunque solo haya un tenant REAL hasta F4. Son deterministas a propósito: los UUID son fijos, así
// que un fallo se reproduce igual en local y en CI, y nunca coinciden con los de producción.
//
// NO contienen datos reales ni PII: nombres inventados, dominios `example.test` (reservado por RFC
// 2606, nunca resoluble) y teléfonos del rango +34 900 reservado para pruebas.
//
// Qué NO son: no siembran la base de datos. Son datos en memoria para ejercitar detectores, filtros
// y serializadores sin credenciales. Cuando F1 traiga staging, el mismo par A/B se podrá usar para
// las pruebas allow/deny contra Postgres real sin cambiar los identificadores.

export const TENANT_A = {
  id: '00000000-0000-4000-8000-0000000000aa',
  slug: 'tenant-a-sintetico',
  nombre: 'Tenant A (sintético)',
}

export const TENANT_B = {
  id: '00000000-0000-4000-8000-0000000000bb',
  slug: 'tenant-b-sintetico',
  nombre: 'Tenant B (sintético)',
}

export const TENANTS = [TENANT_A, TENANT_B]

/** Un contacto sintético de la subcuenta indicada. `n` lo hace único dentro de esa subcuenta. */
export function contactoDe(tenant, n = 1) {
  return {
    id: `${tenant.id.slice(0, 24)}c${String(n).padStart(11, '0')}`,
    tenant_id: tenant.id,
    full_name: `Persona ${n} de ${tenant.nombre}`,
    email: `persona${n}@${tenant.slug}.example.test`,
    phone: `+3490000${String(n).padStart(4, '0')}`,
    lead_status: 'nuevo',
  }
}

/** Una nota de contacto. `texto` permite inyectar contenido hostil en las pruebas de F-1. */
export function notaDe(tenant, contacto, texto = 'Nota sintética sin contenido relevante.') {
  return {
    id: `${tenant.id.slice(0, 24)}n${String(contacto.id.slice(-3)).padStart(11, '0')}`,
    tenant_id: tenant.id,
    contact_id: contacto.id,
    body: texto,
  }
}

/**
 * Un conjunto mínimo con las dos subcuentas pobladas, para pruebas allow/deny.
 *
 * La comprobación típica: filtrar por `TENANT_A.id` nunca puede devolver una fila cuyo `tenant_id`
 * sea el de B. Suena obvio, y es justo el error que una query sin acotar comete en silencio.
 */
export function dosSubcuentasPobladas() {
  const contactosA = [contactoDe(TENANT_A, 1), contactoDe(TENANT_A, 2)]
  const contactosB = [contactoDe(TENANT_B, 1)]
  return {
    tenants: TENANTS,
    contacts: [...contactosA, ...contactosB],
    contact_notes: [notaDe(TENANT_A, contactosA[0]), notaDe(TENANT_B, contactosB[0])],
  }
}
