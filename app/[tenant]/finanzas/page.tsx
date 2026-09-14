import { redirect } from 'next/navigation'

// /finanzas no tenía página raíz: escribir la URL a mano daba 404 aunque la sección existiera en el
// menú. Redirige al Resumen analítico, que es la lectura de "cómo vamos" de la sección — no a
// Gastos ni a Cobros, que son las vistas operativas.
export default async function FinanzasIndexPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/${tenant}/finanzas/analitica/resumen`)
}
