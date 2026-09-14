import { redirect } from 'next/navigation'

// Redirección canónica de /ventas, en servidor (mismo patrón que /crm).
//
// DOS CAMBIOS. El destino pasa del registro de ventas al embudo: entrar en Ventas tiene que
// responder "¿qué está pasando y dónde está el cuello de botella?", y una tabla de filas no
// responde a eso. El registro sigue a un clic, como segunda vista.
//
// Y se hace en servidor. La versión anterior usaba useEffect + router.replace, que es justo lo que
// el comentario de /crm documenta como incorrecto: monta un componente cliente que pinta `null`
// (instante de pantalla en blanco), el navegador nunca recibe un redirect HTTP, y queda una entrada
// muerta en el historial que hace que "atrás" rebote.
export default async function VentasIndexPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/${tenant}/analitica/embudo`)
}
