import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'

export const maxDuration = 60

const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: 'require',
  max: 5,
  prepare: false,
  idle_timeout: 20,
})

interface ManualSale {
  email: string
  nombre: string
  apellido: string
  telefono: string | null
  fecha: string                     // YYYY-MM-DD
  valor: number
  tipo_pago: string
  cash_collected: number
  closer_name: string
  setter_name?: string | null
  cobrador_name: string | null
  afiliado_email?: string | null
  status?: 'active' | 'refunded'
  nota?: string
  plataforma?: string | null
}

// ── Hardcoded batch (fechas reales según hoja Compras de mayo 2026) ──────────────────
const BATCH: ManualSale[] = [
  // 05/07
  { fecha: '2026-05-07', nombre: 'Ana',             apellido: 'Cuenca López',                       telefono: '+34 644 39 25 82', email: 'ac.alianzainmobiliaria@gmail.com', valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Ruth Montoya',  cobrador_name: 'Patricia Puerta del Pozo' },
  { fecha: '2026-05-07', nombre: 'Cristina',        apellido: 'Pascual',                            telefono: '+34 620 92 55 75', email: 'crispascualgiloficial@gmail.com',  valor: 300,  tipo_pago: 'Reserva',       cash_collected: 2500,    closer_name: 'Paula',         cobrador_name: 'Andrea Parra',                afiliado_email: 'Rocio Pérez polvillo' },
  { fecha: '2026-05-07', nombre: 'Maria Del Mar',   apellido: 'López Trujillo',                     telefono: '+34 622 64 59 39', email: 'createalas@gmail.com',             valor: 300,  tipo_pago: 'Reserva',       cash_collected: 300,     closer_name: 'Almudena',      cobrador_name: 'Laura Rojo' },
  { fecha: '2026-05-07', nombre: 'Rebeca',          apellido: 'Andrade Montes',                     telefono: '+34 686 35 69 26', email: 'rebekaandrade79@hotmail.com',      valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Ruth Montoya',  cobrador_name: 'Patricia Puerta del Pozo',    afiliado_email: 'Rocio Pérez polvillo' },
  { fecha: '2026-05-07', nombre: 'Concepcion',      apellido: 'Seijas Moreda',                      telefono: '+34 669 69 46 38', email: 'concepcionseijas1@gmail.com',      valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Ana Gonzalez',  setter_name: 'Carmina/María Mora', cobrador_name: 'Rocio Pérez polvillo' },
  // 05/06
  { fecha: '2026-05-06', nombre: 'María Luisa',     apellido: 'riquelme tapia',                     telefono: '+34 624 83 26 92', email: 'marialuisa.riquelmet@gmail.com',   valor: 2500, tipo_pago: '2Pagos',        cash_collected: 1437.50, closer_name: 'Almudena',      setter_name: 'Maria Mora',         cobrador_name: 'Patricia Puerta del Pozo' },
  { fecha: '2026-05-06', nombre: 'Luiza',           apellido: 'Vicente Ferreira',                   telefono: '+34 675 31 87 71', email: 'luizavferreiraes@gmail.com',       valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Ana Gonzalez',  setter_name: 'Maria Mora',         cobrador_name: 'Patricia Puerta del Pozo' },
  { fecha: '2026-05-06', nombre: 'Marta',           apellido: 'Castro Fernández',                   telefono: null,               email: 'lua_1104@hotmail.com',             valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Almudena',      setter_name: 'Tamara Coll',        cobrador_name: 'Laura Rojo' },
  // 05/07 (resto)
  { fecha: '2026-05-07', nombre: 'Yesica',          apellido: 'García Guarch',                      telefono: '+34 639 41 52 33', email: 'yessica_g.g@hotmail.com',          valor: 300,  tipo_pago: 'Reserva',       cash_collected: 597,     closer_name: 'Ruth Montoya',  setter_name: 'Tamara Coll',        cobrador_name: 'Rocio Pérez polvillo' },
  { fecha: '2026-05-07', nombre: 'María Del Pilar', apellido: 'Moreno Reina',                       telefono: '+34 610 86 65 94', email: 'mapymore@hotmail.com',             valor: 300,  tipo_pago: 'Reserva',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: 'Marina García Olivares' },
  { fecha: '2026-05-07', nombre: 'Noemí',           apellido: 'Moscardó',                           telefono: '+34 648 77 61 41', email: 'noemimdh@gmail.com',               valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Ruth Montoya',  cobrador_name: 'Marina García Olivares' },
  { fecha: '2026-05-07', nombre: 'Vanessa',         apellido: 'limeres navarro',                    telefono: null,               email: 'vlimeres@live.com',                valor: 2500, tipo_pago: 'Reserva',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: 'Paula López Vinuesa' },
  { fecha: '2026-05-07', nombre: 'Candy',           apellido: 'Rivero',                             telefono: '+34 637 29 52 34', email: 'candyrp60@gmail.com',              valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Ana Gonzalez',  cobrador_name: 'Laura Rojo' },
  { fecha: '2026-05-07', nombre: 'Raquel',          apellido: 'Faya Arnal',                         telefono: '+34 653 97 09 11', email: 'rachelfaar@gmail.com',             valor: 2500, tipo_pago: 'Reserva',       cash_collected: 675,     closer_name: 'Almudena',      cobrador_name: 'Laura Rojo' },
  { fecha: '2026-05-07', nombre: 'Tania',           apellido: 'Molina Bermejo',                     telefono: '+34 609 84 80 96', email: 'tmolinabermejo@gmail.com',         valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Almudena',      setter_name: 'Tamara Coll',        cobrador_name: 'Ana Saenz' },
  // 05/08
  { fecha: '2026-05-08', nombre: 'Yolanda',         apellido: 'Salvador Sanz',                      telefono: '+34 676 24 35 14', email: 'ysalvadorsanz@gmail.com',          valor: 2500, tipo_pago: 'Reserva',       cash_collected: 2500,    closer_name: 'Gema Huertes',  cobrador_name: 'Laura Rojo' },
  { fecha: '2026-05-08', nombre: 'Alejandra',       apellido: 'Colorado',                           telefono: '+34 600 67 01 64', email: 'alejandracolorado1524@gmail.com',  valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Almudena',      cobrador_name: null },
  { fecha: '2026-05-08', nombre: 'Laura',           apellido: 'Alvarez',                            telefono: '+34 625 78 03 50', email: 'arine26@gmail.com',                valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Ana Gonzalez',  cobrador_name: 'Andrea Parra' },
  { fecha: '2026-05-08', nombre: 'Beatriz',         apellido: 'Burgos Jimenez',                     telefono: '+34 633 15 14 94', email: 'beatrizburgosjimenez5@gmail.com',  valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Almudena',      cobrador_name: 'Patricia Puerta del Pozo', status: 'refunded', nota: 'Solicita reembolso' },
  { fecha: '2026-05-08', nombre: 'Maryuri II',      apellido: '',                                   telefono: null,               email: 'marvela2507@hotmail.com',          valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Paula',         cobrador_name: 'Esperanza Macarena Valero Sánchez' },
  { fecha: '2026-05-08', nombre: 'Lili',            apellido: 'Velazquez',                          telefono: '+34 615 50 57 68', email: 'mercedesarce662@gmail.com',        valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Paula',         cobrador_name: 'Marina García Olivares' },
  { fecha: '2026-05-08', nombre: 'Salome',          apellido: 'Castello',                           telefono: '+34 610 76 72 63', email: 'salomecastelloventura@gmail.com',  valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Ana Gonzalez',  cobrador_name: 'Laura Rojo' },
  { fecha: '2026-05-08', nombre: 'Helenca',         apellido: '',                                   telefono: '+34 653 62 30 43', email: 'helencaa93@gmail.com',             valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: null,                        status: 'refunded', nota: 'Solicita reembolso' },
  { fecha: '2026-05-08', nombre: 'Dayana',          apellido: 'Sánchez henao',                      telefono: '+34 632 73 73 07', email: 'dayih2515@gmail.com',              valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Almudena',      cobrador_name: 'Gema Huertes Álvarez' },
  { fecha: '2026-05-08', nombre: 'Leyre',           apellido: 'Alaguero Gabarri',                   telefono: '+34 649 56 49 32', email: 'l3ir31993@gmail.com',              valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: 'Marina García Olivares' },
  { fecha: '2026-05-08', nombre: 'Paola',           apellido: 'Pascual Valverde',                   telefono: '+34 645 51 10 44', email: 'paovalverde.ugc@gmail.com',        valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Almudena',      setter_name: 'Tamara Coll',        cobrador_name: 'Gema Huertes Álvarez' },
  { fecha: '2026-05-08', nombre: 'Miriam',          apellido: 'Lorenzo juni',                       telefono: '+34 646 63 99 82', email: 'miriamloren26@gmail.com',          valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: 'Laura Rojo',                nota: '2.000€ stripe + 500€ transferencia' },
  // 05/09
  { fecha: '2026-05-09', nombre: 'Isabel',          apellido: 'Cordero',                            telefono: '+34 626 71 35 71', email: 'isacm79@hotmail.com',              valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: 'Paula López Vinuesa',       nota: 'Email duplicado: emprendedorapornaturaleza@gmail.com' },
  { fecha: '2026-05-09', nombre: 'Macarena',        apellido: 'Gallego',                            telefono: '+34 629 57 23 39', email: 'karenxup2279@gmail.com',           valor: 2500, tipo_pago: 'Reserva',       cash_collected: 300,     closer_name: 'Paula',         cobrador_name: 'Esperanza Macarena Valero Sánchez' },
  { fecha: '2026-05-09', nombre: 'Laura',           apellido: 'Cantenys Garriga',                   telefono: '+34 658 18 05 73', email: 'lauracantenys@gmail.com',          valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Paula',         cobrador_name: null },
  { fecha: '2026-05-09', nombre: 'Gloria',          apellido: 'Remedios Alegria',                   telefono: '+34 622 29 14 21', email: 'gloriacarolina4@gmail.com',        valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Gema Huertes',  cobrador_name: 'Esperanza Macarena Valero Sánchez' },
  { fecha: '2026-05-09', nombre: 'Virginia',        apellido: 'Casado',                             telefono: '+34 651 05 09 01', email: 'virginiacbr@gmail.com',            valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Ana Gonzalez',  cobrador_name: 'Rocio Pérez polvillo' },
  // 05/10
  { fecha: '2026-05-10', nombre: 'Sofía',           apellido: 'Carrera Arrieta',                    telefono: '+34 677 60 20 90', email: 'binka_sca@hotmail.com',            valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: null },
  { fecha: '2026-05-10', nombre: 'Sarahna',         apellido: 'Escribano Martínez Escauriaza',      telefono: '+34 671 37 44 50', email: 'sarahna.escribano@gmail.com',      valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: 'Patricia Puerta del Pozo' },
  { fecha: '2026-05-10', nombre: 'Antonia',         apellido: 'Julián Garcia',                      telefono: '+34 603 66 73 78', email: 'tojuliangarcia05@gmail.com',       valor: 2500, tipo_pago: 'Reserva',       cash_collected: 300,     closer_name: 'Almudena',      cobrador_name: 'Rocio Pérez polvillo' },
  { fecha: '2026-05-10', nombre: 'Lorena',          apellido: 'Arjona Hernández',                   telefono: '+34 638 47 45 98', email: 'lorenabcn9@gmail.com',             valor: 2500, tipo_pago: 'Sequra12pagos', cash_collected: 1737.50, closer_name: 'Paula',         cobrador_name: 'Rocio Pérez polvillo' },
  { fecha: '2026-05-10', nombre: 'Clara',           apellido: 'Campos',                             telefono: '+34 665 27 57 33', email: 'clara.campos.domenech@gmail.com',  valor: 2500, tipo_pago: 'FullPay',       cash_collected: 2500,    closer_name: 'Almudena',      cobrador_name: 'Laura Rojo',                nota: 'Transferencia' },
  { fecha: '2026-05-10', nombre: 'Stefanny',        apellido: 'Lozano',                             telefono: '+34 634 49 58 65', email: 'stefannyarts813@gmail.com',        valor: 2500, tipo_pago: 'Sequra6pagos',  cash_collected: 435.66,  closer_name: 'Almudena',      cobrador_name: null },
]

// ── Helpers ─────────────────────────────────────────────────────────────
function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildNameMatcher(items: { id: number; nombre: string }[]) {
  const fullMap = new Map<string, number>()
  const firstMap = new Map<string, number[]>()
  const tokenMap = new Map<string, number[]>()
  for (const it of items) {
    const full = normName(it.nombre)
    if (full) fullMap.set(full, it.id)
    const tokens = full.split(' ').filter(Boolean)
    if (tokens[0]) {
      const arr = firstMap.get(tokens[0]) || []
      arr.push(it.id); firstMap.set(tokens[0], arr)
      for (let len = 3; len <= Math.min(tokens[0].length, 7); len++) {
        const pre = tokens[0].slice(0, len)
        const a = tokenMap.get(pre) || []
        if (!a.includes(it.id)) { a.push(it.id); tokenMap.set(pre, a) }
      }
    }
  }
  return (rawName: string): number | null => {
    if (!rawName) return null
    const primary = rawName.split(/[\/&,;]/)[0]
    const norm = normName(primary)
    if (!norm) return null
    if (fullMap.has(norm)) return fullMap.get(norm)!
    const firstToken = norm.split(' ')[0]
    const firstHits = firstMap.get(firstToken)
    if (firstHits && firstHits.length === 1) return firstHits[0]
    if (firstToken.length >= 3) {
      const prefHits = tokenMap.get(firstToken)
      if (prefHits && prefHits.length === 1) return prefHits[0]
    }
    let fuzzy: number | null = null
    fullMap.forEach((id, full) => {
      if (fuzzy !== null) return
      if (full.includes(norm) || norm.includes(full.split(' ')[0])) {
        if (full.split(' ')[0][0] === firstToken[0]) fuzzy = id
      }
    })
    return fuzzy
  }
}

// ── Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    // ── Step 0: Idempotent schema migrations ─────────────────────────────
    await sql`ALTER TABLE launch_sales ADD COLUMN IF NOT EXISTS setter_id INT REFERENCES cold_callers(id) ON DELETE SET NULL`
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_sales_setter ON launch_sales(setter_id)`
    await sql`ALTER TABLE launch_sales ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`
    await sql`ALTER TABLE launch_sales ADD COLUMN IF NOT EXISTS nota TEXT`
    await sql`CREATE INDEX IF NOT EXISTS idx_launch_sales_status ON launch_sales(status)`

    // ── Step 1: Auto-create missing closers and cold_callers from BATCH ──
    // The user wants the import to be perfect even if a closer/coldcaller
    // hasn't been pre-created in launch_closers/cold_callers. We use a
    // disabled-login placeholder password (cannot log in until reset).
    // Only inserts; never modifies existing rows.
    const DISABLED_HASH = '$2a$10$disabled.placeholder.no.login.hash.xxxxxxxxxxxxxxxxxxxxxxx'
    const slug = (name: string) => name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    const closerNames = Array.from(new Set(BATCH.map(s => s.closer_name).filter(Boolean)))
    const ccNames = Array.from(new Set(
      BATCH.flatMap(s => [s.cobrador_name, s.setter_name].filter((x): x is string => !!x))
    ))

    // Read existing first to know who's missing (case-insensitive on normalised name)
    const [existingClosers, existingCCs] = await Promise.all([
      sql<{ id: number; nombre: string }[]>`SELECT id, nombre FROM launch_closers`,
      sql<{ id: number; nombre: string }[]>`SELECT id, nombre FROM cold_callers`,
    ])

    let createdClosers = 0
    let createdCCs = 0
    {
      const matchExistingCloser = buildNameMatcher(existingClosers)
      for (const name of closerNames) {
        if (matchExistingCloser(name)) continue
        const email = `${slug(name)}@placeholder.thecloserclub.local`
        try {
          const r = await sql<{ id: number }[]>`
            INSERT INTO launch_closers (email, nombre, password_hash, activa)
            VALUES (${email}, ${name}, ${DISABLED_HASH}, TRUE)
            ON CONFLICT (email) DO NOTHING
            RETURNING id
          `
          if (r.length > 0) createdClosers++
        } catch (e) { /* ignore */ }
      }
      const matchExistingCC = buildNameMatcher(existingCCs)
      for (const name of ccNames) {
        // The fuzzy matcher will treat "Carmina/María Mora" by taking the
        // primary segment before /. We replicate that here so we don't create
        // a phantom row "Carmina/María Mora" — instead we ensure "Carmina" exists.
        const primary = name.split(/[\/&,;]/)[0].trim()
        if (matchExistingCC(primary)) continue
        const email = `${slug(primary)}@placeholder.thecloserclub.local`
        try {
          const r = await sql<{ id: number }[]>`
            INSERT INTO cold_callers (email, nombre, password_hash, activa, peso)
            VALUES (${email}, ${primary}, ${DISABLED_HASH}, TRUE, 100)
            ON CONFLICT (email) DO NOTHING
            RETURNING id
          `
          if (r.length > 0) createdCCs++
        } catch (e) { /* ignore */ }
      }
    }

    // ── Step 2: Reload matchers (now that missing rows exist) and leads ──
    const [closers, ccs, leads] = await Promise.all([
      sql<{ id: number; nombre: string }[]>`SELECT id, nombre FROM launch_closers`,
      sql<{ id: number; nombre: string }[]>`SELECT id, nombre FROM cold_callers`,
      sql<{
        email: string; telefono: string;
        utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
        utm_content: string | null; utm_term: string | null;
      }[]>`SELECT email, telefono, utm_source, utm_medium, utm_campaign, utm_content, utm_term FROM leads_cache`,
    ])

    const matchCloser = buildNameMatcher(closers)
    const matchCC     = buildNameMatcher(ccs)

    const leadByEmail = new Map<string, typeof leads[number]>()
    for (const l of leads) if (l.email) leadByEmail.set(l.email.toLowerCase(), l)

    const result = {
      total: BATCH.length,
      inserted: 0,
      updated: 0,
      refunded_inserted: 0,
      deleted_existing: 0,
      created_closers: createdClosers,
      created_coldcallers: createdCCs,
      unmatched_closer: [] as string[],
      unmatched_cobrador: [] as string[],
      unmatched_setter: [] as string[],
      unmatched_lead: [] as string[],
      errors: [] as string[],
      details: [] as { email: string; status: string; closer_id?: number | null; coldcaller_id?: number | null; setter_id?: number | null }[],
    }

    // ── Step 3: UPSERT each sale (non-destructive) ──────────────────────
    for (const s of BATCH) {
      const fecha = s.fecha
      const email = s.email.toLowerCase()
      const status = s.status ?? 'active'

      const closerId = matchCloser(s.closer_name)
      if (!closerId) {
        result.unmatched_closer.push(s.closer_name)
        result.details.push({ email, status: `closer_sin_match (${s.closer_name})` })
        continue
      }

      const cobradorId = s.cobrador_name ? matchCC(s.cobrador_name) : null
      if (!cobradorId && s.cobrador_name) result.unmatched_cobrador.push(s.cobrador_name)

      const setterId = s.setter_name ? matchCC(s.setter_name) : null
      if (!setterId && s.setter_name) result.unmatched_setter.push(s.setter_name)

      const lead = leadByEmail.get(email) || null
      if (!lead) result.unmatched_lead.push(email)

      // Afiliado: prefer explicit, else if lead came via afiliación use utm_content
      const isAfil = lead?.utm_medium?.toLowerCase().includes('afiliaci') ?? false
      const utmAfilEmail = isAfil ? (lead?.utm_content || null) : null
      const afiliadoEmail = s.afiliado_email || utmAfilEmail

      try {
        // Manual UPSERT: check if a row with this email already exists,
        // then UPDATE or INSERT accordingly. Avoids requiring a UNIQUE
        // index on email and works even if there are pre-existing dupes.
        const existing = await sql<{ id: number }[]>`
          SELECT id FROM launch_sales WHERE LOWER(email) = ${email} ORDER BY id DESC LIMIT 1
        `

        if (existing.length > 0) {
          // UPDATE — overwrite sheet-derived fields, preserve user notes
          // and existing UTMs/lead_email if BATCH has nothing better.
          await sql`
            UPDATE launch_sales SET
              fecha          = ${fecha},
              nombre         = ${s.nombre},
              apellido       = ${s.apellido},
              telefono       = COALESCE(${s.telefono || null}, telefono),
              plataforma     = COALESCE(${s.plataforma ?? null}, plataforma),
              valor          = ${s.valor},
              tipo_pago      = ${s.tipo_pago},
              cash_collected = ${s.cash_collected},
              closer_id      = ${closerId},
              coldcaller_id  = ${cobradorId},
              setter_id      = ${setterId},
              lead_email     = COALESCE(${lead?.email || null}, lead_email),
              afiliado_email = COALESCE(${afiliadoEmail}, afiliado_email),
              utm_source     = COALESCE(${lead?.utm_source ?? null}, utm_source),
              utm_medium     = COALESCE(${lead?.utm_medium ?? null}, utm_medium),
              utm_campaign   = COALESCE(${lead?.utm_campaign ?? null}, utm_campaign),
              utm_content    = COALESCE(${lead?.utm_content ?? null}, utm_content),
              utm_term       = COALESCE(${lead?.utm_term ?? null}, utm_term),
              status         = ${status},
              nota           = COALESCE(nota, ${s.nota ?? null}),
              updated_at     = NOW()
            WHERE id = ${existing[0].id}
          `
          result.updated++
          result.details.push({
            email, status: 'actualizada',
            closer_id: closerId, coldcaller_id: cobradorId, setter_id: setterId,
          })
        } else {
          // INSERT — fresh row
          await sql`
            INSERT INTO launch_sales (
              fecha, nombre, apellido, telefono, email, plataforma, valor, tipo_pago, cash_collected,
              closer_id, coldcaller_id, setter_id, lead_email, afiliado_email,
              utm_source, utm_medium, utm_campaign, utm_content, utm_term, status, nota
            ) VALUES (
              ${fecha}, ${s.nombre}, ${s.apellido}, ${s.telefono || lead?.telefono || null}, ${email},
              ${s.plataforma ?? null}, ${s.valor}, ${s.tipo_pago}, ${s.cash_collected},
              ${closerId}, ${cobradorId}, ${setterId}, ${lead?.email || null}, ${afiliadoEmail},
              ${lead?.utm_source ?? null}, ${lead?.utm_medium ?? null}, ${lead?.utm_campaign ?? null},
              ${lead?.utm_content ?? null}, ${lead?.utm_term ?? null}, ${status}, ${s.nota ?? null}
            )
          `
          if (status === 'refunded') result.refunded_inserted++
          else result.inserted++
          result.details.push({
            email, status: status === 'refunded' ? 'devuelta' : 'insertada',
            closer_id: closerId, coldcaller_id: cobradorId, setter_id: setterId,
          })
        }
      } catch (e) {
        const msg = (e as Error).message
        result.errors.push(`${email}: ${msg}`)
        result.details.push({ email, status: `error: ${msg}` })
      }
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const err = e as Error
    console.error('[import-batch]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
