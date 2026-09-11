import { redirect } from 'next/navigation'

// La home lleva directamente a la plataforma: si no hay sesión, el middleware
// redirige al login evergreen; si la hay, al dashboard.
export default function HomePage() {
  redirect('/evergreen/dashboard')
}
