import { redirect } from 'next/navigation'

// La home de producción (app.iawinners.com) lleva directamente a la plataforma:
// si no hay sesión, el middleware redirige al login evergreen; si la hay, al dashboard.
// El antiguo hub de lanzamiento/sorteo sigue accesible en /lanzamiento y /sorteo.
export default function HomePage() {
  redirect('/evergreen/dashboard')
}
