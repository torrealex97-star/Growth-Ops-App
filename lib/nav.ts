// Mapa de navegación del panel — fuente única para el Sidebar y para la búsqueda global (la lupa
// de la cabecera). Estaba solo dentro de Sidebar.tsx; al compartirlo, la lupa encuentra
// exactamente las mismas pantallas que el usuario tiene permitidas, sin listas paralelas.
import {
  LayoutDashboard, Users, Calendar, ShoppingCart, DollarSign, RotateCcw, TrendingUp, Target,
  ClipboardList, Shield, Settings, Package, Percent, UserCog, FileText, Megaphone, Inbox,
  ListChecks, Clapperboard, Radio, GraduationCap, CalendarCheck, UserMinus, Wallet,
  PieChart, CalendarRange, Receipt, Gauge, AlertTriangle, BarChart3, PhoneCall, CreditCard, Link2,
  Video, Camera, Radar, Lightbulb, Plug, Layers, LineChart, Activity, Images, Award, Bot,
  ClipboardList as ClipboardListIcon,
} from 'lucide-react'
import { allowedPrefixesFor, type AppRole, type Department } from '@/lib/auth/permissions'

export interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  roles?: AppRole[]
  children?: NavItem[]
}

export interface NavSection {
  dept: Department | null // null = ítems sueltos arriba (Dashboard)
  items: NavItem[]
}

const LEAD: AppRole[] = ['admin', 'director', 'manager']

export const NAV_SECTIONS: NavSection[] = [
  {
    dept: null,
    items: [
      { label: 'Dashboard', href: '/evergreen/dashboard', icon: LayoutDashboard, roles: [...LEAD, 'setter', 'closer', 'affiliate'] },
      { label: 'Métricas', href: '/evergreen/unit-economics', icon: BarChart3, roles: LEAD },
      { label: 'Tareas', href: '/evergreen/tasks', icon: ListChecks, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'] },
    ],
  },
  {
    dept: 'direccion',
    items: [
      { label: 'Cohortes', href: '/evergreen/cohorts', icon: CalendarRange, roles: LEAD },
      { label: 'I&G (P&L)', href: '/evergreen/pnl', icon: Receipt, roles: [...LEAD, 'gestoria'] },
    ],
  },
  {
    dept: 'ventas',
    items: [
      { label: 'Leads', href: '/evergreen/leads', icon: Inbox, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'] },
      { label: 'Contactos', href: '/evergreen/contacts', icon: Users, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'] },
      { label: 'Agendas', href: '/evergreen/appointments', icon: Calendar, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'] },
      { label: 'Pipeline de seguimiento', href: '/evergreen/seguimiento', icon: ClipboardListIcon, roles: [...LEAD, 'setter', 'closer', 'cold_caller'] },
      { label: 'Ventas', href: '/evergreen/sales', icon: ShoppingCart, roles: [...LEAD, 'setter', 'closer'] },
      { label: 'Reservas', href: '/evergreen/reservas', icon: CreditCard, roles: [...LEAD, 'setter', 'closer'] },
      { label: 'Pipeline de pagos', href: '/evergreen/pagos', icon: Wallet, roles: [...LEAD, 'setter', 'closer', 'cobros'] },
      { label: 'Ranking', href: '/evergreen/pipeline', icon: Gauge, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'] },
      { label: 'Métricas ventas', href: '/evergreen/ventas-metricas', icon: BarChart3, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'] },
      { label: 'Prospección', href: '/evergreen/prospecting', icon: PhoneCall, roles: [...LEAD, 'setter', 'triager', 'cold_caller'] },
      { label: 'Comisiones', href: '/evergreen/commissions', icon: TrendingUp, roles: [...LEAD, 'setter', 'closer', 'affiliate'] },
      { label: 'Objetivos', href: '/evergreen/targets', icon: Target, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller', 'affiliate'] },
      { label: 'KPI Diario', href: '/evergreen/kpi/report', icon: ClipboardList, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'] },
      { label: 'Enlaces', href: '/evergreen/enlaces', icon: Link2, roles: [...LEAD, 'setter', 'closer', 'cold_caller', 'affiliate'] },
      { label: 'Biblioteca de llamadas', href: '/evergreen/biblioteca', icon: Video, roles: [...LEAD, 'setter', 'closer', 'cold_caller'] },
      { label: 'Testimonios', href: '/evergreen/testimonios', icon: Award, roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller', 'csm', 'marketing', 'editor'] },
      { label: 'Setting AI', href: '/evergreen/setting-ai', icon: Bot, roles: [...LEAD, 'setter'] },
      { label: 'Contratos de producto', href: '/evergreen/contratos/producto', icon: FileText, roles: [...LEAD, 'closer'] },
    ],
  },
  {
    dept: 'marketing',
    items: [
      { label: 'Campañas', href: '/evergreen/campaigns', icon: Radio, roles: [...LEAD, 'marketing', 'adscripcion'] },
      { label: 'Atribución', href: '/evergreen/attribution', icon: Megaphone, roles: [...LEAD, 'marketing', 'adscripcion'] },
      { label: 'Data Health', href: '/evergreen/data-health', icon: Activity, roles: [...LEAD, 'marketing', 'adscripcion'] },
      { label: 'Contenido', href: '/evergreen/content', icon: Clapperboard, roles: [...LEAD, 'marketing', 'editor'] },
      { label: 'Reels del día', href: '/evergreen/content/reels', icon: Clapperboard, roles: [...LEAD, 'marketing', 'editor'] },
      { label: 'Carruseles y Flyers', href: '/evergreen/carruseles', icon: Images, roles: [...LEAD, 'marketing', 'editor'] },
      { label: 'Instagram', href: '/evergreen/instagram', icon: Camera, roles: [...LEAD, 'marketing', 'editor'] },
      { label: 'Competencia', href: '/evergreen/instagram/competencia', icon: Radar, roles: [...LEAD, 'marketing'] },
      { label: 'VSL / Vídeos', href: '/evergreen/vsl', icon: Video, roles: [...LEAD, 'marketing', 'editor'] },
    ],
  },
  {
    dept: 'producto',
    items: [
      { label: 'Alumnos', href: '/evergreen/students', icon: GraduationCap, roles: [...LEAD, 'csm'] },
      { label: 'Eventos CSM', href: '/evergreen/csm-events', icon: CalendarCheck, roles: [...LEAD, 'csm'] },
      { label: 'Cancelaciones', href: '/evergreen/drops', icon: UserMinus, roles: [...LEAD, 'csm'] },
      { label: 'Contratos de alumnos', href: '/evergreen/contratos', icon: FileText, roles: [...LEAD, 'csm', 'gestoria'] },
      { label: 'Contratos de equipo', href: '/evergreen/contratos/equipo', icon: Shield, roles: LEAD },
    ],
  },
  {
    dept: 'finanzas',
    items: [
      { label: 'Resumen financiero', href: '/evergreen/finanzas', icon: PieChart, roles: LEAD },
      { label: 'Proyección de caja', href: '/evergreen/proyeccion', icon: LineChart, roles: LEAD },
      { label: 'Gastos', href: '/evergreen/expenses', icon: Wallet, roles: LEAD },
      { label: 'Facturas', href: '/evergreen/facturas', icon: FileText, roles: [...LEAD, 'gestoria'] },
      { label: 'Gestoría', href: '/evergreen/gestoria', icon: Receipt, roles: [...LEAD, 'gestoria'] },
      { label: 'Afiliados', href: '/evergreen/afiliados', icon: TrendingUp, roles: [...LEAD, 'affiliate'] },
      { label: 'Campañas afiliados', href: '/evergreen/afiliados/campanas', icon: Megaphone, roles: LEAD },
      { label: 'Morosidad', href: '/evergreen/morosidad', icon: AlertTriangle, roles: [...LEAD, 'cobros'] },
      { label: 'Morosos sequra', href: '/evergreen/morosos-sequra', icon: AlertTriangle, roles: [...LEAD, 'cobros'] },
      { label: 'Cobros', href: '/evergreen/collections', icon: DollarSign, roles: [...LEAD, 'cobros'] },
      { label: 'Devoluciones', href: '/evergreen/refunds', icon: RotateCcw, roles: LEAD },
    ],
  },
  {
    dept: 'sistema',
    items: [
      { label: 'Sugerencias', href: '/evergreen/settings/sugerencias', icon: Lightbulb, roles: ['admin', 'director'] },
      { label: 'Actividad', href: '/evergreen/actividad', icon: Activity, roles: ['admin', 'director'] },
      { label: 'Auditoría', href: '/evergreen/audit', icon: Shield, roles: ['admin', 'director'] },
      {
        label: 'Configuración',
        href: '/evergreen/settings',
        icon: Settings,
        roles: ['admin'],
        children: [
          { label: 'Productos', href: '/evergreen/settings/products', icon: Package, roles: ['admin'] },
          { label: 'Reglas Comisión', href: '/evergreen/settings/commission-rules', icon: Percent, roles: ['admin'] },
          { label: 'Socios', href: '/evergreen/settings/partners', icon: Percent, roles: ['admin'] },
          { label: 'Usuarios', href: '/evergreen/settings/users', icon: UserCog, roles: ['admin'] },
          { label: 'Tramos', href: '/evergreen/settings/tramos', icon: Layers, roles: ['admin'] },
          { label: 'Plantillas de contratos', href: '/evergreen/contratos/plantillas', icon: FileText, roles: ['admin', 'director'] },
          { label: 'Integraciones', href: '/evergreen/settings/integraciones', icon: Plug, roles: ['admin'] },
          { label: 'Formularios KPI', href: '/evergreen/kpi/templates', icon: FileText, roles: ['admin', 'director'] },
        ],
      },
    ],
  },
]

// Filtro de visibilidad por rol + zonas permitidas + overrides explícitos del admin.
// Mismo criterio que usaba el Sidebar: con override explícito el acceso es ADITIVO.
export function makeNavFilter(
  role: AppRole,
  deptOverrides?: string[] | null,
  pageOverrides?: string[] | null
): (item: NavItem) => boolean {
  const zones = allowedPrefixesFor(role, deptOverrides, pageOverrides)
  const hasExplicitOverride = !!((pageOverrides && pageOverrides.length) || (deptOverrides && deptOverrides.length))
  return (item: NavItem) => {
    const inZones =
      !zones || zones.length === 0 || zones.some((z) => item.href.startsWith(z) || z.startsWith(item.href))
    if (hasExplicitOverride) return inZones
    if (item.roles && !item.roles.includes(role)) return false
    return inZones
  }
}

// Lista plana (padres + hijos) de todas las pantallas visibles para el usuario, para la lupa.
export function visibleNavItems(filter: (item: NavItem) => boolean): NavItem[] {
  const out: NavItem[] = []
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (!filter(item)) continue
      out.push(item)
      for (const child of item.children ?? []) if (filter(child)) out.push(child)
    }
  }
  return out
}
