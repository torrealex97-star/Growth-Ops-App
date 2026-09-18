// TARGET vs ACTUAL (spec §27-§29 del dashboard global)
//
// Los targets NO viven en el código: viven en la tabla `targets` (scope company, editados desde
// Formularios KPI › Objetivos del dashboard). Este módulo solo decide CÓMO se comparan:
//
//   · estado:  verde (objetivo cumplido) · ámbar (cerca, dentro del margen) · rojo (por debajo)
//   · gap:     actual − target, con su signo — el número que dice CUÁNTO falta o sobra
//   · dirección: la mayoría de métricas mejoran subiendo (revenue, MER, LTV:CAC…), pero otras
//     mejoran BAJANDO (CAC, CPL…). Comparar un CAC de 900 € contra su target con la regla
//     "más es mejor" pintaría en rojo justo el CAC más rentable — por eso la dirección es
//     parte del catálogo, no una decisión de cada pantalla.
//
// REGLA 0 ≠ NULL (§39 del registro source-of-truth): sin target configurado NO hay comparación
// (sin_target — la card se muestra limpia, nunca un falso "0% del objetivo"). Y un actual no
// calculable (ad spend a cero, denominador vacío) es sin_dato: '—', no un gap inventado.

/** ¿Mejora subir o bajar? Parte del catálogo, no de cada pantalla. */
export type DireccionObjetivo = 'mayor_mejor' | 'menor_mejor'

/** Formato del valor: para que el editor y las cards pinten el mismo número igual. */
export type TipoFormato = 'money' | 'count' | 'ratio'

export type EstadoObjetivo = 'verde' | 'ambar' | 'rojo' | 'sin_target' | 'sin_dato'

export type ObjetivoVsActual = {
  estado: EstadoObjetivo
  /** actual − target. null cuando no hay comparación posible. */
  gap: number | null
  /** actual / target × 100. null sin comparación o target 0 (dividir por 0 no informa). */
  porcentaje: number | null
}

// Margen "cerca del objetivo": el 10% clásico de gestión. Con actual ≥ 90% del target hay
// información suficiente para distinguir "casi" de "mal", y ese matiz es el que pinta el ámbar.
const MARGEN_AMBAR = 0.9

/**
 * Compara un valor actual contra su objetivo. Función PURA: la misma entrada, el mismo color —
 * dos pantallas que comparen lo mismo nunca discreparán.
 */
export function evaluaTarget(
  actual: number | null | undefined,
  target: number | null | undefined,
  direccion: DireccionObjetivo = 'mayor_mejor'
): ObjetivoVsActual {
  if (target == null || !Number.isFinite(target)) return { estado: 'sin_target', gap: null, porcentaje: null }
  if (actual == null || !Number.isFinite(actual)) return { estado: 'sin_dato', gap: null, porcentaje: null }

  const gap = actual - target
  // Un target de 0 no define escala: 100% de 0 no informa nada. No se divide por 0.
  const porcentaje = target !== 0 ? (actual / target) * 100 : null

  const cumple = direccion === 'menor_mejor' ? actual <= target : actual >= target
  if (cumple) return { estado: 'verde', gap, porcentaje }

  const cerca = direccion === 'menor_mejor' ? actual <= target * (2 - MARGEN_AMBAR) : actual >= target * MARGEN_AMBAR
  return { estado: cerca ? 'ambar' : 'rojo', gap, porcentaje }
}

// ── Catálogo del dashboard global (§27) ───────────────────────────────────────
// Las claves 'revenue', 'cash_collected' y 'sales_count' SON las de lib/analytics.ts
// (targetCurrentValue) — mismo vocabulario en todo el sistema (nomenclatura consecuente).
// 'customers', 'mer', 'cac' y 'ltv_cac' completan los KPIs de la cabecera del dashboard global.
export type MetricaConObjetivo = {
  key: string
  label: string
  descripcion: string
  tipo: TipoFormato
  direccion: DireccionObjetivo
}

export const METRICAS_CON_OBJETIVO: readonly MetricaConObjetivo[] = [
  {
    key: 'revenue',
    label: 'Revenue Closed',
    descripcion: 'Facturación de ventas activas',
    tipo: 'money',
    direccion: 'mayor_mejor',
  },
  {
    key: 'cash_collected',
    label: 'Cash Collected',
    descripcion: 'Dinero efectivamente cobrado',
    tipo: 'money',
    direccion: 'mayor_mejor',
  },
  {
    key: 'sales_count',
    label: 'Ventas',
    descripcion: 'Número de ventas cerradas',
    tipo: 'count',
    direccion: 'mayor_mejor',
  },
  {
    key: 'customers',
    label: 'Clientes nuevos',
    descripcion: 'Clientes únicos que compran por primera vez',
    tipo: 'count',
    direccion: 'mayor_mejor',
  },
  {
    key: 'mer',
    label: 'MER',
    descripcion: 'Cash cobrado / gasto publicitario total',
    tipo: 'ratio',
    direccion: 'mayor_mejor',
  },
  {
    key: 'cac',
    label: 'CAC blended',
    descripcion: 'Gasto de adquisición / clientes nuevos — mejor MÁS BAJO',
    tipo: 'money',
    direccion: 'menor_mejor',
  },
  {
    key: 'ltv_cac',
    label: 'LTV:CAC',
    descripcion: 'Ratio de retorno sobre el coste de adquisición',
    tipo: 'ratio',
    direccion: 'mayor_mejor',
  },
] as const

/** Fila mínima de la tabla `targets` que este módulo necesita. */
export type TargetComparable = {
  metric_key: string
  scope_type: string
  is_active?: boolean | null
  period_start: string
  period_end: string
  target_value: number | string
}

/**
 * El objetivo que aplica al periodo seleccionado: el company activo de esa métrica cuya ventana
 * [period_start, period_end] SOLAPA con el rango visible.
 *
 * Sin solape no hay comparación: un target "de este mes" contra el acumulado de todo el histórico
 * son dos ventanas distintas disfrazadas de la misma métrica. Con "todo" (from/to nulos) se usa
 * el target cuya ventana contenga HOY — el objetivo vigente.
 *
 * Empate: gana el de period_start más reciente (el objetivo más nuevo es el que el equipo está
 * persiguiendo ahora).
 */
export function eligeTarget<T extends TargetComparable>(
  targets: readonly T[],
  metricKey: string,
  from: string | null,
  to: string | null,
  today?: string
): T | null {
  const candidatos = targets.filter(
    (t) => t.metric_key === metricKey && t.scope_type === 'company' && t.is_active !== false
  )
  if (candidatos.length === 0) return null

  const solapan =
    from && to
      ? candidatos.filter((t) => t.period_start <= to && t.period_end >= from)
      : today
        ? candidatos.filter((t) => t.period_start <= today && t.period_end >= today)
        : []

  const elegibles = solapan.length > 0 ? solapan : []
  if (elegibles.length === 0) return null
  return elegibles.reduce((a, b) => (b.period_start > a.period_start ? b : a))
}

/** Valor numérico del target (la columna es NUMERIC y llega como string por el driver). */
export function valorTarget(t: TargetComparable | null): number | null {
  if (!t) return null
  const n = typeof t.target_value === 'number' ? t.target_value : Number(t.target_value)
  return Number.isFinite(n) ? n : null
}
