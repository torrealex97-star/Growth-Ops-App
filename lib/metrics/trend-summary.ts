/** Resume exclusivamente el rango visible. El periodo anterior siempre es explícito. */
export function summarizeTrend(
  data: { value: number | null }[],
  aggregate: 'sum' | 'last' = 'sum',
  previousTotal?: number | null
) {
  const values = data.flatMap((p) => (p.value === null || !Number.isFinite(p.value) ? [] : [p.value]))
  const total =
    values.length === 0
      ? null
      : aggregate === 'last'
        ? values[values.length - 1]
        : values.reduce((sum, value) => sum + value, 0)
  const previous = previousTotal != null && Number.isFinite(previousTotal) ? previousTotal : null
  const change =
    total !== null && previous !== null && previous !== 0 ? ((total - previous) / Math.abs(previous)) * 100 : null
  return { total, previous, change }
}
