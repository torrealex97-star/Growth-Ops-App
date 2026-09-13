// Mapa de navegación del panel — fuente única para el Sidebar y para la búsqueda global (la lupa
// de la cabecera). Estaba solo dentro de Sidebar.tsx; al compartirlo, la lupa encuentra
// exactamente las mismas pantallas que el usuario tiene permitidas, sin listas paralelas.
import {
  LayoutDashboard,
  Users,
  Calendar,
  Mic,
  ShoppingCart,
  DollarSign,
  RotateCcw,
  TrendingUp,
  Target,
  ClipboardList,
  Shield,
  Settings,
  Package,
  Percent,
  UserCog,
  FileText,
  Megaphone,
  Inbox,
  ListChecks,
  Clapperboard,
  Radio,
  GraduationCap,
  CalendarCheck,
  UserMinus,
  Wallet,
  PieChart,
  CalendarRange,
  Receipt,
  Gauge,
  AlertTriangle,
  BarChart3,
  PhoneCall,
  CreditCard,
  Link2,
  Video,
  Camera,
  Radar,
  Lightbulb,
  Plug,
  Layers,
  LineChart,
  Activity,
  Images,
  Award,
  Bot,
  UserRound,
  Wrench,
  Scale,
  Filter,
  FileAudio,
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
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
        roles: [...LEAD, 'setter', 'closer', 'affiliate'],
      },
      { label: 'Métricas', href: '/unit-economics', icon: BarChart3, roles: LEAD },
      // Funnels va arriba y no dentro de "Analítica de ventas" a propósito: cruza marketing y
      // ventas (impresiones de Meta, visitas, leads, agendas, cierres), así que no pertenece a un
      // solo departamento.
      { label: 'Funnels', href: '/funnels', icon: Filter, roles: [...LEAD, 'marketing', 'adscripcion'] },
      {
        label: 'Tareas',
        href: '/tasks',
        icon: ListChecks,
        roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
      },
    ],
  },
  {
    dept: 'ventas',
    items: [
      {
        // La agenda es la pantalla de cada mañana, así que es el destino por defecto del CRM y el
        // primer hijo. /crm redirige aquí en servidor (ver app/[tenant]/crm/page.tsx).
        label: 'CRM',
        href: '/crm/agendas',
        icon: Users,
        roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
        children: [
          {
            label: 'Agendas',
            href: '/crm/agendas',
            icon: Calendar,
            roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
          },
          {
            label: 'Contactos',
            href: '/crm/contactos',
            icon: UserRound,
            roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
          },
          {
            label: 'Leads (VSL)',
            href: '/crm/contactos?view=leads',
            icon: Inbox,
            roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
          },
          {
            label: 'Seguimiento',
            href: '/crm/seguimiento',
            icon: ClipboardList,
            roles: [...LEAD, 'setter', 'closer', 'cold_caller'],
          },
          {
            // Cola de reuniones de Fathom que el sync no pudo atribuir sin adivinar. Está en el menú
            // y no solo enlazada desde Agendas porque una cola que nadie ve se queda sin vaciar, que
            // es como estaba: los casos se anotaban y solo se podían resolver tocando la tabla.
            label: 'Llamadas sin atribuir',
            href: '/crm/fathom-revision',
            icon: Mic,
            roles: [...LEAD],
          },
        ],
      },
      {
        label: 'Ventas & Cobros',
        href: '/ventas/registro',
        icon: ShoppingCart,
        roles: [...LEAD, 'setter', 'closer', 'cobros'],
        children: [
          { label: 'Registro', href: '/ventas/registro', icon: ShoppingCart, roles: [...LEAD, 'setter', 'closer'] },
          { label: 'Pagos', href: '/ventas/pagos', icon: Wallet, roles: [...LEAD, 'setter', 'closer', 'cobros'] },
          { label: 'Reservas', href: '/ventas/reservas', icon: CreditCard, roles: [...LEAD, 'setter', 'closer'] },
        ],
      },
      {
        label: 'Analítica de ventas',
        href: '/analitica/embudo',
        icon: BarChart3,
        roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
        children: [
          {
            label: 'Embudo',
            href: '/analitica/embudo',
            icon: BarChart3,
            roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
          },
          {
            label: 'Ranking',
            href: '/analitica/ranking',
            icon: Gauge,
            roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
          },
          {
            label: 'Actividad',
            href: '/analitica/actividad',
            icon: PhoneCall,
            roles: [...LEAD, 'setter', 'triager', 'cold_caller'],
          },
          {
            label: 'KPI Diario',
            href: '/analitica/actividad?kpi=1',
            icon: ClipboardList,
            roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
          },
        ],
      },
      { label: 'Comisiones', href: '/comisiones', icon: TrendingUp, roles: [...LEAD, 'setter', 'closer', 'affiliate'] },
      {
        label: 'Recursos de venta',
        href: '/recursos/enlaces',
        icon: Wrench,
        roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller', 'affiliate', 'csm', 'marketing', 'editor'],
        children: [
          {
            label: 'Enlaces',
            href: '/recursos/enlaces',
            icon: Link2,
            roles: [...LEAD, 'setter', 'closer', 'cold_caller', 'affiliate'],
          },
          {
            label: 'Biblioteca',
            href: '/recursos/biblioteca',
            icon: Video,
            roles: [...LEAD, 'setter', 'closer', 'cold_caller'],
          },
          {
            label: 'Testimonios',
            href: '/recursos/testimonios',
            icon: Award,
            roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller', 'csm', 'marketing', 'editor'],
          },
          {
            label: 'Grabaciones',
            href: '/recursos/grabaciones',
            icon: FileAudio,
            roles: [...LEAD, 'setter', 'closer', 'triager', 'cold_caller'],
          },
          { label: 'Contratos', href: '/recursos/contratos-producto', icon: FileText, roles: [...LEAD, 'closer'] },
        ],
      },
    ],
  },
  {
    dept: 'marketing',
    items: [
      {
        label: 'Adquisición',
        href: '/marketing/adquisicion',
        icon: Radio,
        roles: [...LEAD, 'marketing', 'adscripcion', 'editor'],
        children: [
          {
            label: 'Campañas',
            href: '/marketing/adquisicion/campanas',
            icon: Radio,
            roles: [...LEAD, 'marketing', 'adscripcion'],
          },
          {
            label: 'Atribución',
            href: '/marketing/adquisicion/atribucion',
            icon: Megaphone,
            roles: [...LEAD, 'marketing', 'adscripcion'],
          },
          { label: 'VSL', href: '/marketing/adquisicion/vsl', icon: Video, roles: [...LEAD, 'marketing', 'editor'] },
        ],
      },
      {
        label: 'Instagram',
        href: '/instagram',
        icon: Camera,
        roles: [...LEAD, 'marketing', 'editor'],
        children: [
          { label: 'Rendimiento', href: '/instagram', icon: Camera, roles: [...LEAD, 'marketing', 'editor'] },
          {
            label: 'Reels del día',
            href: '/instagram/reels',
            icon: Clapperboard,
            roles: [...LEAD, 'marketing', 'editor'],
          },
          {
            label: 'Carruseles y Flyers',
            href: '/instagram/carruseles',
            icon: Images,
            roles: [...LEAD, 'marketing', 'editor'],
          },
          { label: 'Competencia', href: '/instagram/competencia', icon: Radar, roles: [...LEAD, 'marketing'] },
        ],
      },
      { label: 'Contenido', href: '/marketing/contenido', icon: Clapperboard, roles: [...LEAD, 'marketing', 'editor'] },
      {
        label: 'Afiliados',
        href: '/marketing/afiliados/afiliados',
        icon: TrendingUp,
        roles: [...LEAD, 'affiliate'],
        children: [
          {
            label: 'Afiliados',
            href: '/marketing/afiliados/afiliados',
            icon: TrendingUp,
            roles: [...LEAD, 'affiliate'],
          },
          { label: 'Campañas', href: '/marketing/afiliados/campanas', icon: Megaphone, roles: LEAD },
        ],
      },
      { label: 'Setting AI', href: '/setting-ai', icon: Bot, roles: [...LEAD, 'setter', 'marketing'] },
    ],
  },
  {
    dept: 'producto',
    items: [
      { label: 'Alumnos', href: '/students', icon: GraduationCap, roles: [...LEAD, 'csm'] },
      { label: 'Eventos CSM', href: '/csm-events', icon: CalendarCheck, roles: [...LEAD, 'csm'] },
      { label: 'Cancelaciones', href: '/drops', icon: UserMinus, roles: [...LEAD, 'csm'] },
      { label: 'Contratos de alumnos', href: '/contratos', icon: FileText, roles: [...LEAD, 'csm', 'gestoria'] },
      { label: 'Contratos de equipo', href: '/contratos/equipo', icon: Shield, roles: LEAD },
    ],
  },
  {
    dept: 'finanzas',
    items: [
      {
        label: 'Analítica financiera',
        href: '/finanzas/analitica/resumen',
        icon: PieChart,
        roles: [...LEAD, 'gestoria'],
        children: [
          { label: 'Resumen', href: '/finanzas/analitica/resumen', icon: PieChart, roles: [...LEAD, 'gestoria'] },
          { label: 'Proyección de caja', href: '/finanzas/analitica/proyeccion', icon: LineChart, roles: LEAD },
          { label: 'I&G (P&L)', href: '/finanzas/analitica/pnl', icon: Receipt, roles: [...LEAD, 'gestoria'] },
          { label: 'Cohortes', href: '/finanzas/analitica/cohortes', icon: CalendarRange, roles: LEAD },
        ],
      },
      {
        label: 'Gastos & Facturas',
        href: '/finanzas/gastos-facturas/gastos',
        icon: Wallet,
        roles: [...LEAD, 'gestoria'],
        children: [
          { label: 'Gastos', href: '/finanzas/gastos-facturas/gastos', icon: Wallet, roles: LEAD },
          {
            label: 'Facturas',
            href: '/finanzas/gastos-facturas/facturas',
            icon: FileText,
            roles: [...LEAD, 'gestoria'],
          },
          {
            label: 'Export gestoría',
            href: '/finanzas/gastos-facturas/gestoria',
            icon: Receipt,
            roles: [...LEAD, 'gestoria'],
          },
        ],
      },
      {
        label: 'Cobros & Conciliación',
        href: '/finanzas/cobros/cobros',
        icon: DollarSign,
        roles: [...LEAD, 'cobros'],
        children: [
          { label: 'Cobros', href: '/finanzas/cobros/cobros', icon: DollarSign, roles: [...LEAD, 'cobros'] },
          { label: 'Devoluciones', href: '/finanzas/cobros/devoluciones', icon: RotateCcw, roles: LEAD },
          { label: 'Conciliación', href: '/finanzas/cobros/conciliacion', icon: Scale, roles: [...LEAD, 'cobros'] },
        ],
      },
      { label: 'Morosidad', href: '/finanzas/morosidad', icon: AlertTriangle, roles: [...LEAD, 'cobros'] },
    ],
  },
  {
    dept: 'sistema',
    items: [
      { label: 'Sugerencias', href: '/settings/sugerencias', icon: Lightbulb, roles: ['admin', 'director'] },
      { label: 'Actividad', href: '/actividad', icon: Activity, roles: ['admin', 'director'] },
      // Auditoría baja de primer nivel a Configuración: es la única trazabilidad de quién tocó un
      // dato financiero (no se borra), pero es una pantalla de consulta puntual y solo para
      // admin/director — no merecía un hueco permanente en la navegación principal.
      {
        label: 'Configuración',
        href: '/settings',
        icon: Settings,
        roles: LEAD,
        children: [
          { label: 'General', href: '/settings', icon: Settings, roles: ['admin'] },
          {
            label: 'Data Health',
            href: '/settings/data-health',
            icon: Activity,
            roles: [...LEAD, 'marketing', 'adscripcion'],
          },
          { label: 'Productos', href: '/settings/products', icon: Package, roles: ['admin'] },
          { label: 'Reglas Comisión', href: '/settings/commission-rules', icon: Percent, roles: ['admin'] },
          { label: 'Usuarios', href: '/settings/users', icon: UserCog, roles: ['admin'] },
          { label: 'Tramos', href: '/settings/tramos', icon: Layers, roles: ['admin'] },
          {
            label: 'Plantillas de contratos',
            href: '/contratos/plantillas',
            icon: FileText,
            roles: ['admin', 'director'],
          },
          { label: 'Integraciones', href: '/settings/integraciones', icon: Plug, roles: ['admin'] },
          { label: 'Formularios KPI', href: '/kpi/templates', icon: FileText, roles: ['admin', 'director'] },
          { label: 'Auditoría', href: '/audit', icon: Shield, roles: ['admin', 'director'] },
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

export function navHrefForRole(item: NavItem, role: AppRole): string {
  if (item.href === '/settings' && (role === 'marketing' || role === 'adscripcion')) {
    return '/settings/data-health'
  }
  return item.href
}
