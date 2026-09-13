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

/**
 * Slugs que NO pueden usarse: el primer segmento de la URL ES la subcuenta
 * (`/[tenant]/...` y `/api/[tenant]/...`), así que una subcuenta llamada `api` o `embed` taparía
 * rutas reales de la aplicación. Ese fallo no daría ningún error al crearla: simplemente dejaría de
 * funcionar una parte del producto para todo el mundo.
 *
 * La lista se mantiene alineada con los directorios reales de `app/` por un test.
 */
export const RESERVED_SLUGS = [
  'api',
  'embed',
  'firmar',
  'firmar-alumno',
  // Rutas públicas declaradas en el middleware que tampoco cuelgan de una subcuenta.
  'public-contracts',
  'oauth',
  'vsl',
  // Internos de Next y estáticos. Van en la forma NORMALIZADA (que es contra la que se comparan):
  // escribir '_next' o 'favicon.ico' aquí sería una entrada muerta, porque el guion bajo y el punto
  // desaparecen al normalizar y nunca podrían salir de `normalizeSlug`. Lo detectó el test que exige
  // que cada reservado sea igual a su propia normalización.
  'next',
  'favicon',
  'static',
  // Reservados para uso futuro de la plataforma, para no tener que renombrar una subcuenta después.
  'platform',
  'admin',
  'login',
  'logout',
  'recover',
  'signup',
  'www',
]

export const SLUG_MIN = 3
export const SLUG_MAX = 40
export const NAME_MAX = 80

export type TenantAccent = 'brand' | 'pink'

export type TenantInput = { slug: string; name: string; accent: TenantAccent }

/**
 * Convierte lo que escribe una persona ("Women Digital Closer") en un slug de URL
 * ("women-digital-closer"). No adivina nada más: si el resultado no es válido, se dice, en vez de
 * inventar un slug parecido que el usuario no eligió.
 */
export function normalizeSlug(input: string): string {
  return (
    input
      .normalize('NFD')
      // Quita las tildes: 'formación' → 'formacion'. Sin esto el slug llevaría caracteres que hay
      // que escapar en una URL.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  )
}

export function validateTenantInput(raw: {
  slug?: unknown
  name?: unknown
  accent?: unknown
}): { input: TenantInput } | { error: string } {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) return { error: 'Falta el nombre de la subcuenta' }
  if (name.length > NAME_MAX) return { error: `El nombre no puede pasar de ${NAME_MAX} caracteres` }

  // El slug se puede escribir a mano o derivar del nombre, pero se normaliza SIEMPRE: guardar un
  // slug con mayúsculas o espacios rompería las URLs de esa subcuenta para siempre.
  const slugSource = typeof raw.slug === 'string' && raw.slug.trim() ? raw.slug : name
  const slug = normalizeSlug(slugSource)
  if (slug.length < SLUG_MIN) return { error: `El identificador de URL necesita al menos ${SLUG_MIN} caracteres` }
  if (slug.length > SLUG_MAX) return { error: `El identificador de URL no puede pasar de ${SLUG_MAX} caracteres` }
  if (RESERVED_SLUGS.includes(slug)) {
    return { error: `"${slug}" es una ruta de la aplicación: elige otro identificador de URL` }
  }

  const accent: TenantAccent = raw.accent === 'pink' ? 'pink' : 'brand'
  return { input: { slug, name, accent } }
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
