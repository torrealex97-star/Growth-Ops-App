import Link from 'next/link'

function daysUntilLaunch() {
  const launch = new Date('2026-05-06T00:00:00')
  const now = new Date()
  const diff = Math.ceil((launch.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (diff <= 0) return 'Activo'
  return `${diff}d para el lanzamiento`
}

export default function LanzamientoHubPage() {
  const daysLabel = daysUntilLaunch()

  return (
    <div className="min-h-screen bg-[#0f0f1a] flex flex-col">
      <div className="h-0.5 bg-gradient-to-r from-transparent via-[#C9477A] to-transparent" />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Back */}
        <div className="w-full max-w-2xl mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[#4a4a6a] hover:text-[#94a3b8] text-sm transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
            </svg>
            Volver al inicio
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9477A" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <h1 className="text-white font-bold text-xl tracking-tight">Lanzamiento</h1>
            <p className="text-[#C9477A] text-xs font-medium">{daysLabel} · Mayo 2026</p>
          </div>
        </div>
        <p className="text-[#4a4a6a] text-sm mb-12">¿Cómo quieres acceder?</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full max-w-3xl">
          {/* Dashboard */}
          <Link
            href="/login"
            className="group relative bg-[#1a1a2e] border border-[#2a2a3e] hover:border-[#C9477A]/50 rounded-2xl p-7 transition-all duration-200 hover:bg-[#1e1e35] hover:shadow-[0_0_30px_rgba(201,71,122,0.08)]"
          >
            <div className="flex items-start justify-between mb-5">
              <div className="w-11 h-11 rounded-xl bg-[#C9477A]/15 border border-[#C9477A]/25 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9477A" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold text-[#C9477A] bg-[#C9477A]/10 border border-[#C9477A]/20 rounded-full px-2.5 py-1 uppercase tracking-wider">
                Admin
              </span>
            </div>
            <h2 className="text-white font-bold text-lg mb-1.5 group-hover:text-[#C9477A] transition-colors">
              Dashboard
            </h2>
            <p className="text-[#4a4a6a] text-sm leading-relaxed">
              Leads, encuestas, WhatsApp, afiliadas y análisis UTM del lanzamiento.
            </p>
            <div className="mt-5 flex items-center gap-1.5 text-[#C9477A] text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              <span>Entrar</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </Link>

          {/* Cold Caller */}
          <Link
            href="/coldcalling/login"
            className="group relative bg-[#1a1a2e] border border-[#2a2a3e] hover:border-[#a855f7]/40 rounded-2xl p-7 transition-all duration-200 hover:bg-[#1c1a2e] hover:shadow-[0_0_30px_rgba(168,85,247,0.06)]"
          >
            <div className="flex items-start justify-between mb-5">
              <div className="w-11 h-11 rounded-xl bg-[#a855f7]/10 border border-[#a855f7]/20 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold text-[#a855f7] bg-[#a855f7]/10 border border-[#a855f7]/20 rounded-full px-2.5 py-1 uppercase tracking-wider">
                Closer
              </span>
            </div>
            <h2 className="text-white font-bold text-lg mb-1.5 group-hover:text-[#a855f7] transition-colors">
              Cold Caller
            </h2>
            <p className="text-[#4a4a6a] text-sm leading-relaxed">
              Panel de gestión de llamadas, estado de leads y seguimiento del equipo.
            </p>
            <div className="mt-5 flex items-center gap-1.5 text-[#a855f7] text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              <span>Entrar</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </Link>
          {/* Closer */}
          <Link
            href="/lanzamiento/closer/login"
            className="group relative bg-[#1a1a2e] border border-[#2a2a3e] hover:border-[#C9477A]/50 rounded-2xl p-7 transition-all duration-200 hover:bg-[#1e1e35] hover:shadow-[0_0_30px_rgba(201,71,122,0.08)]"
          >
            <div className="flex items-start justify-between mb-5">
              <div className="w-11 h-11 rounded-xl bg-[#C9477A]/15 border border-[#C9477A]/25 flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C9477A" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold text-[#C9477A] bg-[#C9477A]/10 border border-[#C9477A]/20 rounded-full px-2.5 py-1 uppercase tracking-wider">
                Closer
              </span>
            </div>
            <h2 className="text-white font-bold text-lg mb-1.5 group-hover:text-[#C9477A] transition-colors">
              Closer
            </h2>
            <p className="text-[#4a4a6a] text-sm leading-relaxed">
              Registra ventas, consulta tu facturación y comisión en tiempo real.
            </p>
            <div className="mt-5 flex items-center gap-1.5 text-[#C9477A] text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
              <span>Entrar</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </Link>
        </div>
      </main>

      <footer className="text-center pb-6 pt-2">
        <p className="text-[#2a2a3e] text-xs">IA WINNERS © 2026</p>
      </footer>
    </div>
  )
}
