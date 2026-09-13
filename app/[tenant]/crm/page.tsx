import { redirect } from 'next/navigation'

// Redirección CANÓNICA de /crm, en servidor.
//
// Dos cambios respecto a la versión anterior:
//
// 1. El destino pasa de /crm/contactos a /crm/agendas. La agenda es lo que el equipo abre cada
//    mañana; la lista de contactos es una consulta, no el punto de partida del día.
// 2. Se hace en servidor con redirect() en vez de un useEffect con router.replace. El efecto
//    obligaba a montar un componente cliente que pintaba `null`, así que había un instante de
//    pantalla en blanco, y el navegador nunca recibía un redirect HTTP: quedaba una entrada muerta
//    en el historial, y el botón "atrás" volvía a /crm para rebotar otra vez.
export default async function CrmIndexPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/${tenant}/crm/agendas`)
}
