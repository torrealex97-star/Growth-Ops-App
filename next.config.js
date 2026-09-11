/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['papaparse'],
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
      { source: '/:tenant/targets', destination: '/:tenant/analitica/objetivos', permanent: true },
      { source: '/:tenant/kpi/report', destination: '/:tenant/analitica/actividad', permanent: true },

      // Comisiones
      { source: '/:tenant/commissions', destination: '/:tenant/comisiones', permanent: true },

      // Recursos de venta
      { source: '/:tenant/enlaces', destination: '/:tenant/recursos/enlaces', permanent: true },
      { source: '/:tenant/biblioteca', destination: '/:tenant/recursos/biblioteca', permanent: true },
      { source: '/:tenant/testimonios', destination: '/:tenant/recursos/testimonios', permanent: true },
      { source: '/:tenant/testimonios/:id', destination: '/:tenant/recursos/testimonios/:id', permanent: true },
      { source: '/:tenant/contratos/producto', destination: '/:tenant/recursos/contratos-producto', permanent: true },
      { source: '/:tenant/setting-ai', destination: '/:tenant/recursos/setting-ai', permanent: true },
    ]
  },
}

module.exports = nextConfig
