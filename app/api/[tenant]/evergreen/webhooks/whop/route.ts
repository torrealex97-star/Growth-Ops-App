import { NextRequest } from 'next/server'
import { compradorWhop, derivarWhop, toqueDesdePayloadWhop } from '@/lib/eventos/whop'
import { procesarEntradaCompra } from '@/lib/webhooks/entradaCompras'
import { verificarFirmaWhop } from '@/lib/webhooks/whop'

export const runtime = 'nodejs'
export const maxDuration = 10

// WEBHOOK ENTRANTE DE WHOP — pagos, reembolsos y membresías en el momento.
//
// La mitad receptora de la integración de Whop. Todo el esqueleto vive en
// lib/webhooks/entradaCompras.ts; aquí solo se declara QUÉ firma y QUÉ normalizador usa este
// proveedor (Standard Webhooks: webhook-id + webhook-timestamp + webhook-signature v1).
//
// El signing secret (`ws_…`) lo da Whop al crear el webhook y se guarda en Integraciones → Whop →
// Webhook Secret. Whop exige responder 2xx en menos de 5 s: el motor no hace llamadas externas,
// solo escrituras a Supabase.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  return procesarEntradaCompra({
    req,
    params,
    fuente: 'whop',
    verificar: verificarFirmaWhop,
    derivar: (payload, recibidoEn, idCabecera) => derivarWhop(payload, recibidoEn, idCabecera),
    extraerComprador: compradorWhop,
    toqueDesdePayload: toqueDesdePayloadWhop,
  })
}
