'use client'

import { useRouter } from 'next/navigation'
import {
  Package,
  Percent,
  UserCog,
  FileText,
  Building2,
  FileSignature,
  ChevronRight,
  TrendingUp,
  Plug,
} from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { SettingsNav } from '@/components/settings/SettingsNav'

const SETTINGS_CARDS = [
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
    title: 'Programa de afiliados',
    description: 'Formulario público de alta y comisión por defecto',
    icon: TrendingUp,
    href: '/settings/afiliados',
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
  },
]

export default function SettingsPage() {
  const tenant = useTenant()
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuracion</h1>
        <p className="text-muted-foreground text-sm mt-1">Ajustes del sistema y gestion del equipo</p>
      </div>

      <SettingsNav current="general" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SETTINGS_CARDS.map((card) => (
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
