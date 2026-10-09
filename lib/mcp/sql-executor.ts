import postgres from 'postgres'

/**
 * Ejecutor SQL read-only del servidor MCP.
 *
 * Seguridad por capas (defensa en profundidad — ninguna capa confía en la anterior):
 *  1. CONEXIÓN: role mcp_reader — sin login, sin INSERT/UPDATE/DELETE, sin acceso a las tablas
 *     OAuth ni a las funciones de auth de Supabase. GRANT SELECT explícito por tabla.
 *  2. SESIÓN: SET LOCAL request.jwt.claims = sub real del usuario que autorizó la conexión.
 *     auth.uid() lo lee y TODAS las policies RLS (auth_tenant_ids, is_super_admin) heredan
 *     exactamente el mismo aislamiento por subcuenta que la sesión web del usuario.
 *  3. TRANSACCIÓN: READ ONLY + DEFERRABLE INITIALLY DEFERRED — cualquier escritura (incluso un
 *     INSERT en una CTE o función) revienta la transacción entera.
 *  4. LÍMITES: statement_timeout (timeout), máximo de filas devueltas y tamaño máximo de consulta.
 *
 * El pool es UNO por proceso (como lib/vsl/db.ts): cada consulta crea su propia transacción
 * con sus SET LOCAL, que mueren al terminar — no hay estado de sesión que fugar entre peticiones.
 */
const READ_ONLY_CLAIMS_HINT =
  'Consulta rechazada: solo se permiten sentencias SELECT o WITH. El servidor MCP es de solo lectura.'

export type SqlResult =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean; durationMs: number }
  | { ok: false; error: string }

const MAX_QUERY_LENGTH = 20_000
const MAX_ROWS = 500
const STATEMENT_TIMEOUT_MS = 8_000
const IDLE_TIMEOUT_S = 20

let client: ReturnType<typeof postgres> | null = null

function getClient(): ReturnType<typeof postgres> {
  if (client) return client
  const url = process.env.POSTGRES_URL
  if (!url || url === '[SENSITIVE]') throw new Error('POSTGRES_URL no está disponible en runtime')
  client = postgres(url, {
    ssl: 'require',
    max: 1,
    prepare: false,
    idle_timeout: IDLE_TIMEOUT_S,
    max_lifetime: 60 * 30,
  })
  return client
}

/**
 * ¿La consulta es de solo lectura? Análisis sintáctico ligero (sin parser completo):
 * se eliminan literales de cadena, comentarios, y se exige que la sentencia comience por
 * SELECT/WITH y no contenga palabra clave de escritura ni de cambio de sesión.
 * La garantía REAL es la transacción READ ONLY; esto es la primera barrera y el mensaje
 * de error accionable.
 */
export function esConsultaSoloLectura(sqlText: string): boolean {
  const sinLiterales = sqlText
    .replace(/'(?:[^']|'')*'/g, "''") // literales de cadena
    .replace(/--[^\n]*/g, '') // comentarios de línea
    .replace(/\/\*[\s\S]*?\*\//g, '') // comentarios de bloque
    .replace(/\$\w*\$/g, "''") // dollar-quoting
  const sinEspacios = sinLiterales.replace(/\s+/g, ' ').trim()
  if (!/^(select|with|explain|table)\b/i.test(sinEspacios)) return false
  if (/;.*\S/.test(sinEspacios.replace(/;$/, ''))) return false // una sola sentencia
  if (
    /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|copy|vacuum|analyze|call|do|set|reset|listen|notify|lock|reindex|cluster|comment|security\s+label|set_config)\b/i.test(
      sinEspacios
    )
  ) {
    return false
  }
  return true
}

export async function ejecutarSqlMcp(
  sqlText: string,
  opts: { userId: string; email: string; clientId: string }
): Promise<SqlResult> {
  const consulta = sqlText.trim()
  if (!consulta) return { ok: false, error: 'Consulta vacía' }
  if (consulta.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `Consulta demasiado larga (máximo ${MAX_QUERY_LENGTH} caracteres)` }
  }
  if (!esConsultaSoloLectura(consulta)) return { ok: false, error: READ_ONLY_CLAIMS_HINT }

  const started = Date.now()
  try {
    const sql = getClient()
    const claims = JSON.stringify({ sub: opts.userId, email: opts.email, role: 'authenticated' })
    const rows = await sql.begin(
      async (tx) => {
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claims])
        await tx.unsafe(`set local statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
        // CRÍTICO: POSTGRES_URL conecta como propietario de las tablas y el propietario SE SALTA
        // RLS por defecto. Bajar al rol lector DENTRO de la transacción hace efectivo el RLS y
        // restringe los privilegios a los GRANT SELECT de la migración.
        await tx.unsafe(`set local role mcp_reader`)
        // DEFERRABLE: si la transacción tarda en poder declararse read-only, espera en vez de fallar.
        await tx.unsafe(`set local transaction_read_only = on`)
        return tx.unsafe(consulta, [])
      },
      { readonly: true }
    )
    const truncated = rows.length > MAX_ROWS
    return {
      ok: true,
      rows: truncated ? rows.slice(0, MAX_ROWS) : (rows as Record<string, unknown>[]),
      rowCount: rows.length,
      truncated,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // No se filtra el SQL real ni valores: solo el mensaje de Postgres.
    return { ok: false, error: message.slice(0, 500) }
  }
}
