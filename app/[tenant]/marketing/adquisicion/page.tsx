import { redirect } from 'next/navigation'

// Redirección canónica de /marketing/adquisicion, en servidor.
//
// El destino pasa de Campañas a Atribución: Campañas es la vista OPERATIVA (qué anuncios hay y qué
// gastan) y sigue existiendo intacta como segunda entrada del menú. Lo que debe abrirse primero es
// la lectura analítica de dónde vienen los resultados.
//
// En servidor por lo mismo que /crm y /ventas: el useEffect + router.replace anterior dejaba un
// instante en blanco y una entrada muerta en el historial.
export default async function AdquisicionIndexPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/${tenant}/marketing/adquisicion/atribucion`)
}
