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
  direccion: ['/evergreen/dashboard', '/evergreen/unit-economics', '/evergreen/cohorts', '/evergreen/pnl'],
  ventas: ['/evergreen/leads', '/evergreen/contacts', '/evergreen/appointments', '/evergreen/seguimiento', '/evergreen/sales', '/evergreen/reservas', '/evergreen/pagos', '/evergreen/pipeline', '/evergreen/ventas-metricas', '/evergreen/prospecting', '/evergreen/commissions', '/evergreen/targets', '/evergreen/kpi', '/evergreen/tasks', '/evergreen/enlaces', '/evergreen/biblioteca', '/evergreen/setting-ai', '/evergreen/contratos/producto'],
  marketing: ['/evergreen/campaigns', '/evergreen/attribution', '/evergreen/data-health', '/evergreen/content', '/evergreen/content/reels', '/evergreen/instagram', '/evergreen/vsl', '/evergreen/carruseles'],
  producto: ['/evergreen/students', '/evergreen/csm-events', '/evergreen/retention', '/evergreen/drops', '/evergreen/contratos'],
  finanzas: ['/evergreen/finanzas', '/evergreen/proyeccion', '/evergreen/expenses', '/evergreen/facturas', '/evergreen/morosidad', '/evergreen/morosos-sequra', '/evergreen/collections', '/evergreen/refunds', '/evergreen/afiliados', '/evergreen/pnl', '/evergreen/gestoria'],
  sistema: ['/evergreen/actividad', '/evergreen/audit', '/evergreen/settings', '/evergreen/contratos/equipo', '/evergreen/contratos/plantillas'],
}

// Catálogo de páginas navegables agrupadas por departamento. Es la fuente para el selector de
// visibilidad página-a-página (on/off individual) y para filtrar el menú.
export const NAV_PAGES: { href: string; label: string; dept: Department }[] = [
  { href: '/evergreen/dashboard', label: 'Dashboard', dept: 'direccion' },
  { href: '/evergreen/unit-economics', label: 'Unit Economics', dept: 'direccion' },
  { href: '/evergreen/cohorts', label: 'Cohortes', dept: 'direccion' },
  { href: '/evergreen/pnl', label: 'I&G (P&L)', dept: 'direccion' },
  { href: '/evergreen/leads', label: 'Leads', dept: 'ventas' },
  { href: '/evergreen/contacts', label: 'Contactos', dept: 'ventas' },
  { href: '/evergreen/appointments', label: 'Agendas', dept: 'ventas' },
  { href: '/evergreen/seguimiento', label: 'Pipeline de seguimiento', dept: 'ventas' },
  { href: '/evergreen/sales', label: 'Ventas', dept: 'ventas' },
  { href: '/evergreen/reservas', label: 'Reservas', dept: 'ventas' },
  { href: '/evergreen/pagos', label: 'Pipeline de pagos', dept: 'ventas' },
  { href: '/evergreen/pipeline', label: 'Ranking', dept: 'ventas' },
  { href: '/evergreen/ventas-metricas', label: 'Métricas ventas', dept: 'ventas' },
  { href: '/evergreen/prospecting', label: 'Prospección', dept: 'ventas' },
  { href: '/evergreen/commissions', label: 'Comisiones', dept: 'ventas' },
  { href: '/evergreen/targets', label: 'Objetivos', dept: 'ventas' },
  { href: '/evergreen/tasks', label: 'Tareas', dept: 'ventas' },
  { href: '/evergreen/kpi', label: 'KPI', dept: 'ventas' },
  { href: '/evergreen/enlaces', label: 'Enlaces', dept: 'ventas' },
  { href: '/evergreen/biblioteca', label: 'Biblioteca de llamadas', dept: 'ventas' },
  { href: '/evergreen/setting-ai', label: 'Setting AI', dept: 'ventas' },
  { href: '/evergreen/contratos/producto', label: 'Contratos de producto', dept: 'ventas' },
  { href: '/evergreen/campaigns', label: 'Campañas', dept: 'marketing' },
  { href: '/evergreen/attribution', label: 'Atribución', dept: 'marketing' },
  { href: '/evergreen/data-health', label: 'Data Health', dept: 'marketing' },
  { href: '/evergreen/content', label: 'Contenido', dept: 'marketing' },
  { href: '/evergreen/content/reels', label: 'Reels del día', dept: 'marketing' },
  { href: '/evergreen/carruseles', label: 'Carruseles y Flyers', dept: 'marketing' },
  { href: '/evergreen/instagram', label: 'Instagram', dept: 'marketing' },
  { href: '/evergreen/instagram/competencia', label: 'Competencia', dept: 'marketing' },
  { href: '/evergreen/vsl', label: 'VSL / Vídeos', dept: 'marketing' },
  { href: '/evergreen/students', label: 'Alumnos', dept: 'producto' },
  { href: '/evergreen/csm-events', label: 'Eventos CSM', dept: 'producto' },
  { href: '/evergreen/retention', label: 'Retención', dept: 'producto' },
  { href: '/evergreen/drops', label: 'Cancelaciones', dept: 'producto' },
  { href: '/evergreen/contratos', label: 'Contratos', dept: 'producto' },
  { href: '/evergreen/finanzas', label: 'Resumen financiero', dept: 'finanzas' },
  { href: '/evergreen/proyeccion', label: 'Proyección de caja', dept: 'finanzas' },
  { href: '/evergreen/expenses', label: 'Gastos', dept: 'finanzas' },
  { href: '/evergreen/facturas', label: 'Facturas', dept: 'finanzas' },
  { href: '/evergreen/gestoria', label: 'Gestoría', dept: 'finanzas' },
  { href: '/evergreen/afiliados', label: 'Afiliados', dept: 'finanzas' },
  { href: '/evergreen/morosidad', label: 'Morosidad', dept: 'finanzas' },
  { href: '/evergreen/morosos-sequra', label: 'Morosos sequra', dept: 'finanzas' },
  { href: '/evergreen/collections', label: 'Cobros', dept: 'finanzas' },
  { href: '/evergreen/refunds', label: 'Devoluciones', dept: 'finanzas' },
  { href: '/evergreen/contratos/equipo', label: 'Contratos de equipo (confidencial)', dept: 'sistema' },
  { href: '/evergreen/contratos/plantillas', label: 'Plantillas de contratos', dept: 'sistema' },
  { href: '/evergreen/actividad', label: 'Actividad', dept: 'sistema' },
  { href: '/evergreen/audit', label: 'Auditoría', dept: 'sistema' },
  { href: '/evergreen/settings', label: 'Configuración', dept: 'sistema' },
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
  setter:      ['/evergreen/dashboard', '/evergreen/leads', '/evergreen/contacts', '/evergreen/appointments', '/evergreen/seguimiento', '/evergreen/sales', '/evergreen/reservas', '/evergreen/pagos', '/evergreen/pipeline', '/evergreen/ventas-metricas', '/evergreen/prospecting', '/evergreen/commissions', '/evergreen/targets', '/evergreen/kpi', '/evergreen/tasks', '/evergreen/enlaces', '/evergreen/biblioteca', '/evergreen/setting-ai'],
  closer:      ['/evergreen/dashboard', '/evergreen/leads', '/evergreen/contacts', '/evergreen/appointments', '/evergreen/seguimiento', '/evergreen/sales', '/evergreen/reservas', '/evergreen/pagos', '/evergreen/pipeline', '/evergreen/ventas-metricas', '/evergreen/commissions', '/evergreen/targets', '/evergreen/kpi', '/evergreen/tasks', '/evergreen/enlaces', '/evergreen/biblioteca', '/evergreen/contratos/producto'],
  triager:     ['/evergreen/leads', '/evergreen/contacts', '/evergreen/appointments', '/evergreen/pipeline', '/evergreen/ventas-metricas', '/evergreen/prospecting', '/evergreen/kpi', '/evergreen/tasks'],
  cold_caller: ['/evergreen/leads', '/evergreen/contacts', '/evergreen/appointments', '/evergreen/seguimiento', '/evergreen/pipeline', '/evergreen/ventas-metricas', '/evergreen/prospecting', '/evergreen/kpi', '/evergreen/tasks', '/evergreen/enlaces', '/evergreen/biblioteca'],
  affiliate:   ['/evergreen/afiliados', '/evergreen/commissions', '/evergreen/enlaces'],
  gestoria:    ['/evergreen/gestoria', '/evergreen/facturas', '/evergreen/pnl', '/evergreen/finanzas'],
  marketing:   ['/evergreen/campaigns', '/evergreen/attribution', '/evergreen/data-health', '/evergreen/content', '/evergreen/content/reels', '/evergreen/instagram', '/evergreen/vsl', '/evergreen/carruseles'],
  adscripcion: ['/evergreen/attribution', '/evergreen/campaigns', '/evergreen/data-health'],
  editor:      ['/evergreen/content', '/evergreen/content/reels', '/evergreen/instagram', '/evergreen/vsl', '/evergreen/carruseles'],
  csm:         ['/evergreen/students', '/evergreen/csm-events', '/evergreen/retention', '/evergreen/drops'],
  cobros:      ['/evergreen/morosidad', '/evergreen/morosos-sequra', '/evergreen/collections', '/evergreen/pagos'],
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
