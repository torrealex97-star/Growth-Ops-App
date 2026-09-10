'use client'

import type { SurveyStats } from '@/lib/types'
import { HorizontalBarChart, DonutChart } from './FuenteChart'

interface SurveyChartsProps {
  surveyStats: SurveyStats | null
  loading?: boolean
}

export function SurveyCharts({ surveyStats, loading = false }: SurveyChartsProps) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
        <h2 className="text-lg font-bold text-foreground">Perfil del Lead</h2>
        <span className="text-xs text-[#94a3b8] bg-[#1a1a2e] border border-[#2a2a3e] px-2 py-0.5 rounded-full">
          Solo leads con encuesta completada
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HorizontalBarChart
          title="Edad"
          data={surveyStats?.edad || []}
          loading={loading}
        />
        <HorizontalBarChart
          title="Ocupacion"
          data={surveyStats?.ocupacion || []}
          loading={loading}
        />
        <DonutChart
          title="Independencia Economica"
          data={surveyStats?.economia || []}
          loading={loading}
        />
        <HorizontalBarChart
          title="Situacion Actual"
          data={surveyStats?.objetivo || []}
          loading={loading}
        />
      </div>

      {/* Learn section - full width */}
      <div className="mt-4">
        <HorizontalBarChart
          title="Que quieren aprender"
          data={surveyStats?.aprender || []}
          loading={loading}
        />
      </div>

      {/* Timing section */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <DonutChart
          title="Tiempo siguiendola"
          data={surveyStats?.timing || []}
          loading={loading}
        />
        <HorizontalBarChart
          title="Procedencia (donde encontraron el perfil)"
          data={surveyStats?.fuente || []}
          loading={loading}
        />
      </div>
    </section>
  )
}
