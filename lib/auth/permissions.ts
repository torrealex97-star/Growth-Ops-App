import { LEGACY_MARKETING_ROUTES } from '@/lib/marketing-navigation'

export type AppRole =
  | 'admin'
  | 'director'
  | 'manager'
  | 'setter'
  | 'closer'
  | 'triager'
  | 'cold_caller'
  | 'affiliate'
  | 'marketing'
  | 'adscripcion'
  | 'editor'
  | 'csm'
  | 'cobros'
  | 'gestoria'

export type Department = 'ventas' | 'marketing' | 'producto' | 'finanzas' | 'sistema'

export const DEPARTMENT_LABELS: Record<Department, string> = {
  ventas: 'Ventas',
  marketing: 'Marketing',
  producto: 'Producto / Alumnos',
  finanzas: 'Finanzas',
  sistema: 'Sistema',
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrador',
  director: 'Director',
  manager: 'Manager',
  setter: 'Setter',
  closer: 'Closer',
  triager: 'Triager',
  cold_caller: 'Cold Caller',
  affiliate: 'Afiliado',
  marketing: 'Marketing',
  adscripcion: 'Adscripción',
  editor: 'Editor',
  csm: 'Customer Success',
  cobros: 'Cobros / Morosidad',
  gestoria: 'Gestoría',
}

export const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'bg-brand-500/20 text-brand-400 border-brand-500/30',
  director: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  manager: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  setter: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  closer: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  triager: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  cold_caller: 'bg-lime-500/20 text-lime-400 border-lime-500/30',
  affiliate: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  marketing: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  adscripcion: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  editor: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  csm: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  cobros: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  gestoria: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
}

// Roles con visión global (liderazgo)
const LEADERSHIP: AppRole[] = ['admin', 'director', 'manager']
export const isLeadership = (role: AppRole) => LEADERSHIP.includes(role)

// ---- Departamentos que cada rol puede ver ----
const ROLE_DEPARTMENTS: Record<AppRole, Department[]> = {
  admin: ['ventas', 'marketing', 'producto', 'finanzas', 'sistema'],
  director: ['ventas', 'marketing', 'producto', 'finanzas', 'sistema'],
  manager: ['ventas', 'marketing', 'producto', 'finanzas'],
  setter: ['ventas'],
  closer: ['ventas'],
  triager: ['ventas'],
  cold_caller: ['ventas'],
  affiliate: ['ventas'],
  marketing: ['marketing'],
  adscripcion: ['marketing'],
  editor: ['marketing'],
  csm: ['producto'],
  cobros: ['finanzas'],
  gestoria: ['finanzas'],
}

// Prefijos de ruta por departamento (para acceso configurable por usuario)
const DEPARTMENT_PREFIXES: Record<Department, string[]> = {
  ventas: ['/crm', '/ventas', '/analitica', '/comisiones', '/recursos', '/tasks'],
  // '/marketing/afiliados' se añade aquí porque Afiliados se movió a Marketing (antes vivía
  // bajo el departamento 'finanzas', ver DEPARTMENT_PREFIXES.finanzas más abajo).
  // '/funnels' cuelga de marketing porque es una vista de captación (impresiones, visitas, leads),
  // aunque sus últimas etapas sean de ventas. Sin registrarlo aquí, el filtro del menú lo
  // escondería para TODOS los roles: `inZones` exige que la ruta case con algún prefijo.
  marketing: [
    '/marketing/adquisicion',
    '/marketing/afiliados',
    '/marketing/contenido',
    '/instagram',
    '/setting-ai',
    '/funnels',
  ],
  producto: ['/students', '/csm-events', '/drops', '/contratos'],
  // '/dashboard' y '/unit-economics' viven aquí porque la sección "Dirección" se disolvió: sus
  // páginas (Cohortes, I&G) ya viven bajo /finanzas/analitica, y el resto de KPIs generales de
  // liderazgo (Dashboard, Unit Economics) se agrupan con Finanzas a efectos de permisos.
  finanzas: ['/finanzas', '/dashboard', '/unit-economics'],
  // '/kpi' (Formularios KPI) faltaba: la entrada existía en el menú de Configuración pero no casaba
  // con ningún prefijo, así que el filtro la escondía del sidebar para TODOS los roles. Se llegaba
  // solo por la tarjeta de la rejilla de Configuración, que no pasa por este filtro — por eso no se
  // notó. Lo detectó el test de tests/funnels-section.test.mjs.
  sistema: ['/actividad', '/audit', '/settings', '/contratos/equipo', '/contratos/plantillas', '/kpi'],
}

// Catálogo de páginas navegables agrupadas por departamento. Es la fuente para el selector de
// visibilidad página-a-página (on/off individual) y para filtrar el menú.
export const NAV_PAGES: { href: string; label: string; dept: Department }[] = [
  { href: '/dashboard', label: 'Dashboard', dept: 'finanzas' },
  { href: '/unit-economics', label: 'Unit Economics', dept: 'finanzas' },
  { href: '/crm/contactos', label: 'CRM · Contactos', dept: 'ventas' },
  { href: '/crm/agendas', label: 'CRM · Agendas', dept: 'ventas' },
  { href: '/crm/seguimiento', label: 'CRM · Seguimiento', dept: 'ventas' },
  { href: '/crm/fathom-revision', label: 'CRM · Llamadas sin atribuir', dept: 'ventas' },
  { href: '/ventas/registro', label: 'Ventas & Cobros · Registro', dept: 'ventas' },
  { href: '/ventas/pagos', label: 'Ventas & Cobros · Pagos', dept: 'ventas' },
  { href: '/ventas/reservas', label: 'Ventas & Cobros · Reservas', dept: 'ventas' },
  { href: '/analitica/embudo', label: 'Analítica · Embudo', dept: 'ventas' },
  { href: '/analitica/ranking', label: 'Analítica · Ranking', dept: 'ventas' },
  { href: '/analitica/actividad', label: 'Analítica · Actividad (+ KPI diario)', dept: 'ventas' },
  { href: '/comisiones', label: 'Comisiones', dept: 'ventas' },
  { href: '/tasks', label: 'Tareas', dept: 'ventas' },
  { href: '/recursos/enlaces', label: 'Recursos de venta · Enlaces', dept: 'ventas' },
  { href: '/recursos/biblioteca', label: 'Recursos de venta · Biblioteca', dept: 'ventas' },
  { href: '/recursos/testimonios', label: 'Recursos de venta · Testimonios', dept: 'ventas' },
  { href: '/recursos/grabaciones', label: 'Recursos de venta · Grabaciones', dept: 'ventas' },
  { href: '/recursos/contratos-producto', label: 'Recursos de venta · Contratos de producto', dept: 'ventas' },
  { href: '/funnels', label: 'Funnels', dept: 'marketing' },
  { href: '/marketing/adquisicion/campanas', label: 'Adquisición · Campañas', dept: 'marketing' },
  { href: '/marketing/adquisicion/atribucion', label: 'Adquisición · Atribución', dept: 'marketing' },
  { href: '/marketing/adquisicion/vsl', label: 'Adquisición · VSL', dept: 'marketing' },
  { href: '/instagram', label: 'Instagram · Rendimiento', dept: 'marketing' },
  { href: '/instagram/reels', label: 'Instagram · Reels del día', dept: 'marketing' },
  { href: '/instagram/carruseles', label: 'Instagram · Carruseles y Flyers', dept: 'marketing' },
  { href: '/instagram/competencia', label: 'Instagram · Competencia', dept: 'marketing' },
  { href: '/marketing/contenido', label: 'Contenido', dept: 'marketing' },
  { href: '/setting-ai', label: 'Setting AI', dept: 'marketing' },
  { href: '/students', label: 'Alumnos', dept: 'producto' },
  { href: '/csm-events', label: 'Eventos CSM', dept: 'producto' },
  { href: '/drops', label: 'Cancelaciones', dept: 'producto' },
  { href: '/contratos', label: 'Contratos', dept: 'producto' },
  { href: '/finanzas/analitica/resumen', label: 'Analítica financiera · Resumen', dept: 'finanzas' },
  { href: '/finanzas/analitica/proyeccion', label: 'Analítica financiera · Proyección de caja', dept: 'finanzas' },
  { href: '/finanzas/analitica/pnl', label: 'Analítica financiera · I&G (P&L)', dept: 'finanzas' },
  { href: '/finanzas/analitica/cohortes', label: 'Analítica financiera · Cohortes', dept: 'finanzas' },
  { href: '/finanzas/gastos-facturas/gastos', label: 'Gastos & Facturas · Gastos', dept: 'finanzas' },
  { href: '/finanzas/gastos-facturas/facturas', label: 'Gastos & Facturas · Facturas', dept: 'finanzas' },
  { href: '/finanzas/gastos-facturas/gestoria', label: 'Gastos & Facturas · Export gestoría', dept: 'finanzas' },
  { href: '/finanzas/cobros/cobros', label: 'Cobros & Conciliación · Cobros', dept: 'finanzas' },
  { href: '/finanzas/cobros/devoluciones', label: 'Cobros & Conciliación · Devoluciones', dept: 'finanzas' },
  { href: '/finanzas/cobros/conciliacion', label: 'Cobros & Conciliación · Conciliación', dept: 'finanzas' },
  { href: '/finanzas/morosidad', label: 'Morosidad', dept: 'finanzas' },
  { href: '/marketing/afiliados/afiliados', label: 'Afiliados · Gestión', dept: 'marketing' },
  { href: '/marketing/afiliados/campanas', label: 'Afiliados · Campañas', dept: 'marketing' },
  { href: '/contratos/equipo', label: 'Contratos de equipo (confidencial)', dept: 'sistema' },
  { href: '/contratos/plantillas', label: 'Plantillas de contratos', dept: 'sistema' },
  { href: '/actividad', label: 'Actividad', dept: 'sistema' },
  { href: '/audit', label: 'Auditoría', dept: 'sistema' },
  { href: '/settings', label: 'Configuración', dept: 'sistema' },
  { href: '/settings/data-health', label: 'Data Health', dept: 'sistema' },
]

const normalizeAllowedPrefixes = (prefixes: string[]) =>
  prefixes.map((prefix) => LEGACY_MARKETING_ROUTES[prefix] ?? prefix)

// Prefijos permitidos para un usuario. Prioridad:
//   1) page_overrides → lista EXPLÍCITA de páginas (on/off una a una)
//   2) dept_overrides → todas las páginas de esos departamentos
//   3) por rol (undefined = liderazgo, sin restricción)
export function allowedPrefixesFor(
  role: AppRole,
  deptOverrides?: string[] | null,
  pageOverrides?: string[] | null
): string[] | undefined {
  if (pageOverrides && pageOverrides.length > 0) return normalizeAllowedPrefixes(pageOverrides)
  if (deptOverrides && deptOverrides.length > 0) {
    const set = new Set<string>()
    for (const d of deptOverrides) (DEPARTMENT_PREFIXES[d as Department] || []).forEach((p) => set.add(p))
    return normalizeAllowedPrefixes(Array.from(set))
  }
  const rolePrefixes = ROLE_ALLOWED_PREFIXES[role]
  return rolePrefixes ? normalizeAllowedPrefixes(rolePrefixes) : undefined
}

const hasDepartment = (role: AppRole, dept: Department) => ROLE_DEPARTMENTS[role]?.includes(dept) ?? false

// ---- Rutas permitidas por rol (para acotar el acceso en el layout) ----
// Los roles de liderazgo (admin/director/manager) no tienen restricción (undefined).
// NOTA sobre la reorganización de Ventas/Marketing (sept 2026): varias páginas antes sueltas se
// fusionaron en pantallas con pestañas bajo un prefijo común (/crm, /ventas, /analitica, /recursos,
// /marketing, /instagram). Cuando un rol tenía acceso a TODAS las páginas de un grupo, se le da el
// prefijo completo del grupo. Cuando solo tenía acceso a ALGUNAS (p.ej. cobros solo veía Pipeline de
// pagos, no Registro/Reservas), se usa el sub-prefijo exacto de esa pestaña para no ampliar el acceso
// más allá de lo que ya tenía. `/analitica/actividad` alberga ahora también el modal de KPI Diario,
// así que cualquier rol que antes pudiera enviar su KPI (setter/closer/triager/cold_caller) necesita
// ese sub-prefijo aunque antes no viera la propia página de Prospección.
const ROLE_ALLOWED_PREFIXES: Partial<Record<AppRole, string[]>> = {
  setter: [
    '/dashboard',
    '/crm',
    '/ventas',
    '/analitica',
    '/comisiones',
    '/tasks',
    '/recursos/enlaces',
    '/recursos/biblioteca',
    '/recursos/testimonios',
    '/setting-ai',
  ],
  closer: ['/dashboard', '/crm', '/ventas', '/analitica', '/comisiones', '/tasks', '/recursos'],
  triager: ['/crm', '/analitica', '/tasks', '/recursos/testimonios'],
  cold_caller: ['/crm', '/analitica', '/tasks', '/recursos/enlaces', '/recursos/biblioteca', '/recursos/testimonios'],
  affiliate: ['/marketing/afiliados', '/comisiones', '/recursos/enlaces'],
  // gestoria antes veía el prefijo completo '/finanzas' (dashboard) + '/facturas' + '/gestoria' +
  // '/pnl' sueltos — ninguno de esos daba acceso a Gastos/Cobros/Devoluciones/Morosidad, así que al
  // anidar todo bajo /finanzas se usan sub-prefijos precisos para no ampliar su acceso.
  gestoria: [
    '/finanzas/analitica/resumen',
    '/finanzas/gastos-facturas/facturas',
    '/finanzas/gastos-facturas/gestoria',
    '/finanzas/analitica/pnl',
  ],
  // Data Health usa una ruta propia para no abrir el resto de /settings.
  // Adscripción y Editor conservan solo las pestañas a las que ya tenían acceso antes del cambio.
  marketing: [
    '/marketing/adquisicion',
    '/marketing/contenido',
    '/instagram',
    '/settings/data-health',
    '/setting-ai',
    '/recursos/testimonios',
  ],
  adscripcion: ['/marketing/adquisicion/campanas', '/marketing/adquisicion/atribucion', '/settings/data-health'],
  editor: ['/instagram', '/marketing/contenido', '/marketing/adquisicion/vsl', '/recursos/testimonios'],
  csm: ['/students', '/csm-events', '/drops', '/recursos/testimonios'],
  // cobros ganó acceso a la pestaña Conciliación (antes inexistente): cotejar SUS PROPIOS cobros
  // contra Stripe/seQura/transferencias es una extensión directa de gestionar Cobros, no un área
  // administrativa nueva — no gana Devoluciones, que siempre fue solo-liderazgo.
  cobros: ['/finanzas/morosidad', '/finanzas/cobros/cobros', '/finanzas/cobros/conciliacion', '/ventas/pagos'],
}

export const PERMISSIONS = {
  // --- Ventas ---
  canViewAllSales: (role: AppRole) => isLeadership(role),
  canCreateSale: (role: AppRole) => ['admin', 'director', 'closer', 'setter'].includes(role),
  canEditSale: (role: AppRole) => ['admin', 'director'].includes(role),
  canViewContacts: (role: AppRole) => hasDepartment(role, 'ventas') || isLeadership(role),
  canViewAppointments: (role: AppRole) => hasDepartment(role, 'ventas') || isLeadership(role),
  canViewPipeline: (role: AppRole) => hasDepartment(role, 'ventas') || isLeadership(role),
  canViewPaymentPipeline: (role: AppRole) =>
    ['admin', 'director', 'manager', 'closer', 'setter', 'cobros'].includes(role),

  // --- Finanzas ---
  canRegisterCollection: (role: AppRole) => ['admin', 'director'].includes(role),
  canRegisterRefund: (role: AppRole) => ['admin', 'director'].includes(role),
  canViewCollections: (role: AppRole) => isLeadership(role),
  canViewRefunds: (role: AppRole) => isLeadership(role),
  canViewExpenses: (role: AppRole) => isLeadership(role),
  canManageExpenses: (role: AppRole) => ['admin', 'director'].includes(role),
  canViewMorosidad: (role: AppRole) => ['admin', 'director', 'manager', 'cobros'].includes(role),
  canManagePayments: (role: AppRole) => ['admin', 'director', 'cobros'].includes(role),
  canViewPnl: (role: AppRole) => isLeadership(role),

  // --- Marketing ---
  canViewCampaigns: (role: AppRole) => hasDepartment(role, 'marketing') || isLeadership(role),
  canManageCampaigns: (role: AppRole) => ['admin', 'director', 'marketing'].includes(role),
  canViewAttribution: (role: AppRole) => ['admin', 'director', 'manager', 'adscripcion', 'marketing'].includes(role),

  // --- Producto / Alumnos ---
  canViewStudents: (role: AppRole) => hasDepartment(role, 'producto') || isLeadership(role),
  canManageStudents: (role: AppRole) => ['admin', 'director', 'csm'].includes(role),
  canViewCsm: (role: AppRole) => ['admin', 'director', 'manager', 'csm'].includes(role),
  canManageCsm: (role: AppRole) => ['admin', 'director', 'csm'].includes(role),
  canViewDrops: (role: AppRole) => ['admin', 'director', 'manager', 'csm'].includes(role),

  // --- Resumen general (Dashboard / Unit Economics / Cohortes, antes agrupadas en "Dirección") ---
  canViewGlobalDashboard: (role: AppRole) => isLeadership(role),
  canViewUnitEconomics: (role: AppRole) => isLeadership(role),
  canViewCohorts: (role: AppRole) => isLeadership(role),

  // --- Comisiones / Objetivos / KPI ---
  canApproveCommissions: (role: AppRole) => ['admin', 'director'].includes(role),
  canManageKPITemplates: (role: AppRole) => ['admin', 'director'].includes(role),
  canViewKPITemplates: (role: AppRole) => ['admin', 'director'].includes(role),
  canSubmitKPI: (role: AppRole) => ['setter', 'closer', 'triager', 'cold_caller', 'csm'].includes(role),
  canViewTargets: (_role: AppRole) => true,
  canManageTargets: (role: AppRole) => ['admin', 'director'].includes(role),

  // --- Enlaces ---
  canViewLinks: (role: AppRole) =>
    ['admin', 'director', 'manager', 'setter', 'closer', 'cold_caller', 'affiliate'].includes(role),
  canManageLinkTemplates: (role: AppRole) => ['admin', 'director'].includes(role),

  // --- Programa de afiliados ---
  canManageAffiliateProgram: (role: AppRole) => ['admin', 'director'].includes(role),
  canManageAffiliateCampaigns: (role: AppRole) => ['admin', 'director'].includes(role),

  // --- Sistema ---
  canManageUsers: (role: AppRole) => role === 'admin',
  canManageProducts: (role: AppRole) => role === 'admin',
  canViewAuditLog: (role: AppRole) => ['admin', 'director'].includes(role),
  canDeleteAuditLog: (_role: AppRole) => false,
  canViewSettings: (role: AppRole) => role === 'admin',
  canExportData: (role: AppRole) => ['admin', 'director'].includes(role),
}
