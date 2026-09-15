// Qué es una subcuenta nueva, y qué NO se puede crear por ella.
//
// Esta parte es pura a propósito: valida el slug y describe el estado de aprovisionamiento sin tocar
// la base de datos, así que se puede probar entera sin red. El aprovisionador (lib/tenants/provision)
// solo obedece lo que aquí se decide.
//
// LA REGLA QUE GOBIERNA LA FASE: una subcuenta nueva nace **configurada y vacía**, no "con datos de
// ejemplo". Crear un producto o un plan de pago de relleno metería filas inventadas en las tablas de
// las que salen la facturación y las comisiones. Así que lo que no se puede saber no se crea: se
// devuelve como lista de lo que falta, con quién tiene que hacerlo.

export const NAME_MAX = 80

export type TenantAccent = 'brand' | 'pink'

export type TenantInput = { name: string; accent: TenantAccent }

/**
 * Genera la identidad estable de una subcuenta nueva. El slug coincide con el UUID interno para que
 * el nombre comercial pueda cambiar sin cambiar la URL ni obligar a mantener redirecciones.
 */
export function createTenantIdentity(): { id: string; slug: string } {
  const id = crypto.randomUUID()
  return { id, slug: id }
}

export function validateTenantInput(raw: {
  name?: unknown
  accent?: unknown
}): { input: TenantInput } | { error: string } {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return { error: 'Falta el nombre de la subcuenta' }
  if (name.length > NAME_MAX) return { error: `El nombre no puede pasar de ${NAME_MAX} caracteres` }

  const accent: TenantAccent = raw.accent === 'pink' ? 'pink' : 'brand'
  return { input: { name, accent } }
}

/**
 * Roles que se pueden dar desde la pantalla de subcuentas.
 *
 * `super_admin` NO está, y no es un olvido: `public.is_super_admin()` comprueba si existe **alguna**
 * fila de `tenant_members` con `role = 'super_admin'` para ese usuario, SIN filtrar por subcuenta. Es
 * decir, dar ese rol en una sola subcuenta convierte a esa persona en super admin de TODA la
 * plataforma, con acceso a las demás subcuentas. Ofrecerlo en un desplegable al lado de "admin" y
 * "miembro" sería una escalada de privilegios disfrazada de permiso local.
 */
export const ASSIGNABLE_MEMBER_ROLES = ['admin', 'member'] as const
export type AssignableMemberRole = (typeof ASSIGNABLE_MEMBER_ROLES)[number]

export function validateMemberRole(raw: unknown): { role: AssignableMemberRole } | { error: string } {
  if (raw === 'super_admin') {
    return {
      error:
        'El rol super_admin no se puede dar desde aquí: es de plataforma, no de subcuenta, y daría acceso a todas las demás subcuentas.',
    }
  }
  if (typeof raw !== 'string' || !ASSIGNABLE_MEMBER_ROLES.includes(raw as AssignableMemberRole)) {
    return { error: `El rol tiene que ser uno de: ${ASSIGNABLE_MEMBER_ROLES.join(', ')}` }
  }
  return { role: raw as AssignableMemberRole }
}

/** Ajustes iniciales de la subcuenta. Solo branding: es lo único que se puede saber al crearla. */
export function initialSettings(input: TenantInput): { branding: { name: string; accent: TenantAccent } } {
  return { branding: { name: input.name, accent: input.accent } }
}

// ── Qué falta para que la subcuenta sirva ───────────────────────────────────
// Cada paso dice si lo hace el aprovisionador o una persona, y POR QUÉ cuando es una persona. Un
// "pendiente" sin motivo se lee como una tarea olvidada; con motivo se lee como una decisión.

export type ProvisionStep = {
  id: string
  label: string
  /** true = lo hace el aprovisionador al crear la subcuenta. */
  automatic: boolean
  /** Solo en los manuales: por qué no se puede automatizar. */
  reason?: string
}

export const PROVISION_STEPS: ProvisionStep[] = [
  { id: 'tenant', label: 'Crear la subcuenta con su identificador de URL y su marca', automatic: true },
  { id: 'membership', label: 'Darte acceso a la subcuenta como super admin', automatic: true },
  { id: 'audit', label: 'Dejar registrada la creación en Auditoría', automatic: true },
  {
    id: 'usuarios',
    label: 'Dar acceso al equipo de la subcuenta',
    automatic: false,
    reason:
      'Hacen falta los emails y el rol de cada persona, que solo los sabes tú. Se hace desde esta misma pantalla, y el usuario tiene que existir ya en la plataforma: aquí no se crean cuentas.',
  },
  {
    id: 'productos',
    label: 'Crear al menos un producto y un plan de pago',
    automatic: false,
    reason:
      'Una venta no se puede registrar sin producto ni plan (son NOT NULL en base). Crear unos de ejemplo metería filas inventadas en las tablas de las que salen la facturación y las comisiones.',
  },
  {
    id: 'integraciones',
    label: 'Conectar las integraciones de la subcuenta',
    automatic: false,
    reason: 'Son credenciales de sus cuentas (Meta, Stripe, Calendly…): nadie más las tiene.',
  },
  {
    id: 'tracking',
    label: 'Instalar el script de tracking en sus landings',
    automatic: false,
    reason: 'Se instala en su web, fuera de esta aplicación.',
  },
]

export const MANUAL_STEPS = PROVISION_STEPS.filter((s) => !s.automatic)
