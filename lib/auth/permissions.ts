export type AppRole =
  | 'admin' | 'director' | 'manager'
  | 'setter' | 'closer' | 'triager' | 'cold_caller' | 'affiliate'
  | 'marketing' | 'adscripcion' | 'editor'
  | 'csm' | 'cobros' | 'gestoria'

export type Department = 'direccion' | 'ventas' | 'marketing' | 'producto' | 'finanzas' | 'sistema'

export const DEPARTMENT_LABELS: Record<Department, string> = {
  direccion: 'Dirección',
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
export const LEADERSHIP: AppRole[] = ['admin', 'director', 'manager']
export const isLeadership = (role: AppRole) => LEADERSHIP.includes(role)

// ---- Departamentos que cada rol puede ver ----
export const ROLE_DEPARTMENTS: Record<AppRole, Department[]> = {
  admin:       ['direccion', 'ventas', 'marketing', 'producto', 'finanzas', 'sistema'],
  director:    ['direccion', 'ventas', 'marketing', 'producto', 'finanzas', 'sistema'],
  manager:     ['direccion', 'ventas', 'marketing', 'producto', 'finanzas'],
  setter:      ['ventas'],
  closer:      ['ventas'],
  triager:     ['ventas'],
  cold_caller: ['ventas'],
  affiliate:   ['ventas'],
  marketing:   ['marketing'],
  adscripcion: ['marketing'],
  editor:      ['marketing'],
  csm:         ['producto'],
  cobros:      ['finanzas'],
  gestoria:    ['finanzas'],
}

// Prefijos de ruta por departamento (para acceso configurable por usuario)
export const DEPARTMENT_PREFIXES: Record<Department, string[]> = {
  direccion: ['/dashboard', '/unit-economics', '/cohorts', '/pnl'],
  ventas: ['/leads', '/contacts', '/appointments', '/seguimiento', '/sales', '/reservas', '/pagos', '/pipeline', '/ventas-metricas', '/prospecting', '/commissions', '/targets', '/kpi', '/tasks', '/enlaces', '/biblioteca', '/setting-ai', '/contratos/producto'],
  marketing: ['/campaigns', '/attribution', '/data-health', '/content', '/content/reels', '/instagram', '/vsl', '/carruseles'],
  producto: ['/students', '/csm-events', '/drops', '/contratos'],
  finanzas: ['/finanzas', '/proyeccion', '/expenses', '/facturas', '/morosidad', '/morosos-sequra', '/collections', '/refunds', '/afiliados', '/pnl', '/gestoria'],
  sistema: ['/actividad', '/audit', '/settings', '/contratos/equipo', '/contratos/plantillas'],
}

// Catálogo de páginas navegables agrupadas por departamento. Es la fuente para el selector de
// visibilidad página-a-página (on/off individual) y para filtrar el menú.
export const NAV_PAGES: { href: string; label: string; dept: Department }[] = [
  { href: '/dashboard', label: 'Dashboard', dept: 'direccion' },
  { href: '/unit-economics', label: 'Unit Economics', dept: 'direccion' },
  { href: '/cohorts', label: 'Cohortes', dept: 'direccion' },
  { href: '/pnl', label: 'I&G (P&L)', dept: 'direccion' },
  { href: '/leads', label: 'Leads', dept: 'ventas' },
  { href: '/contacts', label: 'Contactos', dept: 'ventas' },
  { href: '/appointments', label: 'Agendas', dept: 'ventas' },
  { href: '/seguimiento', label: 'Pipeline de seguimiento', dept: 'ventas' },
  { href: '/sales', label: 'Ventas', dept: 'ventas' },
  { href: '/reservas', label: 'Reservas', dept: 'ventas' },
  { href: '/pagos', label: 'Pipeline de pagos', dept: 'ventas' },
  { href: '/pipeline', label: 'Ranking', dept: 'ventas' },
  { href: '/ventas-metricas', label: 'Métricas ventas', dept: 'ventas' },
  { href: '/prospecting', label: 'Prospección', dept: 'ventas' },
  { href: '/commissions', label: 'Comisiones', dept: 'ventas' },
  { href: '/targets', label: 'Objetivos', dept: 'ventas' },
  { href: '/tasks', label: 'Tareas', dept: 'ventas' },
  { href: '/kpi', label: 'KPI', dept: 'ventas' },
  { href: '/enlaces', label: 'Enlaces', dept: 'ventas' },
  { href: '/biblioteca', label: 'Biblioteca de llamadas', dept: 'ventas' },
  { href: '/setting-ai', label: 'Setting AI', dept: 'ventas' },
  { href: '/contratos/producto', label: 'Contratos de producto', dept: 'ventas' },
  { href: '/campaigns', label: 'Campañas', dept: 'marketing' },
  { href: '/attribution', label: 'Atribución', dept: 'marketing' },
  { href: '/data-health', label: 'Data Health', dept: 'marketing' },
  { href: '/content', label: 'Contenido', dept: 'marketing' },
  { href: '/content/reels', label: 'Reels del día', dept: 'marketing' },
  { href: '/carruseles', label: 'Carruseles y Flyers', dept: 'marketing' },
  { href: '/instagram', label: 'Instagram', dept: 'marketing' },
  { href: '/instagram/competencia', label: 'Competencia', dept: 'marketing' },
  { href: '/vsl', label: 'VSL / Vídeos', dept: 'marketing' },
  { href: '/students', label: 'Alumnos', dept: 'producto' },
  { href: '/csm-events', label: 'Eventos CSM', dept: 'producto' },
  { href: '/drops', label: 'Cancelaciones', dept: 'producto' },
  { href: '/contratos', label: 'Contratos', dept: 'producto' },
  { href: '/finanzas', label: 'Resumen financiero', dept: 'finanzas' },
  { href: '/proyeccion', label: 'Proyección de caja', dept: 'finanzas' },
  { href: '/expenses', label: 'Gastos', dept: 'finanzas' },
  { href: '/facturas', label: 'Facturas', dept: 'finanzas' },
  { href: '/gestoria', label: 'Gestoría', dept: 'finanzas' },
  { href: '/afiliados', label: 'Afiliados', dept: 'finanzas' },
  { href: '/morosidad', label: 'Morosidad', dept: 'finanzas' },
  { href: '/morosos-sequra', label: 'Morosos sequra', dept: 'finanzas' },
  { href: '/collections', label: 'Cobros', dept: 'finanzas' },
  { href: '/refunds', label: 'Devoluciones', dept: 'finanzas' },
  { href: '/contratos/equipo', label: 'Contratos de equipo (confidencial)', dept: 'sistema' },
  { href: '/contratos/plantillas', label: 'Plantillas de contratos', dept: 'sistema' },
  { href: '/actividad', label: 'Actividad', dept: 'sistema' },
  { href: '/audit', label: 'Auditoría', dept: 'sistema' },
  { href: '/settings', label: 'Configuración', dept: 'sistema' },
]

// Prefijos permitidos para un usuario. Prioridad:
//   1) page_overrides → lista EXPLÍCITA de páginas (on/off una a una)
//   2) dept_overrides → todas las páginas de esos departamentos
//   3) por rol (undefined = liderazgo, sin restricción)
export function allowedPrefixesFor(
  role: AppRole,
  deptOverrides?: string[] | null,
  pageOverrides?: string[] | null
): string[] | undefined {
  if (pageOverrides && pageOverrides.length > 0) return pageOverrides
  if (deptOverrides && deptOverrides.length > 0) {
    const set = new Set<string>()
    for (const d of deptOverrides) (DEPARTMENT_PREFIXES[d as Department] || []).forEach((p) => set.add(p))
    return Array.from(set)
  }
  return ROLE_ALLOWED_PREFIXES[role]
}

export const hasDepartment = (role: AppRole, dept: Department) =>
  ROLE_DEPARTMENTS[role]?.includes(dept) ?? false

// ---- Rutas permitidas por rol (para acotar el acceso en el layout) ----
// Los roles de liderazgo (admin/director/manager) no tienen restricción (undefined).
export const ROLE_ALLOWED_PREFIXES: Partial<Record<AppRole, string[]>> = {
  setter:      ['/dashboard', '/leads', '/contacts', '/appointments', '/seguimiento', '/sales', '/reservas', '/pagos', '/pipeline', '/ventas-metricas', '/prospecting', '/commissions', '/targets', '/kpi', '/tasks', '/enlaces', '/biblioteca', '/setting-ai'],
  closer:      ['/dashboard', '/leads', '/contacts', '/appointments', '/seguimiento', '/sales', '/reservas', '/pagos', '/pipeline', '/ventas-metricas', '/commissions', '/targets', '/kpi', '/tasks', '/enlaces', '/biblioteca', '/contratos/producto'],
  triager:     ['/leads', '/contacts', '/appointments', '/pipeline', '/ventas-metricas', '/prospecting', '/kpi', '/tasks'],
  cold_caller: ['/leads', '/contacts', '/appointments', '/seguimiento', '/pipeline', '/ventas-metricas', '/prospecting', '/kpi', '/tasks', '/enlaces', '/biblioteca'],
  affiliate:   ['/afiliados', '/commissions', '/enlaces'],
  gestoria:    ['/gestoria', '/facturas', '/pnl', '/finanzas'],
  marketing:   ['/campaigns', '/attribution', '/data-health', '/content', '/content/reels', '/instagram', '/vsl', '/carruseles'],
  adscripcion: ['/attribution', '/campaigns', '/data-health'],
  editor:      ['/content', '/content/reels', '/instagram', '/vsl', '/carruseles'],
  csm:         ['/students', '/csm-events', '/drops'],
  cobros:      ['/morosidad', '/morosos-sequra', '/collections', '/pagos'],
}

export const PERMISSIONS = {
  // --- Ventas ---
  canViewAllSales: (role: AppRole) => isLeadership(role),
  canCreateSale: (role: AppRole) => ['admin', 'director', 'closer', 'setter'].includes(role),
  canEditSale: (role: AppRole) => ['admin', 'director'].includes(role),
  canViewContacts: (role: AppRole) => hasDepartment(role, 'ventas') || isLeadership(role),
  canViewAppointments: (role: AppRole) => hasDepartment(role, 'ventas') || isLeadership(role),
  canViewPipeline: (role: AppRole) => hasDepartment(role, 'ventas') || isLeadership(role),
  canViewPaymentPipeline: (role: AppRole) => ['admin', 'director', 'manager', 'closer', 'setter', 'cobros'].includes(role),

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

  // --- Dirección / Analítica ---
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
  canViewLinks: (role: AppRole) => ['admin', 'director', 'manager', 'setter', 'closer', 'cold_caller', 'affiliate'].includes(role),
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
