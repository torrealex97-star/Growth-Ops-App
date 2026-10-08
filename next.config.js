/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['papaparse'],
  // CI ES EL GATE DE TIPOS: GitHub Actions ya ejecuta typecheck (tsc --noEmit con 6 GB de heap:
  // "El runner estándar se queda sin memoria con la carga actual de tipos", ci.yml) y lint en el
  // SHA exacto de cada PR antes de mergear. En la build de Vercel (Hobby) la fase "Linting and
  // checking validity of types" entra en thrashing con la carga de tipos actual y muere al cap de
  // 45 min: 5 deployments production ERROR el 28-sep (10:37Z-15:16Z) con BUILD_EXCEEDED_MAXIMUM_TIME
  // y producción congelada en f18e336. En la build de Vercel se salta; en local y CI se mantiene.
  ...(process.env.VERCEL ? { typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true } } : {}),
  // Este repositorio vive dentro de una carpeta que también contiene otro package-lock.
  // Fijar la raíz evita que Next tracee desde /Documents y meta archivos ajenos en el
  // artefacto serverless (más tamaño, I/O y riesgo de un despliegue incompleto).
  outputFileTracingRoot: __dirname,
  // CABECERAS DE SEGURIDAD en todas las rutas. `/embed` (reproductor VSL incrustado en landings y GHL)
  // queda fuera de las que impiden el enmarcado: tiene que poder verse dentro de páginas de terceros.
  // No se impone aquí una CSP de scripts: la app carga Meta, Stripe, vídeo y fuentes de varios orígenes y
  // una CSP a ciegas rompería pantallas; se introduce aparte en modo «solo informe».
  async headers() {
    const comunes = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
    ]
    return [
      { source: '/:path*', headers: comunes },
      {
        // Todo salvo /embed y los scripts públicos de tracking.
        source: '/((?!embed|tracker\\.js).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
          },
          {
            // Telemetría previa al endurecimiento: no bloquea recursos. El receptor conserva solo
            // directivas y orígenes, nunca paths/query/script-sample. Tras observar producción se
            // podrá trasladar cada directiva validada a la CSP aplicada de arriba.
            key: 'Content-Security-Policy-Report-Only',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; media-src 'self' blob: https:; frame-src 'self' https:; worker-src 'self' blob:; manifest-src 'self'; report-uri /api/security/csp-report",
          },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
    ]
  },
  async redirects() {
    // Reorganización de la sección "Ventas" (CRM / Ventas & Cobros / Analítica / Comisiones /
    // Recursos de venta). Redirects 301 desde cada ruta vieja para no romper enlaces ni bookmarks.
    // ':tenant' matchea cualquier subcuenta — la reorganización es la misma para todas.
    return [
      // CRM
      { source: '/:tenant/contacts', destination: '/:tenant/crm/contactos', permanent: true },
      { source: '/:tenant/contacts/:id', destination: '/:tenant/crm/contactos/:id', permanent: true },
      { source: '/:tenant/leads', destination: '/:tenant/crm/contactos?view=leads', permanent: true },
      { source: '/:tenant/appointments', destination: '/:tenant/crm/agendas', permanent: true },
      { source: '/:tenant/seguimiento', destination: '/:tenant/crm/seguimiento', permanent: true },

      // Ventas & Cobros
      { source: '/:tenant/sales', destination: '/:tenant/ventas/registro', permanent: true },
      { source: '/:tenant/sales/new', destination: '/:tenant/ventas/registro/nueva', permanent: true },
      { source: '/:tenant/sales/:id', destination: '/:tenant/ventas/registro/:id', permanent: true },
      { source: '/:tenant/pagos', destination: '/:tenant/ventas/pagos', permanent: true },
      { source: '/:tenant/reservas', destination: '/:tenant/ventas/reservas', permanent: true },

      // Analítica de ventas
      { source: '/:tenant/ventas-metricas', destination: '/:tenant/analitica/embudo', permanent: true },
      { source: '/:tenant/pipeline', destination: '/:tenant/analitica/ranking', permanent: true },
      { source: '/:tenant/prospecting', destination: '/:tenant/analitica/actividad', permanent: true },
      // Objetivos se eliminó de Analítica de ventas (a petición del usuario) — la ruta antigua
      // y la de la reorg (breve, nunca publicada) caen al Embudo.
      { source: '/:tenant/targets', destination: '/:tenant/analitica/embudo', permanent: true },
      { source: '/:tenant/analitica/objetivos', destination: '/:tenant/analitica/embudo', permanent: true },
      { source: '/:tenant/kpi/report', destination: '/:tenant/analitica/actividad', permanent: true },

      // Comisiones
      { source: '/:tenant/commissions', destination: '/:tenant/comisiones', permanent: true },

      // Recursos de venta
      { source: '/:tenant/enlaces', destination: '/:tenant/recursos/enlaces', permanent: true },
      { source: '/:tenant/biblioteca', destination: '/:tenant/recursos/biblioteca', permanent: true },
      { source: '/:tenant/testimonios', destination: '/:tenant/recursos/testimonios', permanent: true },
      { source: '/:tenant/testimonios/:id', destination: '/:tenant/recursos/testimonios/:id', permanent: true },
      { source: '/:tenant/contratos/producto', destination: '/:tenant/recursos/contratos-producto', permanent: true },
      // Setting AI se movió a Marketing (a petición del usuario) — vuelve a vivir en /setting-ai,
      // así que solo redirigimos la ruta breve de Recursos de venta, no la original.
      { source: '/:tenant/recursos/setting-ai', destination: '/:tenant/setting-ai', permanent: true },

      // Reorganización de "Finanzas" (Analítica financiera / Gastos & Facturas / Cobros &
      // Conciliación / Morosidad) + Afiliados movido a Marketing.
      { source: '/:tenant/finanzas', destination: '/:tenant/finanzas/analitica/resumen', permanent: true },
      { source: '/:tenant/proyeccion', destination: '/:tenant/finanzas/analitica/proyeccion', permanent: true },
      { source: '/:tenant/expenses', destination: '/:tenant/finanzas/gastos-facturas/gastos', permanent: true },
      { source: '/:tenant/facturas', destination: '/:tenant/finanzas/gastos-facturas/facturas', permanent: true },
      { source: '/:tenant/gestoria', destination: '/:tenant/finanzas/gastos-facturas/gestoria', permanent: true },
      { source: '/:tenant/collections', destination: '/:tenant/finanzas/cobros/cobros', permanent: true },
      { source: '/:tenant/collections/new', destination: '/:tenant/finanzas/cobros/cobros/new', permanent: true },
      { source: '/:tenant/refunds', destination: '/:tenant/finanzas/cobros/devoluciones', permanent: true },
      { source: '/:tenant/morosidad', destination: '/:tenant/finanzas/morosidad', permanent: true },
      { source: '/:tenant/morosos-sequra', destination: '/:tenant/finanzas/morosidad?origen=sequra', permanent: true },
      { source: '/:tenant/afiliados', destination: '/:tenant/marketing/afiliados/afiliados', permanent: true },
      { source: '/:tenant/afiliados/campanas', destination: '/:tenant/marketing/afiliados/campanas', permanent: true },
    ].map(({ source, destination }) => ({ source, destination, statusCode: 301 }))
  },
}

// El wrapper de Sentry añade una pasada extra de webpack (instrumentación + generación de
// source maps) que consume memoria/tiempo de build significativos — de sobra en producción,
// pero innecesario y potencialmente causa de OOM/timeout en builds (Vercel Preview, local) donde
// todavía no hay DSN configurado. Si no hay DSN, exporta el config plano tal cual: sentry.*.config.ts
// ya quedan inertes sin DSN (ver sentry.client/server/edge.config.ts), así que no perder el wrapper
// de webpack aquí no cambia el comportamiento en runtime, solo evita el coste de build de más.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const { withSentryConfig } = require('@sentry/nextjs/config')
  module.exports = withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    dryRun: !process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    disableLogger: true,
    widenClientFileUpload: false,
    automaticVercelMonitors: false,
  })
} else {
  module.exports = nextConfig
}
