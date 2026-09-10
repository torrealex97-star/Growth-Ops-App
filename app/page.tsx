import Link from 'next/link'

const modules = [
  ['Ventas', 'Pipeline, agendas y atribución comercial en un solo lugar.'],
  ['Finanzas', 'Facturación, cash collected, gastos y comisiones sin hojas paralelas.'],
  ['Equipo', 'Objetivos, rendimiento y permisos organizados por rol.'],
]

export default function Home() {
  return <main>
    <nav className="shell" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '28px 0' }}>
      <strong style={{ letterSpacing: '-.04em', fontSize: 22 }}>GROWTH<span style={{ color: '#1e9eff' }}>OPS</span></strong>
      <Link className="button secondary" href="/login">Acceder</Link>
    </nav>
    <section className="shell" style={{ padding: '11vh 0 8vh', textAlign: 'center' }}>
      <p className="eyebrow">Tu negocio, en control</p>
      <h1 style={{ maxWidth: 900, margin: '20px auto', fontSize: 'clamp(3rem, 8vw, 7rem)', lineHeight: .92, letterSpacing: '-.075em' }}>Crece con datos.<br /><span style={{ color: '#1e9eff' }}>Decide con claridad.</span></h1>
      <p style={{ maxWidth: 660, margin: '28px auto 36px', color: '#aab6ca', fontSize: 'clamp(1rem, 2vw, 1.25rem)', lineHeight: 1.7 }}>Un sistema operativo para ventas, finanzas y equipo. Reconstruido sobre Supabase y desplegado en Vercel.</p>
      <Link className="button" href="/login">Entrar al panel</Link>
    </section>
    <section className="shell" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, paddingBottom: 70 }}>
      {modules.map(([title, copy], index) => <article className="glass" key={title} style={{ borderRadius: 22, padding: 28 }}>
        <span className="eyebrow">0{index + 1}</span><h2 style={{ margin: '20px 0 10px', fontSize: 24 }}>{title}</h2><p style={{ margin: 0, color: '#95a2b7', lineHeight: 1.65 }}>{copy}</p>
      </article>)}
    </section>
  </main>
}
