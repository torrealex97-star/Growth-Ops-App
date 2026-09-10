import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { registerSale } from '@/lib/db-lanzamiento'

const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: 'require',
  max: 3,
  prepare: false,
  idle_timeout: 20,
})

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

interface NewSaleBody {
  fecha: string
  nombre: string
  apellido?: string
  telefono?: string | null
  email: string
  valor: number
  tipo_pago: string
  cash_collected: number
  closer_id: number
  setter_id?: number | null
  coldcaller_id?: number | null
  afiliado_email?: string | null
  plataforma?: string | null
  status?: 'active' | 'refunded'
  nota?: string | null
  // Optional UTM overrides — if provided, win over leads_cache lookup
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = (await req.json()) as NewSaleBody

  if (!body.email || !body.fecha || !body.closer_id || !body.tipo_pago) {
    return NextResponse.json({ error: 'email, fecha, closer_id y tipo_pago son obligatorios' }, { status: 400 })
  }

  const email = body.email.toLowerCase().trim()

  // Lookup leads_cache for UTM auto-fill — admin overrides win if provided
  const leadRows = await sql<{
    email: string; telefono: string;
    utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
    utm_content: string | null; utm_term: string | null;
  }[]>`
    SELECT email, telefono, utm_source, utm_medium, utm_campaign, utm_content, utm_term
    FROM leads_cache WHERE email = ${email} LIMIT 1
  `
  const lead = leadRows[0] ?? null

  const utm_source   = body.utm_source   ?? lead?.utm_source   ?? null
  const utm_medium   = body.utm_medium   ?? lead?.utm_medium   ?? null
  const utm_campaign = body.utm_campaign ?? lead?.utm_campaign ?? null
  const utm_content  = body.utm_content  ?? lead?.utm_content  ?? null
  const utm_term     = body.utm_term     ?? lead?.utm_term     ?? null

  const isAfil = (utm_medium ?? '').toLowerCase().includes('afiliaci')
  const afiliadoEmail = body.afiliado_email ?? (isAfil ? utm_content : null)

  const sale = await registerSale({
    fecha: body.fecha,
    nombre: body.nombre,
    apellido: body.apellido ?? '',
    telefono: body.telefono ?? lead?.telefono ?? '',
    email,
    plataforma: body.plataforma ?? null,
    valor: body.valor,
    tipo_pago: body.tipo_pago,
    cash_collected: body.cash_collected,
    closer_id: body.closer_id,
    coldcaller_id: body.coldcaller_id ?? null,
    setter_id: body.setter_id ?? null,
    lead_email: lead?.email ?? null,
    afiliado_email: afiliadoEmail,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    status: body.status ?? 'active',
    nota: body.nota ?? null,
  })

  return NextResponse.json({ ok: true, sale, lead_matched: !!lead })
}
