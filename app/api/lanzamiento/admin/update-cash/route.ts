import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'

export const maxDuration = 30

const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: 'require',
  max: 5,
  prepare: false,
  idle_timeout: 20,
})

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

// Hardcoded cash_collected updates that match the latest sheet values.
// Run this when the sheet's "Cash Collected" column changes but no other
// field does — it patches in-place by email and never wipes other edits.
const CASH_UPDATES: { email: string; cash_collected: number }[] = [
  { email: 'crispascualgiloficial@gmail.com', cash_collected: 2500 },  // Cristina Pascual
  { email: 'yessica_g.g@hotmail.com',         cash_collected: 597  },  // Yesica García
  { email: 'mapymore@hotmail.com',            cash_collected: 2500 },  // María Del Pilar Moreno
  { email: 'vlimeres@live.com',               cash_collected: 2500 },  // Vanessa Limeres
  { email: 'rachelfaar@gmail.com',            cash_collected: 675  },  // Raquel Faya
  { email: 'ysalvadorsanz@gmail.com',         cash_collected: 2500 },  // Yolanda Salvador
]

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const result = {
    total: CASH_UPDATES.length,
    updated: 0,
    not_found: [] as string[],
    details: [] as { email: string; cash_collected: number; matched: boolean; previous?: number }[],
  }

  try {
    for (const u of CASH_UPDATES) {
      const rows = await sql<{ id: number; cash_collected: string | number }[]>`
        UPDATE launch_sales
        SET cash_collected = ${u.cash_collected}, updated_at = NOW()
        WHERE LOWER(email) = ${u.email.toLowerCase()}
        RETURNING id, (
          SELECT cash_collected FROM launch_sales
          WHERE LOWER(email) = ${u.email.toLowerCase()} LIMIT 1
        ) as cash_collected
      `
      if (rows.length === 0) {
        result.not_found.push(u.email)
        result.details.push({ email: u.email, cash_collected: u.cash_collected, matched: false })
      } else {
        result.updated += rows.length
        result.details.push({ email: u.email, cash_collected: u.cash_collected, matched: true })
      }
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const err = e as Error
    console.error('[update-cash]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
