import { redirect } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function EvergreenRootPage() {
  const tenant = useTenant()
  redirect(`/${tenant}/dashboard`)
}
