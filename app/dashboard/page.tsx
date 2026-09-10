'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { DashboardData } from '@/lib/types'
import { KPICard } from '@/components/KPICard'
import { HorizontalBarChart, DonutChart } from '@/components/FuenteChart'
import { SurveyCharts } from '@/components/SurveyCharts'
import { UTMAnalysis } from '@/components/UTMAnalysis'
import { LeadsTable } from '@/components/LeadsTable'
import { AIChat } from '@/components/AIChat'
import { WhatsAppTracker } from '@/components/WhatsAppTracker'
import { WhatsAppMensajes } from '@/components/WhatsAppMensajes'
import { Afiliadas } from '@/components/Afiliadas'
import { ColdCallingPodium } from '@/components/ColdCallingPodium'
import { LanzamientoSection } from '@/components/LanzamientoSection'
import { formatDate } from '@/lib/utils'

const REFRESH_INTERVAL = 30_000

function DaysUntilLaunch() {
  const launch = new Date('2026-05-06T00:00:00')
  const now = new Date()
  const diff = Math.ceil((launch.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diff <= 0) return <span className="text-[#C9477A] font-semibold">Lanzamiento activo</span>
  return (
    <span className="text-[#94a3b8]">
      <span className="text-[#C9477A] font-bold">{diff}</span> dias para el lanzamiento
    </span>
  )
}

function Header({
  lastUpdated,
  loading,
  onRefresh,
}: {
  lastUpdated: string
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <header className="bg-[#1a1a2e] border-b border-[#2a2a3e] sticky top-0 z-20">
      {/* Top pink accent */}
      <div className="h-0.5 bg-gradient-to-r from-transparent via-[#C9477A] to-transparent" />

      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
        {/* Left: Back + Logo + Title */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="w-8 h-8 rounded-lg bg-[#2a2a3e] hover:bg-[#3a3a5e] flex items-center justify-center transition-colors flex-shrink-0"
            title="Volver al hub"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <div className="w-9 h-9 rounded-xl bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <path
                d="M16 4L28 10V22L16 28L4 22V10L16 4Z"
                stroke="#C9477A"
                strokeWidth="2"
                fill="none"
              />
              <circle cx="16" cy="16" r="4" fill="#C9477A" />
            </svg>
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-tight tracking-tight">
              IA WINNERS
              <span className="text-[#4a4a6a] font-normal mx-2">—</span>
              <span className="text-[#94a3b8] font-normal">Dashboard Lanzamiento</span>
            </h1>
            <p className="text-xs text-[#4a4a6a]">
              <DaysUntilLaunch />
              {' · '}
              Mayo 2026
            </p>
          </div>
        </div>

        {/* Right: Last updated + Refresh */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {lastUpdated && (
            <p className="text-xs text-[#4a4a6a] hidden sm:block">
              Actualizado:{' '}
              <span className="text-[#94a3b8]">
                {new Date(lastUpdated).toLocaleTimeString('es-ES', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </p>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-50 text-[#94a3b8] hover:text-white rounded-xl text-xs transition-colors border border-[#3a3a5e]"
          >
            <svg
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Actualizar
          </button>

          {/* Logout */}
          <button
            onClick={async () => {
              await fetch('/api/auth', { method: 'DELETE' })
              window.location.href = '/login'
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[#4a4a6a] hover:text-[#94a3b8] rounded-xl text-xs transition-colors"
            title="Cerrar sesion"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            Salir
          </button>
        </div>
      </div>
    </header>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/data')
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || err.error || `Error ${res.status}`)
      }
      const json: DashboardData = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchData(true)
  }, [fetchData])

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchData(false), REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchData])

  const isLoading = loading && !data

  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      <Header
        lastUpdated={data?.lastUpdated || ''}
        loading={loading}
        onRefresh={() => fetchData(true)}
      />

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
            <svg
              className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            <div>
              <p className="text-red-400 font-medium text-sm">
                Error al cargar los datos
              </p>
              <p className="text-red-400/70 text-xs mt-0.5">{error}</p>
              <p className="text-[#94a3b8] text-xs mt-1">
                Asegurate de que la hoja de Google Sheets esta configurada como "Cualquier persona con el enlace puede ver".
              </p>
            </div>
          </div>
        )}

        {/* ROW 1: KPI Cards */}
        <section>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Total Leads"
              value={data?.stats.totalLeads ?? 0}
              subtitle="Registros totales"
              loading={isLoading}
              accent
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              }
            />
            <KPICard
              title="Encuesta Completada"
              value={data?.stats.encuestaCompletada ?? 0}
              subtitle={`${data?.stats.encuestaCompletadaPct ?? 0}% del total`}
              loading={isLoading}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              }
            />
            <KPICard
              title="Top Fuente"
              value={data?.stats.topFuente ?? '—'}
              subtitle="Mayor volumen de leads"
              loading={isLoading}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              }
            />
            <KPICard
              title="Leads Hoy"
              value={data?.stats.leadsHoy ?? 0}
              subtitle={`${formatDate(new Date().toISOString())}`}
              loading={isLoading}
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              }
            />
          </div>
        </section>

        {/* ROW 2: Ventas Lanzamiento (agendas + ventas) */}
        <LanzamientoSection />

        {/* ROW 3: WhatsApp Grupo */}
        <WhatsAppTracker />

        {/* ROW 3b: WhatsApp Mensajes */}
        <WhatsAppMensajes stats={data?.whatsappStats || null} loading={isLoading} />

        {/* ROW 3c: Afiliadas */}
        <Afiliadas stats={data?.afiliadasStats || null} loading={isLoading} />

        {/* ROW 3d: Cold Calling */}
        <ColdCallingPodium />

        {/* ROW 3: Procedencia + UTM Source */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
            <h2 className="text-lg font-bold text-white">Procedencia de Leads</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <HorizontalBarChart
              title="Donde me encontraron (encuesta Q1)"
              data={data?.surveyStats.fuente || []}
              loading={isLoading}
            />
            <DonutChart
              title="UTM Source breakdown"
              data={data?.utmStats.bySource || []}
              loading={isLoading}
            />
          </div>
        </section>

        {/* ROW 3: Survey Charts */}
        <SurveyCharts
          surveyStats={data?.surveyStats || null}
          loading={isLoading}
        />

        {/* ROW 4: UTM Analysis */}
        <UTMAnalysis
          utmStats={data?.utmStats || null}
          loading={isLoading}
        />

        {/* ROW 5: AI Chat */}
        <AIChat dashboardData={data} />

        {/* ROW 6: Leads Table */}
        <LeadsTable
          leads={data?.leads || []}
          loading={isLoading}
        />

        {/* Footer */}
        <footer className="text-center pb-8 pt-4 border-t border-[#2a2a3e]">
          <p className="text-[#4a4a6a] text-xs">
            IA WINNERS — Dashboard Lanzamiento Mayo 2026
            {' · '}
            Datos actualizados cada 30 segundos
          </p>
        </footer>
      </main>
    </div>
  )
}
