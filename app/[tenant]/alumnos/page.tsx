import { redirect } from 'next/navigation'

export default function AlumnosPage({ params }: { params: { tenant: string } }) {
  redirect(`/${params.tenant}/alumnos/journey`)
}
