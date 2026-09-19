// CONTROL DE PAGOS POR PERSONA — capa semántica pura (sin imports, testeable directo).
//
// REGLAS DE NEGOCIO (brief del usuario, 19-sep):
//   · Cobros < 100 € = RESERVA (de pago aparte o asumida dentro de un plan).
//   · Reserva DEVUELTA + plan que no encaja con el precio completo → el plan ASUMIÓ la reserva
//     (total del plan = producto − reserva).
//   · Reserva devuelta y NADA más → NO es cliente (se lista aparte).
//   · Suscripción: cuotas iguales mensuales → cuántas van, cuántas faltan, impagos.
//   · El dinero REAL es el espejo; el interno (collections/sales) es registro administrativo.

export type PagoEspejo = {
  payment_id: string
  charge_id: string | null
  customer_id: string | null
  amount: number
  refunded_amount: number
  status: string
  paid_at: string | null
  /** coincidió con un cobro interno por payment_reference (pi_/ch_) */
  ref_interna: string | null
}

export type ClienteStripe = {
  stripe_customer_id: string
  contact_id: string | null
  email: string | null
  name: string | null
  status: string | null
}

export type VentaInterna = {
  id: string
  contact_id: string | null
  gross_amount: number
  status: string
  sale_date: string | null
}

export type CobroInterno = {
  id: string
  sale_id: string
  gross_amount: number
  status: string
  payment_reference: string | null
  collected_at: string | null
}

export type Producto = { id: string; name: string; duration_months: number | null }

export type EntradaPersona = {
  key: string
  nombre: string
  email: string | null
  contact_id: string | null
  customer_ids: string[]
  pagos: PagoEspejo[]
  clientes: ClienteStripe[]
  ventas: VentaInterna[]
  cobros: CobroInterno[]
}

export type ClasificacionPersona =
  | 'cliente_activo'
  | 'cliente_completado'
  | 'suscripcion'
  | 'plan_a_plazos'
  | 'reserva_pendiente'
  | 'reserva_devuelta'
  | 'solo_interno'

export type PersonaPagos = {
  key: string
  nombre: string
  email: string | null
  contact_id: string | null
  customerIds: string[]
  estadoCliente: ClasificacionPersona
  netoPagado: number
  devuelto: number
  reservasPagadas: number
  reservasDevueltas: number
  reservaAsumidaEnPlan: boolean
  totalPlan: number | null
  precioProducto: number | null
  nombreProducto: string | null
  cuotasPagadas: number
  cuotasTotales: number | null
  importeCuota: number | null
  impagos: number
  primeraCuota: string | null
  ultimaCuota: string | null
  ventaId: string | null
  detalle: PagoResumen[]
}

export type PagoResumen = {
  payment_id: string
  fecha: string | null
  importe: number
  devuelto: number
  neto: number
  esReserva: boolean
  estado: 'pagado' | 'devuelto' | 'devuelto_parcial'
  refInterna: string | null
}

/** Umbral de reserva: cobros por debajo de este importe son reserva (brief: <100 €). */
export const RESERVA_MAX_EUR = 100

const n2 = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const mismaCantidad = (a: number, b: number): boolean => Math.abs(a - b) < 0.02

/** Agrupa los pagos del espejo por persona y ata el resto de registros. */
export function agruparPersonas(
  pagos: PagoEspejo[],
  clientes: ClienteStripe[],
  contactos: { id: string; full_name: string; email: string | null }[],
  ventas: VentaInterna[],
  cobros: CobroInterno[],
  _productos: Producto[]
): EntradaPersona[] {
  void _productos
  const clientePorId = new Map(clientes.map((c) => [c.stripe_customer_id, c]))
  const contactoPorId = new Map(contactos.map((c) => [c.id, c]))
  const refsInternas = new Map<string, CobroInterno>()
  for (const c of cobros) {
    const ref = (c.payment_reference || '').trim()
    if (ref.startsWith('pi_') || ref.startsWith('ch_')) refsInternas.set(ref, c)
  }

  const mapa = new Map<string, EntradaPersona>()

  const asegurar = (key: string, datos: Partial<EntradaPersona>): EntradaPersona => {
    let e = mapa.get(key)
    if (!e) {
      e = {
        key,
        nombre: datos.nombre ?? '—',
        email: datos.email ?? null,
        contact_id: datos.contact_id ?? null,
        customer_ids: [],
        pagos: [],
        clientes: [],
        ventas: [],
        cobros: [],
      }
      mapa.set(key, e)
    }
    return e
  }

  // 1. PAGOS REALES: la fuente de la verdad. Cada pago pertenece a una persona.
  for (const p of pagos) {
    let entrada: EntradaPersona | undefined
    if (p.customer_id) {
      const cli = clientePorId.get(p.customer_id)
      if (cli) {
        const contactId = cli.contact_id ?? null
        const contacto = contactId ? contactoPorId.get(contactId) : undefined
        const key = contactId ?? cli.email?.trim().toLowerCase() ?? cli.stripe_customer_id
        entrada = asegurar(key, {
          nombre: contacto?.full_name || cli.name || cli.email || '—',
          email: cli.email,
          contact_id: contactId,
        })
        if (!entrada.customer_ids.includes(p.customer_id)) entrada.customer_ids.push(p.customer_id)
        if (!entrada.clientes.some((c) => c.stripe_customer_id === cli.stripe_customer_id)) entrada.clientes.push(cli)
      }
    }
    if (!entrada && p.ref_interna) {
      const c = refsInternas.get(p.ref_interna)
      if (c) {
        const venta = ventas.find((v) => v.id === c.sale_id)
        const contacto = venta?.contact_id ? contactoPorId.get(venta.contact_id) : undefined
        const key = venta?.contact_id ?? `ref:${p.payment_id}`
        entrada = asegurar(key, {
          nombre: contacto?.full_name ?? '—',
          contact_id: venta?.contact_id ?? null,
        })
      }
    }
    if (!entrada) entrada = asegurar(`huerfano:${p.payment_id}`, { nombre: '(sin identificar)' })
    entrada.pagos.push(p)
  }

  // 2. CLIENTES STRIPE sin pagos en el espejo (solo identidad)
  for (const cli of clientes) {
    if (!cli.contact_id || mapa.has(cli.contact_id)) continue
    const contacto = contactoPorId.get(cli.contact_id)
    asegurar(cli.contact_id, {
      nombre: contacto?.full_name || cli.name || cli.email || '—',
      email: cli.email,
      contact_id: cli.contact_id,
    })
  }

  // 3. VENTAS INTERNAS de personas que aún no tienen entrada por pago real
  for (const v of ventas) {
    if (!v.contact_id || mapa.has(v.contact_id)) continue
    const contacto = contactoPorId.get(v.contact_id)
    asegurar(v.contact_id, {
      nombre: contacto?.full_name ?? '—',
      email: contacto?.email ?? null,
      contact_id: v.contact_id,
    })
  }

  // 4. Completar ventas/cobros de las entradas con contacto (el producto lo resuelve la ruta)
  for (const e of mapa.values()) {
    if (!e.contact_id) continue
    e.ventas = ventas.filter((v) => v.contact_id === e.contact_id)
    e.cobros = cobros.filter((c) => e.ventas.some((v) => v.id === c.sale_id))
  }
  return [...mapa.values()]
}

/**
 * Clasifica una persona y calcula sus métricas de control de pagos.
 * `precioProducto` y `nombreProducto` llegan ya resueltos (venta→producto) desde la ruta.
 */
export function clasificarPersona(
  e: EntradaPersona,
  precioProducto: number | null,
  nombreProducto: string | null,
  duracionMeses: number | null
): PersonaPagos {
  const ordenados = [...e.pagos].sort((a, b) => (a.paid_at ?? '').localeCompare(b.paid_at ?? ''))
  const detalle: PagoResumen[] = ordenados.map((p) => {
    const devuelto = n2(p.refunded_amount)
    const importe = n2(p.amount)
    return {
      payment_id: p.payment_id,
      fecha: p.paid_at,
      importe,
      devuelto,
      neto: importe - devuelto,
      esReserva: importe > 0 && importe < RESERVA_MAX_EUR,
      estado: devuelto >= importe && devuelto > 0 ? 'devuelto' : devuelto > 0 ? 'devuelto_parcial' : 'pagado',
      refInterna: p.ref_interna,
    }
  })

  const pagadoBruto = detalle.reduce((s, d) => s + d.importe, 0)
  const devuelto = detalle.reduce((s, d) => s + d.devuelto, 0)
  const netoPagado = pagadoBruto - devuelto
  const reservasPagadas = detalle.filter((d) => d.esReserva && d.estado !== 'devuelto').length
  const reservasDevueltas = detalle.filter((d) => d.esReserva && d.estado === 'devuelto').length
  const hayPagos = detalle.length > 0
  const todoDevuelto = hayPagos && netoPagado <= 0.01
  const soloReservasDevueltas = hayPagos && detalle.every((d) => d.esReserva && d.estado === 'devuelto')

  // --- Inferencia del plan de cuotas (pagos no-reserva vigentes) ---
  const cuotas = detalle.filter((d) => !d.esReserva && d.estado === 'pagado')
  const importesCuota = [...new Set(cuotas.map((d) => Math.round(d.importe * 100) / 100))]
  let importeCuota: number | null = importesCuota.length === 1 ? importesCuota[0] : null
  const cuotasPagadas = cuotas.length
  const primeraCuota = cuotas[0]?.fecha ?? null
  const ultimaCuota = cuotas.length ? cuotas[cuotas.length - 1].fecha : null
  let cuotasTotalesInferidas: number | null = null

  // Reserva asumida en el plan: el nº de cuotas que cuadra es "precio − reserva", no "precio".
  const preciosCandidatos = [precioProducto, ...e.ventas.map((v) => n2(v.gross_amount))].filter(
    (x): x is number => !!x && x > 0
  )
  const precioBase = preciosCandidatos[0] ?? null
  let reservaAsumidaEnPlan = false
  let totalPlan: number | null = null

  if (cuotas.length > 0 && precioBase) {
    totalPlan = cuotas.reduce((s, d) => s + d.importe, 0)
    if (importeCuota) {
      // nº de cuotas que cuadra con el precio completo, o con el precio MENOS la reserva
      const kPrecio = Math.round(precioBase / importeCuota)
      const kMenosReserva = Math.round((precioBase - 50) / importeCuota)
      const cuadraPrecio = mismaCantidad(kPrecio * importeCuota, precioBase)
      const cuadraMenosReserva =
        !cuadraPrecio && kMenosReserva >= 2 && mismaCantidad(kMenosReserva * importeCuota, precioBase - 50)
      // reserva YA DEVUELTA y el plan cubre precio − (reservasDevueltas × 50)
      const kMenosDevueltas = Math.round((precioBase - reservasDevueltas * 50) / importeCuota)
      const cuadraMenosDevueltas =
        !cuadraPrecio &&
        !cuadraMenosReserva &&
        reservasDevueltas > 0 &&
        kMenosDevueltas >= 2 &&
        mismaCantidad(kMenosDevueltas * importeCuota, precioBase - reservasDevueltas * 50)
      if (cuadraPrecio) {
        cuotasTotalesInferidas = kPrecio
        totalPlan = kPrecio * importeCuota
      } else if (cuadraMenosReserva || cuadraMenosDevueltas) {
        const k = cuadraMenosReserva ? kMenosReserva : kMenosDevueltas
        cuotasTotalesInferidas = k
        totalPlan = k * importeCuota
        reservaAsumidaEnPlan = true
      } else if (cuotasPagadas > 1) {
        // el plan no encaja con el precio completo: si hubo reserva devuelta, se asume en el plan
        reservaAsumidaEnPlan = reservasDevueltas > 0
      }
    }
  } else if (cuotas.length === 1 && precioBase && mismaCantidad(cuotas[0].importe, precioBase)) {
    importeCuota = precioBase
    totalPlan = precioBase
  }

  const cuotasTotales =
    cuotasTotalesInferidas ?? (importeCuota && duracionMeses ? duracionMeses : cuotasPagadas || null)

  // --- Impagos: cuotas esperadas vencidas sin cobro ---
  let impagos = 0
  if (importeCuota && primeraCuota) {
    const t0 = new Date(primeraCuota).getTime()
    const hoy = Date.now()
    const mesMs = 30.44 * 24 * 3600 * 1000
    // cuotas que DEBERÍAN haberse cobrado desde la primera (incluida) con 5 días de gracia:
    // la gracia RESTA tiempo transcurrido (una cuota vencida hoy no es impago hasta dentro de 5 días)
    const esperadas = Math.floor((hoy - t0 - 5 * 24 * 3600 * 1000) / mesMs) + 1
    const tope = Math.min(esperadas, cuotasTotales ?? esperadas)
    impagos = Math.max(tope - cuotasPagadas, 0)
    if (todoDevuelto) impagos = 0
  }

  // --- Estado final ---
  let estadoCliente: ClasificacionPersona
  if (todoDevuelto || soloReservasDevueltas) {
    estadoCliente = 'reserva_devuelta'
  } else if (!hayPagos) {
    estadoCliente = 'solo_interno'
  } else if (importeCuota && cuotasPagadas >= 2 && cuotasTotales && cuotasPagadas < cuotasTotales) {
    const ritmoMensual = duracionMeses ? Math.abs(cuotasTotales - duracionMeses) <= 1 : true
    estadoCliente = ritmoMensual ? 'suscripcion' : 'plan_a_plazos'
  } else if (precioBase && netoPagado >= precioBase - 0.02) {
    estadoCliente = 'cliente_completado'
  } else if (cuotasPagadas === 0 && reservasPagadas > 0) {
    estadoCliente = 'reserva_pendiente'
  } else {
    estadoCliente = 'cliente_activo'
  }
  // reserva devuelta + plan posterior = cliente con reserva asumida, no "reserva_devuelta"
  if (estadoCliente === 'reserva_devuelta' && cuotas.length > 0) estadoCliente = 'cliente_activo'

  return {
    key: e.key,
    nombre: e.nombre,
    email: e.email,
    contact_id: e.contact_id,
    customerIds: [...new Set(e.customer_ids)],
    estadoCliente,
    netoPagado,
    devuelto,
    reservasPagadas,
    reservasDevueltas,
    reservaAsumidaEnPlan,
    totalPlan,
    precioProducto: precioBase,
    nombreProducto,
    cuotasPagadas,
    cuotasTotales,
    importeCuota,
    impagos,
    primeraCuota,
    ultimaCuota,
    ventaId: e.ventas[0]?.id ?? null,
    detalle,
  }
}

/** Agrupa y clasifica todo el tenant de una vez. */
export function controlPorPersona(
  pagos: PagoEspejo[],
  clientes: ClienteStripe[],
  contactos: { id: string; full_name: string; email: string | null }[],
  ventas: VentaInterna[],
  cobros: CobroInterno[],
  productos: Producto[],
  productoDeVenta: Map<string, { name: string; duration_months: number | null }>
): PersonaPagos[] {
  const entradas = agruparPersonas(pagos, clientes, contactos, ventas, cobros, productos)
  return entradas
    .map((e) => {
      const ventaPrincipal = e.ventas.find((v) => v.status === 'active') ?? e.ventas[0]
      const prod = ventaPrincipal ? productoDeVenta.get(ventaPrincipal.id) : undefined
      return clasificarPersona(
        e,
        prod ? n2(ventaPrincipal!.gross_amount) : null,
        prod?.name ?? null,
        prod?.duration_months ?? null
      )
    })
    .sort((a, b) => b.netoPagado - a.netoPagado || a.nombre.localeCompare(b.nombre))
}
