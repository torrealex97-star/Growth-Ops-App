'use client'

// DASHBOARD DEL COLABORADOR (§23-25) — un MODO del dashboard real, no un portal aparte (§16).
//
// Cuando el usuario logueado tiene un collaborator_profiles ACTIVO en esta subcuenta,
// DashboardPage hace early-return a ESTE componente: mismo login, misma ruta, mismos
// componentes (KPICard, PeriodFilterBar) y cero selectores de rol/persona ni widgets
// de empresa (§51) — solo SUS datos.
//
// Reutilización estricta (nada de fórmulas nuevas):
//   · Filtro de periodo GLOBAL: PeriodFilterBar + getPeriodRange/inPeriod (default 'Este mes', §25).
//   · Definiciones canónicas de métrica: isActiveSale (lib/analytics), isAttended/isNoShow
//     (lib/appointments/status), vocabulario pending/approved/liquidated de comisiones.
//   · SCOPE de datos (§55-57): contactIdsDeScope acota contacts→appointments→sales; las
//     comisiones van por user_id (SU ledger). Fail-closed: sin contactos, todo a cero.
//
// Patrón de carga: se leen UNA VEZ las filas del scope (RLS ya escopa por tenant) y el
// filtro de periodo se aplica en memoria — cambiar de periodo no dispara refetch.

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import {
  DEFAULT_PERIOD,
  getPeriodRange,
  getPreviousPeriodRange,
  inPeriod,
  type PeriodPreset,
} from '@/lib/filters/period'
import { isActiveSale } from '@/lib/analytics'
import { isAttended, isNoShow } from '@/lib/appointments/status'
import { KPICard } from '@/components/os/DashboardKPICard'
import { contactIdsDeScope, type ScopeColaborador } from '@/lib/collaborators/scope'
import { useTenant, useTenantId, type SesionTenant } from '@/lib/tenant-context'
import { Users, CalendarCheck, PhoneCall, Trophy, Euro, Clock, BadgeCheck, Banknote } from 'lucide-react'

type ContactoRow = { id: string; full_name: string | null; lead_status: string | null; created_at: string | null }
type CitaRow = {
  id: string
  contact_id: string | null
  appointment_datetime: string | null
  status: string | null
  qualification: Record<string, unknown> | null
}
type VentaRow = {
  id: string
  contact_id: string | null
  gross_amount: number | string | null
  status: string | null
  created_at: string | null
}
type ComisionRow = {
  id: string
  status: string | null
  commission_amount: number | null
  created_at: string | null
  liquidation_month: string | null
}
type FilaFutura = { installmentId: string; amount: number | string; dueDate: string; source: string }

type Actividad = {
  id: string
  tipo: 'contacto' | 'cita' | 'venta'
  titulo: string
  fecha: string | null
  detalle: string
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)
const eur = (n: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const TIPO_STYLE: Record<Actividad['tipo'], string> = {
  contacto: 'bg-sky-500/10 text-sky-400',
  cita: 'bg-brand-400/15 text-brand-300',
  venta: 'bg-emerald-500/10 text-emerald-400',
}

export default function ColaboradorDashboard({
  sesion,
  scope,
}: {
  sesion: SesionTenant
  scope: Extract<ScopeColaborador, { tipo: 'collaborator' }>
}) {
  const tenantId = useTenantId()
  const tenant = useTenant()
  const sb = useMemo(() => createClient(), [])

  // Filtro de periodo GLOBAL (§25): mismos presets y custom que el resto de la app.
  const [preset, setPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const [contactos, setContactos] = useState<ContactoRow[]>([])
  const [citas, setCitas] = useState<CitaRow[]>([])
  const [ventas, setVentas] = useState<VentaRow[]>([])
  const [comisiones, setComisiones] = useState<ComisionRow[]>([])
  const [futuras, setFuturas] = useState<FilaFutura[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UNA carga por scope; el periodo filtra en memoria (ver cabecera).
  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    ;(async () => {
      // Scope del colaborador, fail-closed: [] si aún no tiene nadie atribuido.
      const contactIds = await contactIdsDeScope(sb, tenantId, scope)
      if (!vivo) return
      if (!contactIds || contactIds.length === 0) {
        setContactos([])
        setCitas([])
        setVentas([])
        setComisiones([])
        setCargando(false)
        return
      }

      // Citas y ventas de SUS contactos; su bolsa de comisiones por user_id (§24-25).
      const [resC, resA, resV, resCom] = await Promise.all([
        sb
          .from('contacts')
          .select('id, full_name, lead_status, created_at')
          .eq('tenant_id', tenantId)
          .in('id', contactIds),
        sb
          .from('appointments')
          .select('id, contact_id, appointment_datetime, status, qualification')
          .eq('tenant_id', tenantId)
          .in('contact_id', contactIds),
        sb
          .from('sales')
          .select('id, contact_id, gross_amount, status, created_at')
          .eq('tenant_id', tenantId)
          .in('contact_id', contactIds),
        // Ledger del propio colaborador: participant_type='collaborator' sale de esta query.
        sb
          .from('commissions')
          .select('id, status, commission_amount, created_at, liquidation_month')
          .eq('tenant_id', tenantId)
          .eq('user_id', sesion.userId),
      ])

      if (!vivo) return
      const primerError = resC.error || resA.error || resV.error || resCom.error
      if (primerError) {
        setError(primerError.message)
        setCargando(false)
        return
      }
      setContactos((resC.data ?? []) as ContactoRow[])
      setCitas((resA.data ?? []) as CitaRow[])
      setVentas((resV.data ?? []) as VentaRow[])
      setComisiones((resCom.data ?? []) as ComisionRow[])
      setCargando(false)

      // COBROS (§25): qué tiene por cobrar (cuotas pendientes/vencidas de SUS
      // ventas). La ruta /commissions/future ya filtra SU lane y su scope; de
      // ahí salen la proyección del próximo mes y los impagos (overdue).
      try {
        const resF = await fetch(`/api/${tenant}/evergreen/commissions/future`)
        if (resF.ok) {
          const data = (await resF.json()) as { rows?: FilaFutura[] }
          if (vivo) setFuturas(data.rows ?? [])
        }
      } catch {
        // La proyección es accesoría: un fallo no tumba el dashboard.
      }
    })()
    return () => {
      vivo = false
    }
  }, [sb, tenantId, tenant, scope, sesion.userId])

  const rango = useMemo(() => getPeriodRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  const rangoPrevio = useMemo(() => getPreviousPeriodRange(rango), [rango])

  // KPIs del periodo (§23-24) con las definiciones canónicas — sin fórmulas locales nuevas.
  const kpi = useMemo(() => {
    const contactosP = contactos.filter((c) => inPeriod(c.created_at, rango))
    const citasP = citas.filter((c) => inPeriod(c.appointment_datetime, rango))
    const asistidasP = citasP.filter((c) => isAttended(c.status))
    const noShowP = citasP.filter((c) => isNoShow(c.status))
    const ventasActivasP = ventas.filter(
      (v) => isActiveSale({ status: v.status ?? '' }) && inPeriod(v.created_at, rango)
    )
    const revenueP = ventasActivasP.reduce((acc, v) => acc + num(v.gross_amount), 0)
    const comisionesP = comisiones.filter((c) => c.status !== 'cancelled' && inPeriod(c.created_at, rango))
    const comisionesPrevias = comisiones.filter((c) => c.status !== 'cancelled' && inPeriod(c.created_at, rangoPrevio))
    const generadasP = comisionesP.reduce((acc, c) => acc + num(c.commission_amount), 0)
    const generadasPrev = comisionesPrevias.reduce((acc, c) => acc + num(c.commission_amount), 0)
    return {
      contactos: contactosP.length,
      citas: citasP.length,
      asistidas: asistidasP.length,
      noShow: noShowP.length,
      ventas: ventasActivasP.length,
      revenue: revenueP,
      comisionesGeneradas: generadasP,
      comisionesPendientes: comisionesP
        .filter((c) => c.status === 'pending')
        .reduce((acc, c) => acc + num(c.commission_amount), 0),
      comisionesAprobadas: comisionesP
        .filter((c) => c.status === 'approved')
        .reduce((acc, c) => acc + num(c.commission_amount), 0),
      comisionesLiquidadas: comisionesP
        .filter((c) => c.status === 'liquidated')
        .reduce((acc, c) => acc + num(c.commission_amount), 0),
      deltaComisiones: generadasPrev > 0 ? Math.round(((generadasP - generadasPrev) / generadasPrev) * 100) : undefined,
    }
  }, [contactos, citas, ventas, comisiones, rango, rangoPrevio])

  // COBROS (§25): el resumen de su dinero. Regla dura del propietario: TODO es
  // sobre cash COLECTADO — nadie comisiona sobre lo que no se ha cobrado. Las
  // comisiones del ledger nacen SIEMPRE de cobros 'collected' (motor), así que:
  //   · Cobrado     = liquidadas (pagadas).
  //   · Pendiente   = generadas sobre cash ya colectado, por aprobar/pagar.
  //   · A percibir  = las de mes de liquidación el MES QUE VIENE (cash ya
  //                   colectado; se pagan con la liquidación del mes siguiente).
  //   · Impagos     = cuotas VENCIDAS sin cobrar de sus ventas (proyección de
  //                   commissions/future, SU lane). NO es dinero ganado: es lo
  //                   que puede llegar a ganar si esos leads pagan — visible
  //                   aparte, nunca mezclado con lo ya colectado.
  const cobros = useMemo(() => {
    const noCanceladas = comisiones.filter((c) => c.status !== 'cancelled')
    const cobrado = noCanceladas
      .filter((c) => c.status === 'liquidated')
      .reduce((acc, c) => acc + num(c.commission_amount), 0)
    const pendiente = noCanceladas
      .filter((c) => c.status === 'pending' || c.status === 'approved')
      .reduce((acc, c) => acc + num(c.commission_amount), 0)

    // Mes de liquidación del mes que viene (convención única del ledger: día 1,
    // formato YYYY-MM-01). El cash colectado ESTE mes lleva liquidation_month del
    // mes que viene → es lo que le pagarán el mes próximo.
    const proximo = new Date()
    proximo.setMonth(proximo.getMonth() + 1, 1)
    const mesProximoISO = proximo.toISOString().slice(0, 10)
    const aPercibirProximo = noCanceladas
      .filter((c) => (c.liquidation_month ?? '').slice(0, 10) === mesProximoISO)
      .reduce((acc, c) => acc + num(c.commission_amount), 0)

    const importe = (f: FilaFutura) => num(f.amount)
    const ahora = new Date()
    const impagos = futuras
      .filter((f) => f.source === 'installment' && new Date(f.dueDate).getTime() < ahora.getTime())
      .reduce((acc, f) => acc + importe(f), 0)
    return { cobrado, pendiente, aPercibirProximo, impagos }
  }, [comisiones, futuras])

  // CUALIFICACIÓN (§23): lo que respondieron SUS leads en el formulario de agendar
  // (appointments.qualification, escrito por el webhook de GHL/Calendly), agregado
  // por pregunta — así sabe CÓMO de cualificados llegan, no solo cuántos.
  const cualificacionAgregada = useMemo(() => {
    const porPregunta = new Map<string, Map<string, number>>()
    for (const c of citas) {
      const respuestas = c.qualification?.respuestas
      if (!Array.isArray(respuestas)) continue
      for (const { q, a } of respuestas as { q?: string; a?: string }[]) {
        if (!q) continue
        const opciones = porPregunta.get(String(q)) ?? new Map<string, number>()
        const respuesta = (a ?? '').trim() || '(sin respuesta)'
        opciones.set(respuesta, (opciones.get(respuesta) ?? 0) + 1)
        porPregunta.set(String(q), opciones)
      }
    }
    return [...porPregunta.entries()]
      .map(([pregunta, opciones]) => ({
        pregunta,
        total: [...opciones.values()].reduce((acc, n) => acc + n, 0),
        opciones: [...opciones.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5),
      }))
      .sort((x, y) => y.total - x.total)
      .slice(0, 6)
  }, [citas])

  // Embudo §24: conversiones entre etapas canónicas (ratios de KPIs ya definidos).
  const embudo = useMemo(() => {
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
    return {
      citaSobreContacto: pct(kpi.citas, kpi.contactos),
      asistenciaSobreCita: pct(kpi.asistidas, kpi.citas),
      ventaSobreAsistencia: pct(kpi.ventas, kpi.asistidas),
    }
  }, [kpi])

  // Actividad reciente del scope (fuera del filtro de periodo: lo último, siempre).
  const actividad = useMemo<Actividad[]>(() => {
    const nombreDe = new Map(contactos.map((c) => [c.id, c.full_name || 'Contacto']))
    const eventos: Actividad[] = [
      ...contactos.map((c) => ({
        id: `c-${c.id}`,
        tipo: 'contacto' as const,
        titulo: c.full_name || 'Contacto',
        fecha: c.created_at,
        detalle: c.lead_status || 'Nuevo contacto',
      })),
      ...citas
        .slice()
        .sort((a, b) => ((a.appointment_datetime ?? '') < (b.appointment_datetime ?? '') ? 1 : -1))
        .slice(0, 10)
        .map((c) => ({
          id: `a-${c.id}`,
          tipo: 'cita' as const,
          titulo: nombreDe.get(c.contact_id ?? '') ?? 'Cita',
          fecha: c.appointment_datetime,
          detalle: c.status || 'Programada',
        })),
      ...ventas
        .filter((v) => isActiveSale({ status: v.status ?? '' }))
        .sort((a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1))
        .slice(0, 10)
        .map((v) => ({
          id: `v-${v.id}`,
          tipo: 'venta' as const,
          titulo: nombreDe.get(v.contact_id ?? '') ?? 'Venta',
          fecha: v.created_at,
          detalle: eur(num(v.gross_amount)),
        })),
    ]
    return eventos.sort((a, b) => ((a.fecha ?? '') < (b.fecha ?? '') ? 1 : -1)).slice(0, 12)
  }, [contactos, citas, ventas])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Mi actividad</h1>
          <p className="text-sm text-muted-foreground">
            Tus contactos, citas, ventas y comisiones · código {scope.code}
          </p>
        </div>
        <PeriodFilterBar
          preset={preset}
          onPresetChange={setPreset}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">
          No se pudieron cargar tus datos: {error}
        </div>
      )}

      {contactos.length === 0 && !cargando && !error && (
        <div className="dashboard-card p-8 text-center">
          <p className="font-medium text-foreground">Aún no tienes contactos atribuidos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Comparte tu código <span className="font-mono text-brand-300">{scope.code}</span>: todo contacto que llegue
            con él aparecerá aquí automáticamente.
          </p>
        </div>
      )}

      {/* §23-24: embudo del colaborador — contactos → citas → asistencia → venta */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Contactos nuevos"
          value={kpi.contactos}
          icon={Users}
          loading={cargando}
          description="Atribuidos a ti en el periodo"
        />
        <KPICard
          title="Citas"
          value={kpi.citas}
          icon={CalendarCheck}
          loading={cargando}
          description={`${kpi.asistidas} asistidas · ${embudo.citaSobreContacto}% de contactos`}
        />
        <KPICard
          title="Asistencia"
          value={kpi.asistidas}
          icon={PhoneCall}
          loading={cargando}
          description={`${embudo.asistenciaSobreCita}% de citas · ${kpi.noShow} no asistieron · ${kpi.citas - kpi.asistidas - kpi.noShow} canceladas`}
        />
        <KPICard
          title="Ventas"
          value={kpi.ventas}
          icon={Trophy}
          loading={cargando}
          description={`${eur(kpi.revenue)} · ${embudo.ventaSobreAsistencia}% de asistidas`}
        />
      </section>

      {/* §25: su bolsa de comisiones con el vocabulario canónico de estados */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Comisiones generadas"
          value={eur(kpi.comisionesGeneradas)}
          icon={Euro}
          loading={cargando}
          delta={kpi.deltaComisiones}
          deltaType={kpi.deltaComisiones === undefined ? 'neutral' : kpi.deltaComisiones >= 0 ? 'up' : 'down'}
          compareLabel={kpi.deltaComisiones === undefined ? 'Sin datos del periodo anterior' : 'vs periodo anterior'}
        />
        <KPICard
          title="Pendientes"
          value={eur(kpi.comisionesPendientes)}
          icon={Clock}
          loading={cargando}
          description="Esperando aprobación"
        />
        <KPICard
          title="Aprobadas"
          value={eur(kpi.comisionesAprobadas)}
          icon={BadgeCheck}
          loading={cargando}
          description="Listas para liquidar"
        />
        <KPICard
          title="Liquidadas"
          value={eur(kpi.comisionesLiquidadas)}
          icon={Banknote}
          loading={cargando}
          description="Pagadas"
        />
      </section>

      {/* §25 COBROS: lo cobrado, lo pendiente y lo que viene (impagos aparte) */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Cobrado"
          value={eur(cobros.cobrado)}
          icon={Banknote}
          loading={cargando}
          description="Comisiones ya pagadas (hasta agosto)"
        />
        <KPICard
          title="Pendiente de liquidación"
          value={eur(cobros.pendiente)}
          icon={Clock}
          loading={cargando}
          description="Ganado desde septiembre, por aprobar y pagar"
        />
        <KPICard
          title="A percibir el mes que viene"
          value={eur(cobros.aPercibirProximo)}
          icon={CalendarCheck}
          loading={cargando}
          description="Cash ya colectado que liquida el mes próximo"
        />
        <KPICard
          title="Impagos de tus leads"
          value={eur(cobros.impagos)}
          icon={Euro}
          loading={cargando}
          description="Cuotas vencidas sin cobrar — comisión proyectada"
        />
      </section>

      {/* CUALIFICACIÓN: respuestas de SUS leads al formulario de agendar */}
      {cualificacionAgregada.length > 0 && (
        <section className="dashboard-card">
          <h2 className="text-sm font-medium text-muted-foreground mb-1">Cualificación de tus leads</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Lo que respondieron al formulario de agendar — cómo de cualificados llegan
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {cualificacionAgregada.map(({ pregunta, total, opciones }) => (
              <div key={pregunta}>
                <div className="text-xs font-medium text-foreground mb-1.5">
                  {pregunta} <span className="text-muted-foreground">({total})</span>
                </div>
                {opciones.map(([respuesta, n]) => (
                  <div key={respuesta} className="flex items-center gap-2 text-xs mb-1">
                    <div
                      className="h-1.5 rounded bg-brand-400/50"
                      style={{ width: `${Math.max(6, (n / total) * 90)}px` }}
                    />
                    <span className="text-muted-foreground truncate">{respuesta}</span>
                    <span className="text-foreground font-medium">{n}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-card">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Actividad reciente</h2>
        {!cargando && actividad.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad todavía.</p>
        ) : (
          <ul className="divide-y divide-border">
            {actividad.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`inline-flex w-20 shrink-0 justify-center rounded px-1.5 py-0.5 text-[11px] font-medium ${TIPO_STYLE[a.tipo]}`}
                  >
                    {a.tipo}
                  </span>
                  <span className="truncate text-foreground">{a.titulo}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span>{a.detalle}</span>
                  {a.fecha && (
                    <span>{new Date(a.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
