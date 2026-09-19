'use client'

// COBERTURA DE ATRIBUCIÓN (§21 de la spec del dashboard global): parte del negocio con origen
// conocido. Vive en Marketing › Atribución — junto al resto del diagnóstico de atribución — no en
// el dashboard de Métricas y KPIs, donde solo confundía la lectura del negocio.
// Presentación pura: los porcentajes llegan calculados (coveragePct de lib/canonical/dedup).

export type AttributionCoverageData = {
  leads: number | null
  sales: number | null
  revenue: number | null
}

export function AttributionCoverage({ coverage }: { coverage: AttributionCoverageData }) {
  const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n)}%`)
  return (
    <div className="dashboard-card p-5">
      <h3 className="font-display text-lg font-semibold">Cobertura de atribución</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Parte del negocio con origen conocido. Baja cobertura = decisiones de presupuesto a ciegas.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        {(
          [
            ['Leads', coverage.leads],
            ['Ventas', coverage.sales],
            ['Revenue', coverage.revenue],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums">{pct(v)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
