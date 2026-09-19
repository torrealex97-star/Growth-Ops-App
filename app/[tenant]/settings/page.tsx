'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  Shield,
  Package,
  Percent,
  UserCog,
  FileText,
  Building2,
  FileSignature,
  ChevronRight,
  TrendingUp,
  Plug,
  Handshake,
  Building,
  Mail,
} from 'lucide-react'
import { useSesion, useTenant } from '@/lib/tenant-context'

// `manageOnly: false` = visible para cualquiera que llegue a Configuración. El resto son de
// gestión (admin/director/manager), igual que filtraba la barra de pestañas que esta rejilla
// sustituye: sin ese filtro, un rol de marketing vería tarjetas que no puede abrir.
const SETTINGS_CARDS = [
  {
    title: 'Data Health',
    description: 'Calidad, duplicados y frescura de los datos de cada fuente',
    icon: Activity,
    href: '/settings/data-health',
    color: 'text-teal-400',
    bg: 'bg-teal-500/10',
    manageOnly: false,
  },
  {
    title: 'Integraciones',
    description: 'Conecta y verifica las fuentes de datos de esta subcuenta',
    icon: Plug,
    href: '/settings/integraciones',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
  },
  {
    title: 'Datos de empresa',
    description: 'Datos que se mapean en contratos y emails',
    icon: Building2,
    href: '/settings/empresa',
    color: 'text-indigo-400',
    bg: 'bg-indigo-500/10',
  },
  {
    title: 'Correos',
    description: 'Personaliza asunto y cuerpo de los emails que envía la plataforma',
    icon: Mail,
    href: '/settings/correos',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
  },
  {
    title: 'Contratos de equipo',
    description: 'Genera y envía contratos a firmar',
    icon: FileSignature,
    href: '/contratos/equipo',
    color: 'text-sky-400',
    bg: 'bg-sky-500/10',
  },
  {
    title: 'Productos',
    description: 'Gestiona los productos y sus detalles',
    icon: Package,
    href: '/settings/products',
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
  },
  {
    title: 'Reglas de Comision',
    description: 'Configura los porcentajes de comision por rol',
    icon: Percent,
    href: '/settings/commission-rules',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  {
    title: 'Usuarios',
    description: 'Gestiona los usuarios y sus roles',
    icon: UserCog,
    href: '/settings/users',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    title: 'Formularios KPI',
    description: 'Configura los campos de informe diario',
    icon: FileText,
    href: '/kpi/templates',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  {
    title: 'Programa de colaboradores',
    description: 'Formulario público de alta y comisión por defecto',
    icon: TrendingUp,
    href: '/settings/afiliados',
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
  },
  {
    title: 'Socios y reparto de beneficios',
    description: 'Gestiona los socios de la cuenta y su % de participación',
    icon: Handshake,
    href: '/settings/socios',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  {
    // Alta de subcuentas: operación de PLATAFORMA, no de cliente. Por eso no basta con `manageOnly`
    // (que mira el rol global admin/director/manager): se comprueba `is_super_admin` aparte, y la
    // ruta de la API lo vuelve a comprobar — esta tarjeta solo decide qué se pinta.
    title: 'Subcuentas',
    description: 'Da de alta subcuentas y mira qué le falta a cada una',
    icon: Building,
    href: '/settings/subcuentas',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    superAdminOnly: true,
  },
  {
    title: 'Auditoría',
    description: 'Quién cambió cada venta, cobro, cita o comisión, y cuándo',
    icon: Shield,
    href: '/audit',
    color: 'text-rose-400',
    bg: 'bg-rose-500/10',
  },
]

export default function SettingsPage() {
  const tenant = useTenant()
  const router = useRouter()
  // Sesión ya resuelta por el layout: evita repetir auth.getUser() + from('users') aquí.
  const sesion = useSesion()
  // Arranca en null (= "todavía no se sabe") en vez de true: asumir que puede gestionar pintaría
  // por un instante tarjetas que no le corresponden.
  const [canManage, setCanManage] = useState<boolean | null>(null)
  // Igual que `canManage`: arranca en null para no pintar la tarjeta de plataforma antes de saberlo.
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null)

  // TRES VIAJES DE RED A CERO. Esta pantalla hacía `auth.getUser()`, luego `users` para el rol y luego
  // `rpc('is_super_admin')`, los tres EN SERIE, y los tres los había hecho ya el layout para decidir si
  // dejar entrar aquí. Con la sesión publicada no hace falta ninguno.
  useEffect(() => {
    if (!sesion) {
      setCanManage(false)
      return
    }
    setCanManage(sesion.rol === 'admin' || sesion.rol === 'director' || sesion.rol === 'manager')
    // super_admin de plataforma no es un rol de `users`: lo resuelve el layout preguntando a la función
    // de base que usan las políticas de RLS, no deduciéndolo del rol.
    setIsSuperAdmin(sesion.isSuperAdmin)
  }, [sesion])

  const cards = SETTINGS_CARDS.filter((card) => {
    if ('superAdminOnly' in card && card.superAdminOnly) return isSuperAdmin === true
    return canManage === true || card.manageOnly === false
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuracion</h1>
        <p className="text-muted-foreground text-sm mt-1">Ajustes del sistema y gestion del equipo</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((card) => (
          <button
            key={card.href}
            onClick={() => router.push(`/${tenant}${card.href}`)}
            className="flex items-center gap-4 p-5 bg-card border border-border rounded-lg hover:border-border transition-colors text-left group"
          >
            <div className={`w-10 h-10 rounded-lg ${card.bg} flex items-center justify-center shrink-0`}>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground">{card.title}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{card.description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-muted-foreground transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
