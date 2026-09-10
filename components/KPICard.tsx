'use client'

import { formatNumber } from '@/lib/utils'

interface KPICardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ReactNode
  accent?: boolean
  loading?: boolean
}

function KPISkeleton() {
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6">
      <div className="skeleton h-4 w-24 mb-4" />
      <div className="skeleton h-8 w-16 mb-2" />
      <div className="skeleton h-3 w-20" />
    </div>
  )
}

export function KPICard({
  title,
  value,
  subtitle,
  icon,
  accent = false,
  loading = false,
}: KPICardProps) {
  if (loading) return <KPISkeleton />

  const displayValue =
    typeof value === 'number' ? formatNumber(value) : value

  return (
    <div
      className={`relative bg-[#1a1a2e] border rounded-2xl p-6 overflow-hidden transition-all duration-200 hover:border-[#C9477A]/40 group ${
        accent
          ? 'border-[#C9477A]/40 shadow-lg shadow-[#C9477A]/5'
          : 'border-[#2a2a3e]'
      }`}
    >
      {/* Background glow for accent card */}
      {accent && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#C9477A]/5 rounded-full blur-2xl pointer-events-none" />
      )}

      <div className="flex items-start justify-between mb-4">
        <span className="text-[#94a3b8] text-sm font-medium">{title}</span>
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            accent
              ? 'bg-[#C9477A]/20 text-[#C9477A]'
              : 'bg-[#2a2a3e] text-[#94a3b8]'
          } group-hover:bg-[#C9477A]/20 group-hover:text-[#C9477A] transition-colors`}
        >
          {icon}
        </div>
      </div>

      <div className="text-3xl font-bold text-foreground mb-1">{displayValue}</div>

      {subtitle && (
        <div className="text-sm text-[#94a3b8]">{subtitle}</div>
      )}

      {/* Bottom accent line */}
      {accent && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-[#C9477A] to-transparent" />
      )}
    </div>
  )
}
