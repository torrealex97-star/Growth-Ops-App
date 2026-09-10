// Cliente mínimo para el servidor MCP remoto de sequra (protocolo JSON-RPC sobre HTTP,
// sin sesión persistente — cada llamada lleva su propio Authorization Bearer).
// Reemplaza, para uso server-to-server, a las herramientas mcp__sequra__* usadas
// interactivamente en Claude. Ver PENDIENTES.md / migration-v50 para contexto.
//
// SEQURA_MCP_TOKEN caduca (es un JWT ligado a una sesión de usuario) — cuando el
// cron empiece a fallar con 401, hay que generar un token nuevo y actualizarlo en Vercel.

const SEQURA_MCP_URL = 'https://simba.sequra.com/mcp'

class SequraApiError extends Error {}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const token = process.env.SEQURA_MCP_TOKEN
  if (!token) throw new SequraApiError('Falta SEQURA_MCP_TOKEN')

  const res = await fetch(SEQURA_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })

  if (!res.ok) {
    throw new SequraApiError(`sequra MCP respondió ${res.status}: ${await res.text()}`)
  }

  const json = await res.json()
  if (json.error) {
    throw new SequraApiError(`sequra MCP error: ${json.error.message ?? JSON.stringify(json.error)}`)
  }

  const text = json.result?.content?.[0]?.text
  if (typeof text !== 'string') {
    throw new SequraApiError('Respuesta inesperada de sequra MCP (sin content[0].text)')
  }
  if (json.result?.isError) {
    throw new SequraApiError(`sequra tool error: ${text}`)
  }
  return text
}

export type SequraOrderSummary = {
  reference: string
  status: 'confirmed' | 'shipped' | 'partially_shipped' | 'cancelled'
}

const SUMMARY_LINE_RE = /^\d+\.\s+(\S+)\s+-\s+[\d.]+\s+\S+\s+\([\d-]+\)\s+\[(\w+)\]\s+-\s+\S+\s*$/
const TOTAL_RE = /of\s+(\d+)\s+total/

// Pagina automáticamente hasta traer todos los pedidos del merchant.
export async function searchAllOrders(merchantReference: string): Promise<SequraOrderSummary[]> {
  const orders: SequraOrderSummary[] = []
  const limit = 100
  let offset = 0
  let total = Infinity

  while (offset < total) {
    const text = await callTool('search_orders_tool', {
      merchant_reference: merchantReference,
      from_date: '2000-01-01',
      limit,
      offset,
    })
    const totalMatch = text.match(TOTAL_RE)
    if (totalMatch) total = Number(totalMatch[1])
    else total = 0

    for (const line of text.split('\n')) {
      const m = line.match(SUMMARY_LINE_RE)
      if (m) orders.push({ reference: m[1], status: m[2] as SequraOrderSummary['status'] })
    }

    if (total === 0 || orders.length >= total) break
    offset += limit
  }

  return orders
}

export type SequraOrderDetail = {
  primaryReference: string
  merchantReference: string
  customerName: string | null
  customerEmail: string | null
  productName: string | null
  orderValueCents: number
  debtCents: number
  overdueDays: number | null
  overdueFrom: string | null
  balanceCents: number
}

export async function showOrder(primaryReference: string): Promise<SequraOrderDetail> {
  const text = await callTool('show_order_tool', { primary_reference: primaryReference })
  const parsed = JSON.parse(text) as { order: Record<string, unknown> }
  const o = parsed.order
  const cartItems = (o.cart_items as { name?: string }[] | undefined) ?? []
  return {
    primaryReference: String(o.primary_reference),
    merchantReference: String((o.merchant as { reference?: string } | undefined)?.reference ?? ''),
    customerName: (o.customer as { name?: string } | undefined)?.name ?? null,
    customerEmail: (o.customer as { email?: string } | undefined)?.email ?? null,
    productName: cartItems[0]?.name ?? null,
    orderValueCents: Number(o.current_order_value ?? 0),
    debtCents: Number(o.debt ?? 0),
    overdueDays: o.overdue_days != null ? Number(o.overdue_days) : null,
    overdueFrom: (o.overdue_from as string | undefined) ?? null,
    balanceCents: Number(o.balance ?? 0),
  }
}
