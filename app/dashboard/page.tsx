import { createClient } from '@/lib/supabase/server'
import { SignOutButton } from '@/components/sign-out-button'

const metricTables = [['Contactos', 'contacts'], ['Agendas', 'appointments'], ['Ventas', 'sales'], ['Cobros', 'collections']] as const

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const metrics = await Promise.all(metricTables.map(async ([label, table]) => {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
    return { label, count: error ? null : count ?? 0 }
  }))
  return <main className="shell" style={{ padding: '32px 0 70px' }}>
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
      <div><p className="eyebrow">Growth Ops · Dashboard</p><h1 style={{ margin: '8px 0 0', fontSize: 'clamp(2rem, 5vw, 4rem)', letterSpacing: '-.055em' }}>Centro de operaciones</h1></div><SignOutButton />
    </header>
    <section style={{ margin: '44px 0 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
      {metrics.map(({ label, count }) => <article className="glass" key={label} style={{ borderRadius: 20, padding: 24 }}><span style={{ color: '#95a2b7' }}>{label}</span><strong style={{ display: 'block', marginTop: 14, fontSize: 42, letterSpacing: '-.05em' }}>{count ?? '—'}</strong></article>)}
    </section>
    <section className="glass" style={{ borderRadius: 22, padding: 28, marginTop: 18 }}><p className="eyebrow">Sesión conectada</p><h2 style={{ margin: '14px 0 8px' }}>{user?.email}</h2><p style={{ color: '#95a2b7', margin: 0, lineHeight: 1.65 }}>La base ya usa autenticación y datos de Supabase. Los módulos comerciales se incorporarán sobre esta estructura.</p></section>
  </main>
}
