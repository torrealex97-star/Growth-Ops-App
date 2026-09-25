import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  calcularAgregados,
  type Agregados,
  type FilaCampana,
  type FilaCita,
  type FilaCobro,
  type FilaContacto,
  type FilaVenta,
  type Periodo,
} from './agregados'
import { serieCashAcumulada, serieFacturacionAcumulada } from './series-negocio'
import type { PuntoSerie } from './prevision'

// LA MITAD DE I/O: leer las filas de una subcuenta y pasarlas al cálculo.
//
// Todo lo que decide números vive en agregados.ts, que es puro y está probado. Aquí solo hay lectura,
// y por eso este fichero es corto: si la aritmética estuviera aquí, no se podría probar sin base de datos.
//
// TRES COSAS QUE NO SON OPCIONALES:
//
// 1. `tenant_id` EN CADA CONSULTA. Muchas rutas usan service_role, que salta RLS, así que el filtro por
//    subcuenta no lo pone la base: lo pone esta línea. Un olvido aquí es una fuga entre clientes.
// 2. PAGINACIÓN. PostgREST devuelve como máximo 1.000 filas y NO avisa de que ha recortado. Una suma
//    sobre las primeras 1.000 da un número más pequeño que el real y con toda la pinta de ser correcto.
//    Con 559 citas hoy no se nota; con 5.000 sí, y en silencio.
// 3. UN ERROR DE LECTURA NO ES UN CERO. Si una consulta falla, se dice cuál y las métricas que dependen
//    de ella quedan sin valor. Devolver 0 € de facturación porque falló la red es el peor resultado
//    posible, porque nadie lo distingue de haber vendido cero.

export type ResultadoConsulta = {
  agregados: Agregados
  /** Qué fuentes no se pudieron leer. Vacío = todo bien. */
  fuentesConError: { fuente: string; error: string }[]
  /** Qué fuentes se leyeron recortadas por el tope de páginas: sus sumas pueden faltar datos. */
  fuentesRecortadas: string[]
  /** Cuántas filas se leyeron de cada fuente. Va al drill-down de "ver cálculo". */
  filasLeidas: Record<string, number>
  /**
   * Cuántos contactos del periodo tienen atribución conocida. Es un hueco, no una métrica, y va aparte
   * para que el panel pueda decirlo en vez de dejarlo invisible.
   */
  atribucion: { contactos: number; conAtribucion: number }
  /**
   * Las citas leídas, para poder medir la COBERTURA DEL MARCADO sin volver a la base. No se devuelven
   * las demás filas a propósito: de estas solo se usan estado y fecha, y arrastrar ventas o cobros
   * enteros hasta la ruta sería pasear datos financieros sin necesidad.
   */
  citas: FilaCita[]
  /**
   * Series diarias ACUMULADAS del periodo, para el objetivo/previsión de facturación y cash. No se
   * exponen las filas de ventas/cobros enteras (serían datos financieros paseados sin necesidad, ver
   * nota de arriba): solo el punto por día, ya reducido a lo que el gráfico necesita.
   */
  serieFacturacion: PuntoSerie[]
  serieCash: PuntoSerie[]
  /**
   * Suma de gastos categorizados como `cogs` en el periodo, para la aproximación de LTGP:CAC (ver
   * lib/metrics/ltgp-aproximado.ts). `null` si no se pudo leer la fuente, nunca 0 por defecto.
   */
  costeEntregaCogsPeriodo: number | null
}

/** Techo de páginas por fuente. 50 × 1.000 = 50.000 filas, suficiente y acotado. */
const MAX_PAGINAS = 50

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const r2 = (n: number) => Math.round(n * 100) / 100

export async function consultarMetricas(
  sb: SupabaseClient,
  tenantId: string,
  periodo: Periodo
): Promise<ResultadoConsulta> {
  // Las lecturas son independientes: en serie serían viajes de red encadenados por nada.
  const [ventas, cobros, citas, campanas, contactos, gastosCogs] = await Promise.all([
    fetchAllRows<FilaVenta & { payment_plans: { method: string | null } | { method: string | null }[] | null }>(
      () =>
        sb
          .from('sales')
          // payment_plans(method): para excluir reservas sin completar de ventas/clientes (una
          // reserva que solo pagó la seña no es cliente — ver esReservaAbierta en agregados.ts).
          .select(
            'sale_date, gross_amount, status, closer_id, appointment_id, reservation_completed_at, payment_plans(method)'
          )
          .eq('tenant_id', tenantId)
          .gte('sale_date', periodo.desde)
          .lte('sale_date', periodo.hasta),
      { maxPages: MAX_PAGINAS }
    ),
    fetchAllRows<FilaCobro>(
      () =>
        sb
          .from('collections')
          // `gross_amount`, no `amount`: comprobado contra el esquema. Con el nombre equivocado, el cash
          // collected sale 0 € sin que ninguna consulta falle.
          .select('collected_at, gross_amount, is_confirmed, status')
          .eq('tenant_id', tenantId)
          .gte('collected_at', `${periodo.desde}T00:00:00Z`)
          .lte('collected_at', `${periodo.hasta}T23:59:59Z`),
      { maxPages: MAX_PAGINAS }
    ),
    fetchAllRows<FilaCita>(
      () =>
        sb
          .from('appointments')
          // `raw_payload` es donde están las respuestas del formulario (473 de 559 citas en producción);
          // `qualification` está a 0 y se pide igual por si algún día se rellena.
          .select('appointment_datetime, status, result, offered, needs_followup, qualification, raw_payload')
          .eq('tenant_id', tenantId)
          .gte('appointment_datetime', `${periodo.desde}T00:00:00Z`)
          .lte('appointment_datetime', `${periodo.hasta}T23:59:59Z`),
      { maxPages: MAX_PAGINAS }
    ),
    fetchAllRows<FilaCampana>(
      () =>
        sb
          .from('campaign_daily')
          .select('date, spend, impressions, clicks, leads')
          .eq('tenant_id', tenantId)
          .gte('date', periodo.desde)
          .lte('date', periodo.hasta),
      { maxPages: MAX_PAGINAS }
    ),
    fetchAllRows<FilaContacto>(
      () =>
        // COALESCE(first_seen_at, created_at) dentro del rango, expresado con or(): first_seen_at
        // es la fecha real (GHL dateAdded) y created_at solo cuenta cuando no hay primera vista —
        // filtrar por created_at a secas contaba TODA la importación histórica como "del periodo".
        sb
          .from('contacts')
          .select('created_at, first_seen_at, first_contact_at')
          .eq('tenant_id', tenantId)
          .or(
            `first_seen_at.gte.${periodo.desde}T00:00:00Z,and(created_at.gte.${periodo.desde}T00:00:00Z,first_seen_at.is.null)`
          )
          .or(
            `first_seen_at.lte.${periodo.hasta}T23:59:59Z,and(created_at.lte.${periodo.hasta}T23:59:59Z,first_seen_at.is.null)`
          ),
      { maxPages: MAX_PAGINAS }
    ),
    // Solo la categoría 'cogs': es la que la app usa como coste de entrega (ver
    // app/[tenant]/finanzas/gastos-facturas/gastos/page.tsx). El resto de categorías (publicidad,
    // sueldos, comisiones...) no son coste de ENTREGAR lo vendido, y mezclarlas infla el margen a la baja
    // sin que signifique lo mismo que LTGP.
    fetchAllRows<{ amount: number | string | null }>(
      () =>
        sb
          .from('expenses')
          .select('amount')
          .eq('tenant_id', tenantId)
          .eq('category', 'cogs')
          .gte('expense_date', periodo.desde)
          .lte('expense_date', periodo.hasta),
      { maxPages: MAX_PAGINAS }
    ),
  ])

  // LA ATRIBUCIÓN, contada aparte. Comprobado en producción: `contact_attributions` está a 0 filas y
  // `contacts.campaign_id` a 0 de 956, porque los enlaces de reserva no llevan UTMs y los payloads no
  // traen nada que atribuir. Se cuenta con `head: true` —solo el número, sin traerse las filas— para que
  // el panel pueda decir "0 de N con origen conocido" en vez de enseñar métricas por canal vacías sin
  // explicar por qué.
  const [totalContactos, conAtribucion] = await Promise.all([
    sb.from('contacts').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    sb
      .from('contact_attributions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_primary', true),
  ])

  const fuentes = { ventas, cobros, citas, campanas, contactos, gastosCogs }
  const fuentesConError = Object.entries(fuentes)
    .filter(([, r]) => r.error !== null)
    .map(([fuente, r]) => ({ fuente, error: r.error as string }))
  const fuentesRecortadas = Object.entries(fuentes)
    .filter(([, r]) => r.truncated)
    .map(([fuente]) => fuente)

  // Un error de lectura no es un coste de cero: sin poder leer los gastos, el coste de entrega por
  // 'cogs' queda desconocido y la aproximación de LTGP:CAC cae al fallback manual (o al hueco).
  const costeEntregaCogsPeriodo = gastosCogs.error ? null : r2(gastosCogs.rows.reduce((a, g) => a + num(g.amount), 0))

  // El embed de payment_plans llega anidado (objeto o array según el driver); se aplana aquí para
  // que agregados.ts (puro, sin PostgREST) reciba el mismo `payment_plan_method` que ya usa
  // lib/commissions/tramos.ts para decidir si una reserva sigue abierta.
  const ventasNormalizadas: FilaVenta[] = ventas.rows.map((v) => {
    const pp = v.payment_plans
    const method = Array.isArray(pp) ? (pp[0]?.method ?? null) : (pp?.method ?? null)
    return { ...v, payment_plan_method: method }
  })

  return {
    // Las filas de una fuente que falló llegan vacías, y el cálculo ya distingue "vacío" de "cero"
    // devolviendo `null` con su motivo. Quien pinta debe mirar `fuentesConError` antes de creerse nada.
    agregados: calcularAgregados({
      ventas: ventasNormalizadas,
      cobros: cobros.rows,
      citas: citas.rows,
      campanas: campanas.rows,
      contactos: contactos.rows,
      periodo,
    }),
    fuentesConError,
    fuentesRecortadas,
    citas: citas.rows,
    serieFacturacion: serieFacturacionAcumulada(ventasNormalizadas, periodo),
    serieCash: serieCashAcumulada(cobros.rows, periodo),
    costeEntregaCogsPeriodo,
    atribucion: { contactos: totalContactos.count ?? 0, conAtribucion: conAtribucion.count ?? 0 },
    filasLeidas: {
      ventas: ventas.rows.length,
      cobros: cobros.rows.length,
      citas: citas.rows.length,
      campanas: campanas.rows.length,
      contactos: contactos.rows.length,
      gastosCogs: gastosCogs.rows.length,
    },
  }
}
