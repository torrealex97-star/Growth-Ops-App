import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader, Sparkles } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import type { AppointmentWithRelations } from '@/lib/types/database'

// Extraído de crm/agendas/page.tsx (Fase 6/9): vista "análisis" de la pantalla de Agendas —
// puramente presentacional, todos los datos ya vienen calculados (useMemo) del componente padre,
// que sigue siendo el dueño del estado/fetch. Sin cambio de comportamiento respecto al bloque
// original, solo relocalizado para reducir el tamaño del archivo (2398 líneas antes de este split).

type AiKpis = { count: number; avgCall: number | null; avgLead: number | null }

interface AgendasAnalysisViewProps {
  aiKpis: AiKpis
  pendingAnalysisAppointments: AppointmentWithRelations[]
  analyzedAppointments: AppointmentWithRelations[]
  onSelectAppointment: (appointment: AppointmentWithRelations) => void
}

export function AgendasAnalysisView({
  aiKpis,
  pendingAnalysisAppointments,
  analyzedAppointments,
  onSelectAppointment,
}: AgendasAnalysisViewProps) {
  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Llamadas analizadas</p>
          <p className="text-2xl font-bold text-foreground mt-1">{aiKpis.count}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Nota media de llamada</p>
          <p className="text-2xl font-bold text-foreground mt-1">
            {aiKpis.avgCall !== null ? `${aiKpis.avgCall.toFixed(1)}/10` : '—'}
          </p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground">Nota media de lead</p>
          <p className="text-2xl font-bold text-foreground mt-1">
            {aiKpis.avgLead !== null ? `${aiKpis.avgLead.toFixed(1)}/10` : '—'}
          </p>
        </div>
      </div>

      {/* En proceso / error */}
      {pendingAnalysisAppointments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">En proceso</p>
          <div className="flex flex-wrap gap-2">
            {pendingAnalysisAppointments.map((appt) => (
              <button
                key={appt.id}
                onClick={() => onSelectAppointment(appt)}
                className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors"
              >
                <span className="text-sm text-foreground">{appt.contacts?.full_name || '—'}</span>
                {appt.transcript_status === 'procesando' ? (
                  <Badge className="border text-xs bg-blue-500/20 text-blue-400 border-blue-500/30">
                    <Loader className="w-3 h-3 mr-1 animate-spin" />
                    Procesando
                  </Badge>
                ) : (
                  <Badge className="border text-xs bg-red-500/20 text-red-400 border-red-500/30">Error</Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lista de analizadas */}
      {analyzedAppointments.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">
            Aún no hay llamadas analizadas. Añade el enlace de Drive de una llamada en su detalle y pulsa Analizar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {analyzedAppointments.map((appt) => (
            <div key={appt.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{appt.contacts?.full_name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(appt.appointment_datetime)}</p>
                </div>
                {appt.ai_suggested_stage && (
                  <Badge className="border text-xs bg-brand-500/20 text-brand-400 border-brand-500/30">
                    {appt.ai_suggested_stage}
                  </Badge>
                )}
              </div>

              <div className="flex gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Nota llamada</p>
                  <p className="text-sm font-semibold text-foreground">
                    {appt.ai_call_score !== null && appt.ai_call_score !== undefined ? `${appt.ai_call_score}/10` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nota lead</p>
                  <p className="text-sm font-semibold text-foreground">
                    {appt.ai_lead_score !== null && appt.ai_lead_score !== undefined ? `${appt.ai_lead_score}/10` : '—'}
                  </p>
                </div>
              </div>

              {appt.ai_summary && <p className="text-sm text-muted-foreground line-clamp-3">{appt.ai_summary}</p>}

              <Button
                variant="outline"
                size="sm"
                className="border-border text-foreground"
                onClick={() => onSelectAppointment(appt)}
              >
                Ver detalle
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
