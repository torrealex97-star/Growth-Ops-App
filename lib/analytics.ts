// Agregaciones puras para el centro de mando (dashboard, ranking, atribución, objetivos).
// Sin I/O: reciben filas crudas de Supabase y devuelven datos listos para pintar.

export type SaleRow = {
  id: string
  gross_amount: number | string
  status: string
  sale_date: string | null
  closer_id: string | null
  setter_id: string | null
  contact_id: string | null
}
export type CollectionRow = {
  sale_id: string
  gross_amount: number | string
  collected_at: string | null
  status: string
}
export type AttributionRow = {
  contact_id: string
  source: string | null
  utm_source: string | null
  utm_campaign: string | null
  utm_content: string | null
  is_primary: boolean
}
export type AppointmentRow = {
  appointment_datetime: string | null
  status: string
  setter_id: string | null
  closer_id: string | null
  contact_id?: string | null
}
export type UserRow = { id: string; full_name: string; role?: string | null }

// Una venta cuenta para facturación si no está anulada/devuelta del todo.
export const ACTIVE_SALE_STATUSES = ['active', 'partial_refund']
export const isActiveSale = (s: { status: string }) => ACTIVE_SALE_STATUSES.includes(s.status)
const isCollected = (c: { status: string }) => c.status === 'collected'
const num = (x: number | string | null | undefined) => Number(x ?? 0)
const ymOf = (d: string | null | undefined) => (d ? String(d).slice(0, 7) : '') // 'YYYY-MM'
const dayOf = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : '') // 'YYYY-MM-DD'

const SOURCE_FALLBACK = 'Directo / Sin atribuir'
const labelSource = (a?: { source: string | null; utm_source: string | null }) =>
  a?.source || a?.utm_source || SOURCE_FALLBACK

// --- Meses ---
export function lastNMonths(n: number, refYm: string): string[] {
  const [y, m] = refYm.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
export function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

// --- KPIs de un mes concreto ---
export function monthlyKpis(sales: SaleRow[], collections: CollectionRow[], ym: string) {
  const monthSales = sales.filter((s) => isActiveSale(s) && ymOf(s.sale_date) === ym)
  const gross = monthSales.reduce((acc, s) => acc + num(s.gross_amount), 0)
  const count = monthSales.length
  const cash = collections
    .filter((c) => isCollected(c) && ymOf(c.collected_at) === ym)
    .reduce((acc, c) => acc + num(c.gross_amount), 0)
  return { gross, count, cash, avgTicket: count ? gross / count : 0 }
}

export function pctDelta(curr: number, prev: number): number | null {
  if (!prev) return null
  return ((curr - prev) / prev) * 100
}

// --- Series por mes (para gráficas) ---
export function revenueByMonth(sales: SaleRow[], months: string[]) {
  return months.map((ym) => ({
    date: monthLabel(ym),
    amount: sales
      .filter((s) => isActiveSale(s) && ymOf(s.sale_date) === ym)
      .reduce((acc, s) => acc + num(s.gross_amount), 0),
  }))
}
export function cashByMonth(collections: CollectionRow[], months: string[]) {
  return months.map((ym) => ({
    date: monthLabel(ym),
    amount: collections
      .filter((c) => isCollected(c) && ymOf(c.collected_at) === ym)
      .reduce((acc, c) => acc + num(c.gross_amount), 0),
  }))
}

// --- Ranking del equipo ---
export type RankRow = { userId: string; name: string; sales: number; gross: number; cash: number }
export function teamRanking(
  sales: SaleRow[],
  collections: CollectionRow[],
  users: UserRow[],
  role: 'closer' | 'setter'
): RankRow[] {
  const nameOf = new Map(users.map((u) => [u.id, u.full_name]))
  // Puesto real de cada usuario, para no contar en "Closers" a alguien que solo quedó asignado
  // como closer_id de una venta por dato suelto (setter que cerró puntualmente, admin, etc).
  const roleOf = new Map(users.map((u) => [u.id, u.role ?? null]))
  const knowsRoles = users.some((u) => u.role !== undefined)
  const saleOwner = new Map<string, string | null>() // sale_id -> userId del rol
  const agg = new Map<string, RankRow>()
  const ensure = (id: string) =>
    agg.get(id) ?? agg.set(id, { userId: id, name: nameOf.get(id) || 'Sin asignar', sales: 0, gross: 0, cash: 0 }).get(id)!

  for (const s of sales) {
    const owner = role === 'closer' ? s.closer_id : s.setter_id
    saleOwner.set(s.id, owner)
    if (!owner || !isActiveSale(s)) continue
    if (knowsRoles && roleOf.get(owner) !== role) continue
    const row = ensure(owner)
    row.sales += 1
    row.gross += num(s.gross_amount)
  }
  for (const c of collections) {
    if (!isCollected(c)) continue
    const owner = saleOwner.get(c.sale_id)
    if (!owner) continue
    if (knowsRoles && roleOf.get(owner) !== role) continue
    const row = ensure(owner)
    row.cash += num(c.gross_amount)
  }
  return Array.from(agg.values()).sort((a, b) => b.gross - a.gross)
}

// --- Atribución por fuente / anuncio ---
export type AttribRow = { source: string; leads: number; sales: number; gross: number; convRate: number }
export function attributionBySource(
  contactIds: string[],
  attributions: AttributionRow[],
  sales: SaleRow[]
): AttribRow[] {
  // fuente principal por contacto (is_primary si existe, si no la primera)
  const bySource = new Map<string, AttribRow>()
  const contactSource = new Map<string, string>()
  const primaryFirst = [...attributions].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  for (const a of primaryFirst) {
    if (!contactSource.has(a.contact_id)) contactSource.set(a.contact_id, labelSource(a))
  }
  const ensure = (src: string) =>
    bySource.get(src) ?? bySource.set(src, { source: src, leads: 0, sales: 0, gross: 0, convRate: 0 }).get(src)!

  for (const cid of contactIds) ensure(contactSource.get(cid) || SOURCE_FALLBACK).leads += 1
  for (const s of sales) {
    if (!isActiveSale(s) || !s.contact_id) continue
    const src = contactSource.get(s.contact_id) || SOURCE_FALLBACK
    const row = ensure(src)
    row.sales += 1
    row.gross += num(s.gross_amount)
  }
  bySource.forEach((row) => { row.convRate = row.leads ? (row.sales / row.leads) * 100 : 0 })
  return Array.from(bySource.values()).sort((a, b) => b.gross - a.gross)
}

// --- Agendas por setter (agendadas, shows, % show) ---
export type SetterAgendaRow = { userId: string; name: string; total: number; shows: number; noShows: number; showRate: number }
export function setterAgendaStats(appointments: AppointmentRow[], users: UserRow[]): SetterAgendaRow[] {
  const nameOf = new Map(users.map((u) => [u.id, u.full_name]))
  // Igual que en teamRanking: no contar como "setter" a alguien que solo quedó puesto como
  // setter_id de una agenda puntual (admin, cold_caller cubriendo, dato suelto) sin serlo
  // realmente (bug: "en closer/setter solo debe estar los registrados como tal, no más nadie").
  const roleOf = new Map(users.map((u) => [u.id, u.role ?? null]))
  const knowsRoles = users.some((u) => u.role !== undefined)
  const map = new Map<string, SetterAgendaRow>()
  for (const a of appointments) {
    if (!a.setter_id) continue
    if (knowsRoles && roleOf.get(a.setter_id) !== 'setter' && roleOf.get(a.setter_id) !== 'cold_caller') continue
    const row = map.get(a.setter_id) ?? map.set(a.setter_id, {
      userId: a.setter_id, name: nameOf.get(a.setter_id) || 'Sin asignar', total: 0, shows: 0, noShows: 0, showRate: 0,
    }).get(a.setter_id)!
    row.total += 1
    if (a.status === 'show') row.shows += 1
    if (a.status === 'no_show') row.noShows += 1
  }
  map.forEach((r) => { r.showRate = r.total ? (r.shows / r.total) * 100 : 0 })
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

// --- Embudo completo por fuente: lead → agenda → venta (para adscripción) ---
export type FunnelRow = {
  source: string; leads: number; appointments: number; sales: number; gross: number
  leadToAppt: number; apptToSale: number; leadToSale: number
}
export function funnelBySource(
  contactIds: string[],
  attributions: AttributionRow[],
  sales: SaleRow[],
  appointments: AppointmentRow[]
): FunnelRow[] {
  const contactSource = new Map<string, string>()
  const primaryFirst = [...attributions].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  for (const a of primaryFirst) if (!contactSource.has(a.contact_id)) contactSource.set(a.contact_id, labelSource(a))
  const srcOf = (cid?: string | null) => (cid && contactSource.get(cid)) || SOURCE_FALLBACK

  const map = new Map<string, FunnelRow>()
  const ensure = (s: string) =>
    map.get(s) ?? map.set(s, { source: s, leads: 0, appointments: 0, sales: 0, gross: 0, leadToAppt: 0, apptToSale: 0, leadToSale: 0 }).get(s)!

  for (const cid of contactIds) ensure(srcOf(cid)).leads += 1
  for (const a of appointments) ensure(srcOf(a.contact_id)).appointments += 1
  for (const s of sales) {
    if (!isActiveSale(s)) continue
    const row = ensure(srcOf(s.contact_id))
    row.sales += 1
    row.gross += num(s.gross_amount)
  }
  map.forEach((r) => {
    r.leadToAppt = r.leads ? (r.appointments / r.leads) * 100 : 0
    r.apptToSale = r.appointments ? (r.sales / r.appointments) * 100 : 0
    r.leadToSale = r.leads ? (r.sales / r.leads) * 100 : 0
  })
  return Array.from(map.values()).sort((a, b) => b.gross - a.gross)
}

// --- Progreso real de un objetivo ---
export type TargetLike = {
  metric_key: string
  scope_type: string
  scope_user_id: string | null
  period_start: string
  period_end: string
  // 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'. Define la unidad de la ventana móvil.
  period_type?: string | null
}

export type TargetData = { sales: SaleRow[]; collections: CollectionRow[]; appointments: AppointmentRow[] }
export type TargetWindow = { start: string; end: string; label: string }

// --- Utilidades de fecha sobre cadenas 'YYYY-MM-DD' (UTC, sin deriva de zona horaria) ---
const pad2 = (n: number) => String(n).padStart(2, '0')
const ymdStr = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
const parseYmd = (s: string) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))))
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_ES_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const dayLabel = (d: Date) => `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`

// Devuelve la ventana calendario (unidad) del tipo de periodo que contiene a `dayStr`.
export function targetUnitBounds(periodType: string | null | undefined, dayStr: string): TargetWindow {
  const d = parseYmd(dayStr)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (periodType) {
    case 'weekly': {
      const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay() // lunes = 1
      const start = new Date(d); start.setUTCDate(d.getUTCDate() - dow + 1)
      const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6)
      return { start: ymdStr(start), end: ymdStr(end), label: `${dayLabel(start)} – ${dayLabel(end)}` }
    }
    case 'monthly': {
      const start = new Date(Date.UTC(y, m, 1))
      const end = new Date(Date.UTC(y, m + 1, 0))
      return { start: ymdStr(start), end: ymdStr(end), label: `${MONTHS_ES_LONG[m]} ${y}` }
    }
    case 'quarterly': {
      const q = Math.floor(m / 3)
      const start = new Date(Date.UTC(y, q * 3, 1))
      const end = new Date(Date.UTC(y, q * 3 + 3, 0))
      return { start: ymdStr(start), end: ymdStr(end), label: `T${q + 1} ${y}` }
    }
    case 'annual': {
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) }
    }
    case 'daily':
    default:
      return { start: dayStr, end: dayStr, label: dayLabel(d) }
  }
}

// Ventana que corresponde a "ahora" (la unidad que contiene a `today`), acotada a la validez del objetivo.
// state: 'upcoming' (aún no empieza), 'active' (en curso), 'ended' (ya terminó su rango de validez).
export function targetCurrentWindow(
  t: TargetLike,
  today: string
): { window: TargetWindow; state: 'upcoming' | 'active' | 'ended' } {
  const pt = t.period_type || 'daily'
  if (today < t.period_start) return { window: targetUnitBounds(pt, t.period_start), state: 'upcoming' }
  if (today > t.period_end) return { window: targetUnitBounds(pt, t.period_end), state: 'ended' }
  return { window: targetUnitBounds(pt, today), state: 'active' }
}

// Todas las ventanas (unidades) del objetivo desde period_start hasta period_end. Para el historial.
export function targetWindows(t: TargetLike): TargetWindow[] {
  const pt = t.period_type || 'daily'
  const wins: TargetWindow[] = []
  let cursor = t.period_start
  let guard = 0
  while (cursor <= t.period_end && guard < 800) {
    const w = targetUnitBounds(pt, cursor)
    wins.push(w)
    const next = parseYmd(w.end); next.setUTCDate(next.getUTCDate() + 1)
    cursor = ymdStr(next)
    guard++
  }
  return wins
}

// Valor de la métrica del objetivo dentro de una ventana [start, end] concreta.
export function targetValueBetween(t: TargetLike, data: TargetData, start: string, end: string): number {
  const inWindow = (d: string | null | undefined) => {
    const day = dayOf(d)
    return !!day && day >= start && day <= end
  }
  const uid = t.scope_user_id
  const userScope = t.scope_type === 'user' && uid
  const matchCloser = (s: SaleRow) => !userScope || s.closer_id === uid
  const matchSetterAppt = (a: AppointmentRow) => !userScope || a.setter_id === uid

  const periodSales = data.sales.filter((s) => isActiveSale(s) && inWindow(s.sale_date) && matchCloser(s))
  const saleIds = new Set(periodSales.map((s) => s.id))

  switch (t.metric_key) {
    case 'revenue':
      return periodSales.reduce((a, s) => a + num(s.gross_amount), 0)
    case 'sales_count':
      return periodSales.length
    case 'cash_collected': {
      const ownerSale = new Map(data.sales.map((s) => [s.id, s]))
      return data.collections
        .filter((c) => c.status === 'collected' && inWindow(c.collected_at))
        .filter((c) => !userScope || ownerSale.get(c.sale_id)?.closer_id === uid)
        .reduce((a, c) => a + num(c.gross_amount), 0)
    }
    case 'appointments_set':
      return data.appointments.filter((a) => inWindow(a.appointment_datetime) && matchSetterAppt(a)).length
    case 'shows':
      return data.appointments.filter(
        (a) => a.status === 'show' && inWindow(a.appointment_datetime) && matchSetterAppt(a)
      ).length
    case 'conversion_rate': {
      const appts = data.appointments.filter((a) => inWindow(a.appointment_datetime) && matchSetterAppt(a)).length
      return appts ? (saleIds.size / appts) * 100 : 0
    }
    default:
      return 0
  }
}

// Progreso "ahora": valor acumulado dentro de la ventana móvil vigente (hoy / esta semana / este mes…).
// `today` en formato 'YYYY-MM-DD'. Si se omite, evalúa todo el rango de validez (comportamiento antiguo).
export function targetCurrentValue(t: TargetLike, data: TargetData, today?: string): number {
  if (!today) return targetValueBetween(t, data, t.period_start, t.period_end)
  const { window } = targetCurrentWindow(t, today)
  return targetValueBetween(t, data, window.start, window.end)
}

// Historial: cada unidad de periodo con su valor, objetivo, y si se cumplió.
// Las ventanas futuras (start > today) quedan como 'pending'.
export function targetHistory(
  t: TargetLike & { target_value: number | string },
  data: TargetData,
  today: string
): { window: TargetWindow; value: number; goal: number; met: boolean; status: 'met' | 'missed' | 'current' | 'pending' }[] {
  const goal = num(t.target_value)
  return targetWindows(t).map((window) => {
    const value = targetValueBetween(t, data, window.start, window.end)
    const met = goal > 0 && value >= goal
    let status: 'met' | 'missed' | 'current' | 'pending'
    if (today >= window.start && today <= window.end) status = 'current'
    else if (window.start > today) status = 'pending'
    else status = met ? 'met' : 'missed'
    return { window, value, goal, met, status }
  })
}
