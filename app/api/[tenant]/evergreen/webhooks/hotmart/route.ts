import { NextRequest } from 'next/server'
import { compradorHotmart, derivarHotmart, toqueDesdePayloadHotmart } from '@/lib/eventos/hotmart'
import { procesarEntradaCompra } from '@/lib/webhooks/entradaCompras'
import { verificarFirmaHotmart } from '@/lib/webhooks/hotmart'

export const runtime = 'nodejs'
export const maxDuration = 10

// WEBHOOK ENTRANTE DE HOTMART — compras, reembolsos y suscripciones en el momento.
//
// La mitad receptora de la integración de Hotmart (la mitad que sale a buscar datos es el cotejo).
// Todo el esqueleto vive en lib/webhooks/entradaCompras.ts: aquí solo se declara QUÉ firma y QUÉ
// normalizador usa este proveedor.
//
// El Hottok único de la cuenta se copia desde Herramientas → Webhook → Autenticación y se guarda en
// Integraciones → Hotmart → Webhook Secret. Hotmart 2.0 lo manda en `X-HOTMART-HOTTOK`.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  return procesarEntradaCompra({
    req,
    params,
    fuente: 'hotmart',
    verificar: verificarFirmaHotmart,
    derivar: (payload, recibidoEn) => derivarHotmart(payload, recibidoEn),
    extraerComprador: compradorHotmart,
    toqueDesdePayload: toqueDesdePayloadHotmart,
  })
}
