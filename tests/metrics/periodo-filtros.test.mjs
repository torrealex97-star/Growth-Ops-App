import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  PERIOD_LABELS,
  PERIOD_PRESETS_BAR,
  PERIOD_PRESETS_DASHBOARD,
  PERIOD_PRESETS_STANDARD,
  getPeriodRange,
  getPreviousPeriodRange,
  inPeriod,
  periodFileTag,
} from '../../lib/filters/period.ts'
import { nextSearchParams, readEnum } from '../../lib/filters/url-state.ts'

const dias = (r) => Math.round((r.to.getTime() - r.from.getTime() + 1) / 86_400_000)
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

test('el brief pide estos presets y todos tienen etiqueta', () => {
  for (const p of ['7d', '30d', '90d', 'ytd', 'launch', 'custom']) {
    assert.ok(PERIOD_PRESETS_DASHBOARD.includes(p), `falta el preset ${p}`)
    assert.ok(PERIOD_LABELS[p], `falta la etiqueta de ${p}`)
  }
})

test('las ventanas móviles duran exactamente lo que dice su nombre y acaban hoy', () => {
  // Un "últimos 7 días" que contara 7 hacia atrás Y ADEMÁS hoy daría ocho días de datos bajo una
  // etiqueta que dice siete: el error clásico al comparar periodos.
  for (const [preset, esperados] of [
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
  ]) {
    const r = getPeriodRange(preset, '', '')
    assert.equal(dias(r), esperados, `${preset} debería cubrir ${esperados} días`)
    assert.equal(ymd(r.to), ymd(new Date()), `${preset} debe terminar hoy`)
  }
})

test('ytd va del 1 de enero a HOY, no al 31 de diciembre', () => {
  const hoy = new Date()
  const r = getPeriodRange('ytd', '', '')
  assert.equal(ymd(r.from), `${hoy.getFullYear()}-01-01`)
  assert.equal(ymd(r.to), ymd(hoy))
  // Y por eso no es lo mismo que 'year': ese llega a diciembre, así que su duración incluye meses
  // que aún no han pasado y el periodo anterior comparativo sale mal.
  const año = getPeriodRange('year', '', '')
  assert.equal(ymd(año.to), `${hoy.getFullYear()}-12-31`)
  assert.ok(r.to <= año.to)
})

test('desde el lanzamiento respeta la fecha real de arranque, y sin ella no la inventa', () => {
  const con = getPeriodRange('launch', '', '', { launchDate: '2025-03-15' })
  assert.equal(ymd(con.from), '2025-03-15')
  assert.equal(ymd(con.to), ymd(new Date()))
  // Sin fecha conocida: sin límite inferior (todo lo disponible). Inventarse un arranque sería peor.
  const sin = getPeriodRange('launch', '', '')
  assert.equal(sin.from, null)
  // Una fecha ilegible se trata como desconocida, no como 1970.
  assert.equal(getPeriodRange('launch', '', '', { launchDate: 'no-es-fecha' }).from, null)
  assert.equal(periodFileTag('launch', '', ''), 'desde_lanzamiento')
})

test('el periodo anterior de una ventana móvil tiene la misma duración y no se solapa', () => {
  const actual = getPeriodRange('30d', '', '')
  const previo = getPreviousPeriodRange(actual)
  assert.equal(dias(previo), dias(actual))
  assert.ok(previo.to < actual.from, 'el periodo anterior no puede solaparse con el actual')
  // Y un día del periodo previo no cuenta como del actual: es lo que hace comparables las cifras.
  assert.equal(inPeriod(previo.from, actual), false)
  assert.equal(inPeriod(actual.from, actual), true)
})

test('un mismo rango filtra igual venga de donde venga (KPIs, charts, tabla, funnel)', () => {
  // §5 y §39: si la pantalla entera deriva del MISMO rango, el mismo dato cae dentro o fuera para
  // todos los paneles. Esto fija esa propiedad sobre el helper compartido.
  const r = getPeriodRange('7d', '', '')
  const dentro = new Date(r.to.getTime() - 86_400_000)
  const fuera = new Date(r.from.getTime() - 86_400_000)
  for (const valor of [dentro, ymd(dentro)]) assert.equal(inPeriod(valor, r), true)
  for (const valor of [fuera, ymd(fuera)]) assert.equal(inPeriod(valor, r), false)
})

test('los filtros viajan en la URL y los valores por defecto no la ensucian', () => {
  const porDefecto = { period: '30d', account: 'all' }
  // Un filtro en su valor por defecto se borra del query: la URL limpia sigue limpia.
  assert.equal(nextSearchParams('', { period: '30d', account: 'all' }, porDefecto), '')
  assert.equal(nextSearchParams('', { period: '7d' }, porDefecto), 'period=7d')
  // Orden estable: dos pantallas con los mismos filtros dan la MISMA URL, y así el enlace compartido
  // es comparable.
  assert.equal(
    nextSearchParams('', { period: '7d', account: 'act_9', campaign: 'c1' }, porDefecto),
    nextSearchParams('', { campaign: 'c1', account: 'act_9', period: '7d' }, porDefecto)
  )
  assert.equal(nextSearchParams('period=7d', { period: null }, porDefecto), '')
  // Y quitar un filtro no arrastra los demás.
  assert.equal(nextSearchParams('period=7d&account=act_9', { account: '' }, porDefecto), 'period=7d')
})

test('un filtro inventado en la URL cae al predeterminado', () => {
  const permitidos = ['7d', '30d', '90d']
  assert.equal(readEnum('90d', permitidos, '30d'), '90d')
  // Alguien edita el enlace a mano: no dejamos la pantalla en un estado imposible.
  assert.equal(readEnum('; DROP TABLE', permitidos, '30d'), '30d')
  assert.equal(readEnum(null, permitidos, '30d'), '30d')
})

test('Campañas deriva TODA la pantalla del mismo rango y guarda los filtros en la URL', () => {
  const page = readFileSync(
    new URL('../../app/[tenant]/marketing/adquisicion/campanas/page.tsx', import.meta.url),
    'utf8'
  )
  // Un solo `range`, pasado a los paneles: si cada uno calculara el suyo podrían discrepar sin que
  // nada lo delate (§5, §39).
  assert.equal((page.match(/getPeriodRange\(/g) ?? []).length, 1, 'el rango debe calcularse en un solo sitio')
  // Los tres filtros del brief viajan en la URL (§6).
  assert.match(page, /useUrlFilters\(FILTROS_POR_DEFECTO\)/)
  for (const clave of ['period:', 'account:', 'campaign:']) {
    assert.ok(page.includes(clave), `falta ${clave} en el estado de URL`)
  }
  // Y se leen al arrancar, validados: un enlace editado a mano no deja la pantalla en un estado
  // imposible.
  assert.match(page, /readEnum\(urlFilters\.get\('period'\), PRESETS_VALIDOS, 'all'\)/)
  // "Desde el lanzamiento" usa la primera fecha con datos, no una inventada.
  assert.match(page, /launchDate/)
  assert.match(page, /getPeriodRange\(periodPreset, customFrom, customTo, \{ launchDate \}\)/)
  // Periodo, cuenta y campañas forman una sola superficie responsive; antes los dos últimos
  // quedaban fuera del panel y el botón de alta se cortaba a 400 px.
  assert.match(page, /<PeriodFilterBar[\s\S]*<select[\s\S]*<MultiSelect[\s\S]*<\/PeriodFilterBar>/)
  assert.match(page, /flex w-full flex-col items-stretch gap-2/)
  assert.match(page, /w-full shrink-0 items-center justify-center/)
})

test('el dashboard parte de 30 días y el gasto respeta las cuentas Meta activas', () => {
  const dashboard = readFileSync(new URL('../../app/[tenant]/dashboard/page.tsx', import.meta.url), 'utf8')
  const spendRoute = readFileSync(
    new URL('../../app/api/[tenant]/evergreen/meta/spend-range/route.ts', import.meta.url),
    'utf8'
  )

  assert.match(dashboard, /periodPreset: '30d'/)
  assert.match(dashboard, /const periodRevenue = useMemo/)
  assert.match(dashboard, /filteredSales\.filter\(isActiveSale\)/)
  assert.doesNotMatch(dashboard, /revenue=\{cur\.gross\}/)
  assert.match(spendRoute, /parseAccountIds\(cfg\.META_AD_ACCOUNT_ID\)/)
  assert.match(spendRoute, /q = q\.in\('account_id', activeAccountIds\)/)
  assert.match(spendRoute, /\['super_admin', 'admin', 'director'/)
})

test('la barra de periodo y las pantallas toman los presets del módulo canónico', () => {
  const bar = readFileSync(new URL('../../components/os/PeriodFilterBar.tsx', import.meta.url), 'utf8')
  // Listas explícitas y no Object.keys: una pantalla sin selector de día no debe ofrecer el preset
  // 'day', que sin ese selector deja el rango vacío. Añadir un preset sigue siendo un cambio en un
  // solo archivo.
  assert.match(bar, /\{PERIOD_PRESETS_BAR\.map\(\(p\) => \(/)
  for (const p of ['today', '3d', '7d', 'month', 'quarter', 'year', 'custom']) {
    assert.ok(PERIOD_PRESETS_BAR.includes(p), `la barra debe ofrecer ${p}`)
    assert.ok(PERIOD_LABELS[p], `falta la etiqueta de ${p}`)
  }
  assert.match(bar, /<DateRangeCalendarPopover/)
  assert.doesNotMatch(bar, /type="date"/, 'la barra global no debe volver a los inputs de fecha nativos')
})

test('el selector visual de rango mantiene selección, navegación y accesibilidad', () => {
  const calendar = readFileSync(new URL('../../components/ui/calendar-popover.tsx', import.meta.url), 'utf8')
  assert.match(calendar, /export function DateRangeCalendarPopover/)
  assert.match(calendar, /isWithinInterval/)
  assert.match(calendar, /Mes anterior/)
  assert.match(calendar, /Mes siguiente/)
  assert.match(calendar, /aria-pressed=/)
  assert.match(calendar, /hidden sm:block/, 'en móvil debe mostrar un mes, no dos calendarios apretados')
})

test('las vistas operativas reutilizan el mismo selector visual de rango', () => {
  const pantallas = [
    'app/[tenant]/crm/agendas/page.tsx',
    'app/[tenant]/crm/seguimiento/page.tsx',
    'app/[tenant]/ventas/registro/page.tsx',
    'app/[tenant]/ventas/pagos/page.tsx',
    'app/[tenant]/comisiones/page.tsx',
    'app/[tenant]/finanzas/cobros/cobros/page.tsx',
    'app/[tenant]/finanzas/cobros/devoluciones/page.tsx',
    'app/[tenant]/finanzas/gastos-facturas/gastos/page.tsx',
    'app/[tenant]/drops/page.tsx',
    'app/[tenant]/funnels/page.tsx',
    'app/[tenant]/audit/page.tsx',
  ]
  for (const rel of pantallas) {
    const page = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
    assert.match(page, /DateRangeCalendarPopover/, `${rel} no usa el selector visual compartido`)
  }
})

test('los filtros de un solo día también usan el calendario visual compartido', () => {
  for (const rel of ['components/kpi/KPIReportPanel.tsx', 'app/[tenant]/instagram/reels/page.tsx']) {
    const page = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
    assert.match(page, /CalendarPopover/, `${rel} no usa el calendario visual compartido`)
    assert.doesNotMatch(page, /type="date"/, `${rel} conserva un filtro de fecha nativo`)
  }
})

test('Instagram acota todas sus lecturas directas a la subcuenta y enseña el fallo de sync', () => {
  const page = readFileSync(new URL('../../app/[tenant]/instagram/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /useTenantId\(\)/)
  for (const table of [
    'ig_media',
    'ig_account_daily',
    'ig_audience',
    'ig_conversations_daily',
    'fb_media',
    'youtube_uploads',
    'integration_sync_runs',
  ]) {
    const query = new RegExp(`from\\('${table}'\\)[\\s\\S]{0,500}?\\.eq\\('tenant_id', tenantId\\)`)
    assert.match(page, query, `${table} no queda acotada al tenant activo`)
  }
  assert.match(page, /Instagram necesita atención/)
  assert.match(page, /lastSync\?\.error_message/)
})

test('las siete pantallas con métricas comparten el MISMO filtro de periodo', () => {
  // Cada una llevaba su copia del tipo, de las etiquetas y del cálculo — idénticas entre sí (1.890
  // caracteres calcados), sin ventanas móviles y condenadas a divergir en cuanto alguien tocara una.
  const pantallas = [
    'app/[tenant]/comisiones/page.tsx',
    'app/[tenant]/ventas/registro/page.tsx',
    'app/[tenant]/ventas/pagos/page.tsx',
    'app/[tenant]/finanzas/cobros/cobros/page.tsx',
    'app/[tenant]/finanzas/cobros/devoluciones/page.tsx',
    'app/[tenant]/drops/page.tsx',
  ]
  for (const rel of pantallas) {
    const page = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
    assert.ok(!/^type PeriodPreset = /m.test(page), `${rel} mantiene una copia del tipo`)
    assert.ok(!/^function getPeriodRange\(/m.test(page), `${rel} mantiene su propio cálculo de rango`)
    assert.match(page, /from '@\/lib\/filters\/period'/, `${rel} no importa el módulo canónico`)
    assert.match(page, /PERIOD_PRESETS_STANDARD\.map/, `${rel} no ofrece el juego estándar`)
  }
})

test('el juego estándar incluye los presets que pidió el usuario', () => {
  // "del día, últimos 3 días, últimos 7, mes, trimestre, año y custom".
  for (const p of ['today', '3d', '7d', 'month', 'quarter', 'year', 'custom']) {
    assert.ok(PERIOD_PRESETS_STANDARD.includes(p), `falta ${p} en el juego estándar`)
  }
  // Y 3d dura tres días, no dos ni cuatro.
  const r = getPeriodRange('3d', '', '')
  assert.equal(Math.round((r.to.getTime() - r.from.getTime() + 1) / 86400000), 3)
})
