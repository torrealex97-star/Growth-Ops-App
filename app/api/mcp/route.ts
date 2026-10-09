/**
 * Endpoint MCP (Model Context Protocol) — JSON-RPC 2.0 por HTTP streamable.
 *
 * Autenticación: Bearer JWT HS256 emitido por el propio servidor OAuth 2.1 de esta app
 * (lib/mcp/oauth.ts). El JWT lleva el user_id real de Supabase; el ejecutor SQL lo inyecta
 * en request.jwt.claims y el RLS hace el resto — el modelo ve exactamente las filas que
 * ve la sesión web de quien conectó el cliente, ni una más.
 *
 * Herramientas expuestas:
 *  - list_tenants: subcuentas visibles para el usuario.
 *  - query_db: SQL read-only (SELECT/WITH) con límite de filas y timeout.
 *  - describe_table: columnas de una tabla (information_schema) para autocompletar consultas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { validarAccessToken } from '@/lib/mcp/oauth'
import { ejecutarSqlMcp } from '@/lib/mcp/sql-executor'

const PROTOCOL_VERSION = '2025-06-18'
const MCP_JWT_SECRET = () => process.env.MCP_JWT_SECRET
const JSON_RPC_HEADERS = {
  'Content-Type': 'application/json',
  'MCP-Protocol-Version': PROTOCOL_VERSION,
}

function jsonRpc(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

type RpcBody = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }

async function autenticar(request: NextRequest): Promise<{ userId: string; email: string; clientId: string } | NextResponse> {
  const secret = MCP_JWT_SECRET()
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { error: 'Servidor MCP sin MCP_JWT_SECRET configurado. Configúralo en Vercel (≥32 caracteres).' },
      { status: 503 }
    )
  }
  const header = request.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Falta el Bearer token. Conecta el cliente MCP vía OAuth en /api/mcp/oauth/authorize.' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="mcp"' } }
    )
  }
  // Validación canónica única (lib/mcp/oauth.ts): firma + jti presente en BD y no revocado.
  // Comprobar contra BD es lo que permite revocar sesiones sin esperar a que caduque el token.
  const sesion = await validarAccessToken(header.slice(7).trim())
  if (!sesion) return NextResponse.json({ error: 'Token inválido, revocado o caducado' }, { status: 401 })
  return sesion
}

async function handleInitialize(id: unknown) {
  return NextResponse.json(
    jsonRpc(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'growth-ops-mcp', version: '1.0.0' },
    }),
    { headers: JSON_RPC_HEADERS }
  )
}

async function handleToolsList(id: unknown) {
  return NextResponse.json(
    jsonRpc(id, {
      tools: [
        {
          name: 'list_tenants',
          description:
            'Lista las subcuentas (tenants) visibles para el usuario que autorizó esta conexión MCP. Devuelve id, slug, nombre y estado.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'query_db',
          description:
            'Ejecuta una consulta SQL de SOLO LECTURA (SELECT o WITH) sobre la base de datos de la app, con el aislamiento por subcuenta del usuario. Máximo 500 filas y 8 segundos por consulta. Las tablas principales: tenants, users, contacts, appointments, sales, collections, payment_plans, refunds, commissions, campaigns, contact_attributions, canonical_events, funnels, contracts, integration_sync_runs, stripe_payments.',
          inputSchema: {
            type: 'object',
            properties: {
              sql: { type: 'string', description: 'Consulta SQL de solo lectura. Una sola sentencia.' },
            },
            required: ['sql'],
            additionalProperties: false,
          },
        },
        {
          name: 'describe_table',
          description: 'Devuelve las columnas de una tabla pública (nombre, tipo, nulo) para saber qué consultar.',
          inputSchema: {
            type: 'object',
            properties: { table: { type: 'string', description: 'Nombre exacto de la tabla' } },
            required: ['table'],
            additionalProperties: false,
          },
        },
      ],
    }),
    { headers: JSON_RPC_HEADERS }
  )
}

async function handleToolCall(id: unknown, name: unknown, args: Record<string, unknown>, userId: string, email: string) {
  if (name === 'list_tenants') {
    const result = await ejecutarSqlMcp('select id, slug, name, status, created_at from tenants order by name', {
      userId,
      email,
      clientId: 'list_tenants',
    })
    if (!result.ok) return NextResponse.json(jsonRpcError(id, -32000, result.error), { headers: JSON_RPC_HEADERS })
    return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] }), {
      headers: JSON_RPC_HEADERS,
    })
  }

  if (name === 'describe_table') {
    const table = String(args.table ?? '')
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
      return NextResponse.json(jsonRpcError(id, -32602, 'Nombre de tabla inválido'), { headers: JSON_RPC_HEADERS })
    }
    const result = await ejecutarSqlMcp(
      `select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='${table}' order by ordinal_position`,
      { userId, email, clientId: 'describe_table' }
    )
    if (!result.ok) return NextResponse.json(jsonRpcError(id, -32000, result.error), { headers: JSON_RPC_HEADERS })
    if (result.rowCount === 0) {
      return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: `Tabla desconocida: ${table}` }] }), {
        headers: JSON_RPC_HEADERS,
      })
    }
    return NextResponse.json(jsonRpc(id, { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] }), {
      headers: JSON_RPC_HEADERS,
    })
  }

  if (name === 'query_db') {
    const sqlText = String(args.sql ?? '')
    const result = await ejecutarSqlMcp(sqlText, { userId, email, clientId: 'query_db' })
    if (!result.ok) return NextResponse.json(jsonRpcError(id, -32000, result.error), { headers: JSON_RPC_HEADERS })
    const meta = `— ${result.rowCount} filas en ${result.durationMs} ms${result.truncated ? ' (TRUNCADO a 500: afina el filtro o añade LIMIT)' : ''}`
    return NextResponse.json(
      jsonRpc(id, {
        content: [
          { type: 'text', text: result.rows.length ? JSON.stringify(result.rows, null, 2) : 'Sin filas.' },
          { type: 'text', text: meta },
        ],
      }),
      { headers: JSON_RPC_HEADERS }
    )
  }

  return NextResponse.json(jsonRpcError(id, -32602, `Herramienta desconocida: ${String(name)}`), {
    headers: JSON_RPC_HEADERS,
  })
}

export async function POST(request: NextRequest) {
  // Detección de sesión activa para degradar con 401 accionable (no para autorizar: quien
  // decide es el Bearer token MCP).
  let body: RpcBody
  try {
    body = (await request.json()) as RpcBody
  } catch {
    return NextResponse.json(jsonRpcError(null, -32700, 'JSON inválido'), { status: 400 })
  }
  const id = body.id ?? null
  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return NextResponse.json(jsonRpcError(id, -32600, 'Petición JSON-RPC inválida'), { status: 400 })
  }

  const auth = await autenticar(request)
  if (auth instanceof NextResponse) return auth
  const { userId, email } = auth

  switch (body.method) {
    case 'initialize':
      return handleInitialize(id)
    case 'notifications/initialized':
      return new NextResponse(null, { status: 202 })
    case 'tools/list':
      return handleToolsList(id)
    case 'tools/call':
      return handleToolCall(id, body.params?.name, (body.params?.arguments as Record<string, unknown>) ?? {}, userId, email)
    case 'ping':
      return NextResponse.json(jsonRpc(id, {}), { headers: JSON_RPC_HEADERS })
    default:
      return NextResponse.json(jsonRpcError(id, -32601, `Método no soportado: ${body.method}`), {
        status: 404,
        headers: JSON_RPC_HEADERS,
      })
  }
}

export async function GET() {
  // Sin SSE por ahora: los clientes modernos (Claude, ChatGPT) usan POST streamable.
  // Un GET informa de cómo conectarse — nunca expone nada.
  return NextResponse.json(
    {
      server: 'growth-ops-mcp',
      transport: 'streamable-http',
      endpoints: { mcp: 'POST /api/mcp', oauth: '/api/mcp/oauth/*', discovery: '/.well-known/oauth-protected-resource' },
      note: 'Autentícate vía OAuth 2.1 y envía JSON-RPC por POST con el Bearer token.',
    },
    { headers: JSON_RPC_HEADERS }
  )
}
