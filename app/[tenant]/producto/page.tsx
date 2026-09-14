import { redirect } from 'next/navigation'

// /producto no tenía página raíz: escribir la URL a mano daba 404 aunque la sección existiera en el
// menú. Redirige a Alumnos, que es la vista con los datos de la sección.
export default async function ProductoIndexPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/${tenant}/students`)
}
