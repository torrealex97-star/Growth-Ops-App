'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Package,
  Percent,
  UserCog,
  FileText,
  Building2,
  FileSignature,
  ChevronRight,
  TrendingUp,
  Settings as SettingsIcon,
  Database,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'
import { createClient } from '@/lib/supabase/client'
import { DataHealthPanel } from '@/components/settings/DataHealthPanel'

const SETTINGS_CARDS = [
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

type SettingsTab = 'general' | 'data-health'

// Roles que solo tienen permiso para Data Health (no para el resto de Configuración, que sigue
// siendo solo-admin): ven directamente el panel, sin el selector de pestañas ni las tarjetas.
const DATA_HEALTH_ONLY_ROLES = new Set(['director', 'manager', 'marketing', 'adscripcion'])

function SettingsPageInner() {
  const tenant = useTenant()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab: SettingsTab = searchParams.get('tab') === 'data-health' ? 'data-health' : 'general'
  const [roleLoading, setRoleLoading] = useState(true)
  const [dataHealthOnly, setDataHealthOnly] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setRoleLoading(false)
        return
      }
      const { data } = await supabase.from('users').select('roles(key)').eq('id', user.id).single()
      const role = (data?.roles as { key?: string } | null)?.key
      setDataHealthOnly(!!role && DATA_HEALTH_ONLY_ROLES.has(role))
      setRoleLoading(false)
    })
  }, [])

  const setTab = (t: SettingsTab) => {
    const params = new URLSearchParams(searchParams.toString())
    if (t === 'general') params.delete('tab')
    else params.set('tab', t)
    const qs = params.toString()
    router.push(qs ? `?${qs}` : '?', { scroll: false })
  }

  if (roleLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )
  }

  // Roles no-admin: solo pueden ver Data Health, directamente, sin las tarjetas de
  // administración (esas siguen siendo solo-admin) ni el selector de pestañas.
  if (dataHealthOnly) {
    return (
      <div className="space-y-6">
        <DataHealthPanel />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuracion</h1>
        <p className="text-muted-foreground text-sm mt-1">Ajustes del sistema y gestion del equipo</p>
      </div>

      <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground">
        <button
          onClick={() => setTab('general')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
            tab === 'general' ? 'bg-card text-foreground shadow' : 'hover:text-foreground'
          )}
        >
          <SettingsIcon className="w-3.5 h-3.5" /> Configuración
        </button>
        <button
          onClick={() => setTab('data-health')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
            tab === 'data-health' ? 'bg-card text-foreground shadow' : 'hover:text-foreground'
          )}
        >
          <Database className="w-3.5 h-3.5" /> Data Health
        </button>
      </div>

      {tab === 'data-health' ? (
        <DataHealthPanel />
      ) : (
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
      )}
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageInner />
    </Suspense>
  )
}
