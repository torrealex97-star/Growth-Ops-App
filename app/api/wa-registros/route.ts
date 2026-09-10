import { NextResponse } from 'next/server'
import postgres from 'postgres'

export const dynamic = 'force-dynamic'

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20, max_lifetime: 60 * 30 })

export async function GET() {
  try {
    const rows = await sql`
      SELECT id, total, delta, nota, created_at
      FROM wa_registros_closerclub
      ORDER BY created_at DESC
    `
    return NextResponse.json({ registros: rows.map(r => ({
      id: r.id,
      total: r.total,
      delta: r.delta,
      nota: r.nota,
      fecha: r.created_at,
    })) })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Error al cargar registros' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { total, nota } = await req.json()
    if (typeof total !== 'number' || total < 0) {
      return NextResponse.json({ error: 'Total inválido' }, { status: 400 })
    }

    const anterior = await sql`
      SELECT total FROM wa_registros_closerclub ORDER BY created_at DESC LIMIT 1
    `
    const delta = anterior.length > 0 ? total - anterior[0].total : 0

    const [row] = await sql`
      INSERT INTO wa_registros_closerclub (total, delta, nota)
      VALUES (${total}, ${delta}, ${nota?.trim() || null})
      RETURNING id, total, delta, nota, created_at
    `
    return NextResponse.json({ registro: {
      id: row.id,
      total: row.total,
      delta: row.delta,
      nota: row.nota,
      fecha: row.created_at,
    } }, { status: 201 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
}
