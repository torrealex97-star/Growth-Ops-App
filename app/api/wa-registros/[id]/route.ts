import { NextResponse } from 'next/server'
import postgres from 'postgres'

export const dynamic = 'force-dynamic'

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20, max_lifetime: 60 * 30 })

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await sql`DELETE FROM wa_registros_[tenant] WHERE id = ${params.id}`
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
  }
}
