import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { parseAccountIds } from '@/lib/meta/accounts'

export const runtime = 'nodejs'

// QUÉ CUENTAS ESTÁN SELECCIONADAS, en un único sitio y para toda la app.
//
// EL PROBLEMA QUE RESUELVE. Las pantallas leían `campaigns` sin filtrar por cuenta, así que sumaban
// TODAS las cuentas publicitarias a las que el token tiene acceso —catorce en esta base— y no solo
// las elegidas en Integraciones. El resultado eran impresiones, gasto y CPL de cuentas que no son
// del negocio que se está mirando, mezclados en el mismo número y sin forma de notarlo.
//
// La selección vive en la configuración de la subcuenta (META_AD_ACCOUNT_ID), que es server-side.
// Este endpoint la expone para que las pantallas no tengan que leer credenciales ni reimplementar el
// parseo: devuelve SOLO los identificadores de cuenta, nunca el token.
//
// CONVENIO, el mismo que el resto de la app: lista VACÍA significa "todas las accesibles". Es lo que
// dice la pantalla de Integraciones y lo que hace la sincronización; si aquí significara otra cosa,
// el panel y los datos discreparían.
//
// Pensado para crecer. Hoy la única integración con VARIAS cuentas bajo una credencial es Meta:
// Instagram se identifica por su propio token (una cuenta por token), así que no hay nada que elegir
// y se devuelve como tal en vez de inventar una clave de configuración que no existe. Cuando una
// integración futura admita varias cuentas, su lista se añade AQUÍ y las pantallas no cambian.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const cfg = await getTenantConfigWithFallback(auth.tenantId)
  const meta = parseAccountIds(cfg.META_AD_ACCOUNT_ID)

  // Nombres legibles de las cuentas seleccionadas, sacados de las campañas YA SINCRONIZADAS
  // (campaigns.account_name). Sin llamada externa a Meta: el dashboard no debe depender de la
  // Graph API para pintar un <select>. Si una cuenta aún no tiene campañas sincronizadas, cae a
  // su id tal cual — mejor que fingir un nombre que no sabemos.
  const nombres: Record<string, string> = {}
  if (meta.length > 0) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: campañas } = await sb
      .from('campaigns')
      .select('account_id, account_name')
      .eq('tenant_id', auth.tenantId)
      .in('account_id', meta)
      .limit(1000)
    for (const c of campañas ?? []) {
      const id = (c as { account_id: string | null }).account_id
      const name = (c as { account_name: string | null }).account_name
      if (id && name && !nombres[id]) nombres[id] = name
    }
  }

  return NextResponse.json(
    {
      meta: { seleccionadas: meta, todas: meta.length === 0, nombres },
      // Instagram no tiene selección de cuenta: la cuenta ES la del token configurado.
      instagram: { seleccionadas: [], todas: true, motivo: 'una cuenta por token' },
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
        Vary: 'Cookie',
      },
    }
  )
}
