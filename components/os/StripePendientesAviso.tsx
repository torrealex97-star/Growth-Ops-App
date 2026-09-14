'use client'

// "VENTAS = vacío" y "ALUMNAS = vacío" con Stripe lleno de clientes NO es un bug del importador: es
// una decisión pendiente que nadie ve.
//
// LA CADENA REAL: Alumnas lee `sales`. `sales` no se llena sola desde Stripe porque `product_id` y
// `payment_plan_id` son NOT NULL y un pago de Stripe no dice a qué producto interno corresponde ni
// con qué plan — crear la venta automáticamente sería elegirlos, o sea inventar datos financieros
// (ver lib/finance/stripeBackfill.ts y la tercera regla de AGENTS.md). Así que hay un flujo donde una
// persona decide, y está en Integraciones › Stripe.
//
// El fallo, entonces, no es el importador: es que la pantalla decía "No hay ventas" a secas. Quien
// mira Ventas no tiene forma de saber que hay 312 clientes de Stripe esperando una decisión suya, ni
// a dónde ir. Un hueco sin explicar se lee como "esto no funciona".
//
// Este aviso no registra nada ni adivina nada: cuenta lo que hay y enlaza a donde se decide.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowRight, Info } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Props = {
  tenant: string
  /** Qué está vacío, para redactar la frase. */
  contexto: 'ventas' | 'alumnas'
}

export function StripePendientesAviso({ tenant, contexto }: Props) {
  const [pendientes, setPendientes] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    const cargar = async () => {
      const sb = createClient()
      // Cuenta local y barata: clientes de Stripe ya sincronizados que están ligados a un contacto.
      // No se llama a Stripe desde aquí — eso es trabajo del informe, que sí pagina y sí tarda.
      const { count, error } = await sb
        .from('stripe_customers')
        .select('id', { count: 'exact', head: true })
        .not('contact_id', 'is', null)
      // Si la consulta falla no se inventa un 0: simplemente no se muestra el aviso.
      if (vivo) setPendientes(error ? null : (count ?? 0))
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [])

  if (pendientes === null || pendientes === 0) return null

  return (
    <div className="border-border bg-card/60 mx-auto mt-4 max-w-xl rounded-xl border p-4 text-left">
      <div className="flex items-start gap-3">
        <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="text-foreground text-sm font-medium">
            Hay {pendientes} {pendientes === 1 ? 'cliente' : 'clientes'} de Stripe sincronizados
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {contexto === 'ventas'
              ? 'Sus pagos no se convierten en ventas solos: un pago de Stripe no dice a qué producto ni a qué plan corresponde, y elegirlo por ti sería inventar el importe comisionable y el plazo de devolución.'
              : 'Una alumna aparece aquí cuando tiene una venta registrada. Los pagos de Stripe no se convierten en ventas solos: hay que decir a qué producto y plan corresponde cada uno.'}{' '}
            En el buscador de pagos sin registrar eliges producto y plan una vez y se registran con el importe real de
            cada pago.
          </p>
          <Link
            href={`/${tenant}/settings/integraciones?integracion=stripe`}
            className="text-primary mt-2 inline-flex items-center gap-1 text-sm hover:underline"
          >
            Buscar pagos sin registrar
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  )
}
