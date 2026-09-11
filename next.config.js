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

      // Reorganización de "Marketing" (Adquisición / Instagram / Data Health→Settings).
      { source: '/:tenant/campaigns', destination: '/:tenant/marketing/adquisicion/campanas', permanent: true },
      { source: '/:tenant/attribution', destination: '/:tenant/marketing/adquisicion/atribucion', permanent: true },
      { source: '/:tenant/vsl', destination: '/:tenant/marketing/adquisicion/vsl', permanent: true },
      { source: '/:tenant/content/reels', destination: '/:tenant/instagram/reels', permanent: true },
      { source: '/:tenant/carruseles', destination: '/:tenant/instagram/carruseles', permanent: true },
      { source: '/:tenant/carruseles/:id', destination: '/:tenant/instagram/carruseles/:id', permanent: true },
      { source: '/:tenant/content', destination: '/:tenant/instagram/contenido', permanent: true },
      { source: '/:tenant/data-health', destination: '/:tenant/settings?tab=data-health', permanent: true },
    ]
  },
}

module.exports = nextConfig
