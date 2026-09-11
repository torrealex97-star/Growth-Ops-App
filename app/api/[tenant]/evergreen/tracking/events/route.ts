import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const eventSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  event_name: z.string().trim().min(1).max(100),
  occurred_at: z.string().datetime({ offset: true }),
  source: z.string().trim().min(1).max(100),
  schema_version: z.string().trim().max(30).default('1.0'),
  idempotency_key: z.string().trim().min(1).max(250),
  visitor_id: z.string().uuid().nullable().optional(),
  session_id: z.string().uuid().nullable().optional(),
  touchpoint_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  appointment_id: z.string().uuid().nullable().optional(),
  sale_id: z.string().uuid().nullable().optional(),
  revenue: z.number().finite().nullable().optional(),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()).nullable().optional(),
  consent_snapshot: z.record(z.string(), z.unknown()),
  properties: z.record(z.string(), z.unknown()).default({}),
})

export async function POST(request: NextRequest) {
  const secret = process.env.TRACKING_INGEST_KEY
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = eventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Evento inválido', details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    )
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data, error } = await supabase
    .from('canonical_events')
    .upsert(
      { ...parsed.data, processing_status: 'received' },
      { onConflict: 'source,idempotency_key', ignoreDuplicates: true }
    )
    .select('id,event_id,event_name,received_at,processing_status')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'No se pudo registrar el evento' }, { status: 500 })
  }

  return NextResponse.json(
    { accepted: true, duplicate: !data, event: data ?? null },
    { status: data ? 201 : 200 }
  )
}
