'use client'

// Shim del layout: si hay una sesión "Ver como" activa para esta subcuenta, monta el banner
// ENCIMA de toda la interfaz (antes del sidebar y del header) en un columna flex. Sin sesión
// "ver como" renderiza exactamente lo mismo de siempre — es invisible para el 99,9% de los días.
import { useVerComo } from '@/components/os/BannerVerComo'
import BannerVerComo from '@/components/os/BannerVerComo'

export default function VerComoShim({ tenant, children }: { tenant: string; children: React.ReactNode }) {
  const { info } = useVerComo(tenant)
  if (!info) return <>{children}</>
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <BannerVerComo info={info} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
