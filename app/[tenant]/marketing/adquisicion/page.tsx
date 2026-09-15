import { redirect } from 'next/navigation'

// Redirección canónica de /marketing/adquisicion, en servidor.
//
// Campañas es el punto de entrada operativo pedido para Marketing. Atribución sigue disponible
// como pestaña hermana y conserva su URL directa.
//
// En servidor por lo mismo que /crm y /ventas: el useEffect + router.replace anterior dejaba un
// instante en blanco y una entrada muerta en el historial.
export default async function AdquisicionIndexPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/${tenant}/marketing/adquisicion/campanas`)
}
