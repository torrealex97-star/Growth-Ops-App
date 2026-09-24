import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { createClient } from '@/lib/supabase/server'
import { consultarMetricas } from '@/lib/metrics/consulta'
import { coberturaMarcado } from '@/lib/metrics/agregados'
import { entradasDiagnostico, entradasSalud } from '@/lib/metrics/entradas'
import { diagnosticarCuelloBotella, evaluarEscalado } from '@/lib/metrics/cuello-botella'
import { calcularSalud } from '@/lib/metrics/salud'
import { construirBrief } from '@/lib/metrics/brief'
import { alertaCalidadDato, alertaKpi, type Alerta } from '@/lib/metrics/alertas'
import { cargarContextoNegocio } from '@/lib/ai/agent/contexto'
import { medirObjetivos, type EntradaObjetivo, type ObjetivoMedido } from '@/lib/metrics/objetivos'
import { preverSerie, type Prevision } from '@/lib/metrics/prevision'
import { avanceDelPeriodo, diaSiguiente } from '@/lib/metrics/series'

export const runtime = 'nodejs'

// EL GROWTH BRIEF, servido: salud → restricción → impacto → acción.
//
// Es el punto donde todo el motor se junta con datos reales. Antes de esta ruta, cuello-botella.ts,
// salud.ts, brief.ts y alertas.ts estaban construidos y probados pero no los alimentaba nadie: eran
// aritmética correcta sobre datos que nunca llegaban.
//
// SE LEE CON LA SESIÓN DEL USUARIO, no con service_role. No hace falta saltar RLS para leer métricas, y
// usar el cliente del usuario significa que el aislamiento por subcuenta lo sostiene la base y no la
// memoria de quien escribió la consulta. El `tenant_id` explícito va además, no en su lugar.

/** Periodo por defecto: el mes en curso. Es el que mira alguien que abre el panel sin filtrar. */
function mesEnCurso(): { desde: string; hasta: string } {
  const hoy = new Date()
  const primero = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1))
  return { desde: primero.toISOString().slice(0, 10), hasta: hoy.toISOString().slice(0, 10) }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const qs = req.nextUrl.searchParams
  const desde = qs.get('desde')
  const hasta = qs.get('hasta')
  // Se valida el formato en vez de confiar: una fecha mal formada se le pasaría a PostgREST tal cual.
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) {
    return NextResponse.json({ error: 'Las fechas tienen que ir en formato YYYY-MM-DD' }, { status: 400 })
  }
  const porDefecto = mesEnCurso()
  const periodo = { desde: desde || porDefecto.desde, hasta: hasta || porDefecto.hasta }
  if (periodo.desde > periodo.hasta) {
    return NextResponse.json({ error: 'El inicio del periodo es posterior al final' }, { status: 400 })
  }

  const sb = await createClient()

  let consulta
  try {
    consulta = await consultarMetricas(sb, auth.tenantId, periodo)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudieron leer las métricas', requestId: auth.requestId },
      { status: 500 }
    )
  }

  const contexto = await cargarContextoNegocio(sb, auth.tenantId).catch(() => null)

  // El ticket medio real del periodo alimenta la estimación de impacto. Si no hay ventas, se usa el
  // precio de la oferta que una persona haya configurado; y si tampoco, no se estiman euros. Lo que NO
  // se hace es inventar un ticket para que la tarjeta tenga un número.
  const ticketMedio = consulta.agregados.aov?.valor ?? contexto?.precioOfertaEur ?? null
  const config = {
    muestraAlta: 100,
    muestraMinima: 20,
    umbralCritico: 0.2,
    ticketMedioEur: ticketMedio,
    volumenBase: consulta.agregados.agendas?.valor ?? null,
  }

  const metricas = entradasDiagnostico(consulta.agregados)
  const diagnostico = diagnosticarCuelloBotella(metricas, config)
  const salud = calcularSalud(entradasSalud(consulta.agregados))

  // Las alertas de KPI salen de las mismas métricas, no de un segundo cálculo: si se recalcularan aquí,
  // el panel podría avisar de algo que el diagnóstico no ve.
  const alertas: Alerta[] = []
  for (const m of metricas) {
    if (m.valor === null || m.objetivo === null || m.objetivo === 0) continue
    const desvio = (m.higherIsBetter ? m.objetivo - m.valor : m.valor - m.objetivo) / Math.abs(m.objetivo)
    if (desvio <= 0) continue
    alertas.push(
      alertaKpi({
        key: m.key,
        nombre: m.nombre,
        valor: m.valor,
        objetivo: m.objetivo,
        higherIsBetter: m.higherIsBetter,
        desvioRelativo: desvio,
        muestra: m.muestra,
        investigar: m.investigar,
      })
    )
  }
  // Una fuente que no se pudo leer es calidad de dato, no un problema de negocio, y va con ese aviso
  // para que nadie lea un hueco como un resultado.
  for (const f of consulta.fuentesConError) {
    alertas.push(
      alertaCalidadDato({
        key: `fuente_${f.fuente}`,
        que: f.fuente,
        detalle: `No se pudo leer: ${f.error}.`,
        comoArreglar: 'Reintentar; si persiste, revisar la integración de esa fuente.',
      })
    )
  }
  for (const f of consulta.fuentesRecortadas) {
    alertas.push(
      alertaCalidadDato({
        key: `recorte_${f}`,
        que: `${f} (lectura recortada)`,
        detalle: 'Se alcanzó el tope de páginas, así que las sumas de esta fuente pueden estar incompletas.',
        comoArreglar: 'Acotar el periodo consultado.',
      })
    )
  }

  // EL AVISO QUE MÁS VALE HOY. Comprobado en producción: 328 citas ya pasadas siguen en `scheduled` o
  // `confirmed`, y solo 3 están marcadas. Mientras eso siga así, el show rate, el pitch rate y el close
  // rate sobre llamadas no se pueden calcular con nada, y decirlo vale más que cualquier número del panel.
  const marcado = coberturaMarcado(consulta.citas, periodo)
  if (marcado.pasadasSinMarcar > 0) {
    alertas.push(
      alertaCalidadDato({
        key: 'marcado_agendas',
        que: 'el resultado de las llamadas ya celebradas',
        detalle: `${marcado.pasadasSinMarcar} citas del periodo ya han pasado y nadie ha marcado si la persona apareció (${marcado.resueltas} sí están marcadas).`,
        comoArreglar: 'Marcar asistencia y resultado en CRM → Agendas. Sin eso no hay show rate ni close rate.',
      })
    )
  }

  // EL HUECO DE ATRIBUCIÓN, dicho en vez de callado. Sin origen no hay CAC por canal, ni se puede
  // separar lo orgánico de la web de los anuncios: el panel enseñaría un CAC global y nadie sabría de
  // qué canal viene. Se avisa con el número exacto para que no parezca una opinión.
  const { contactos, conAtribucion } = consulta.atribucion
  if (contactos > 0 && conAtribucion < contactos) {
    alertas.push(
      alertaCalidadDato({
        key: 'atribucion_contactos',
        que: 'el origen de los contactos',
        detalle: `${conAtribucion} de ${contactos} contactos tienen origen conocido. Sin eso no hay CAC por canal ni se puede separar lo orgánico de los anuncios.`,
        comoArreglar:
          'Añadir parámetros UTM a los enlaces de reserva de los anuncios, o instalar el snippet de tracking en la landing. Mientras no lleguen, no hay nada que atribuir.',
      })
    )
  }

  // OBJETIVOS Y PREVISIÓN. Solo se construye un objetivo cuando growth_context TRAE el valor: sin
  // objetivo configurado no hay "cumplido" ni "por detrás" que decir, y un objetivo inventado convertiría
  // el panel en una comparación contra una cifra que nadie decidió (ver lib/ai/agent/contexto.ts).
  const avance = avanceDelPeriodo(periodo, new Date().toISOString().slice(0, 10))
  const entradasObjetivos: EntradaObjetivo[] = []
  if (contexto?.objetivoFacturacionMensualEur != null) {
    const ultimaFacturacion = consulta.serieFacturacion.at(-1)?.valor ?? null
    entradasObjetivos.push({
      objetivo: {
        key: 'facturacion_objetivo',
        nombre: 'Facturación del periodo',
        periodo: 'mes',
        clase: 'acumulativa',
        valor: contexto.objetivoFacturacionMensualEur,
        higherIsBetter: true,
        unidad: '€',
      },
      actual: ultimaFacturacion,
      fraccionTranscurrida: avance.cerrado ? null : avance.fraccion,
      unidadesRestantes: avance.diasRestantes,
      nombreUnidadRestante: 'días',
    })
  }
  if (contexto?.objetivoCashRoas != null) {
    entradasObjetivos.push({
      objetivo: {
        key: 'cash_roas_objetivo',
        nombre: 'Cash ROAS',
        periodo: 'mes',
        clase: 'tasa',
        valor: contexto.objetivoCashRoas,
        higherIsBetter: true,
        unidad: 'x',
      },
      actual: consulta.agregados.cash_roas?.valor ?? null,
    })
  }
  const objetivos: ObjetivoMedido[] = medirObjetivos(entradasObjetivos)

  // La previsión solo tiene sentido con periodo en curso y días por delante que proyectar: un periodo
  // cerrado no se prevé, se mide.
  const prevision: Prevision | null =
    !avance.cerrado && avance.diasRestantes > 0
      ? preverSerie(consulta.serieFacturacion, avance.diasRestantes, {
          siguienteFecha: (ultima, paso) => diaSiguiente(ultima, paso),
          noNegativa: true,
        })
      : null

  const capacidad = {
    // La utilización solo se calcula si una persona ha declarado la capacidad: sin ese dato no se puede
    // saber si hay techo, y el motor devuelve `con_cautela` en vez de luz verde.
    utilizacionVentas:
      contexto?.capacidadLlamadasSemana && consulta.agregados.agendas?.valor != null
        ? Math.round((consulta.agregados.agendas.valor / contexto.capacidadLlamadasSemana) * 100)
        : null,
    utilizacionEntrega: null,
  }

  const brief = construirBrief({
    salud,
    diagnostico,
    alertas,
    escalado: evaluarEscalado(diagnostico, capacidad, config),
    periodo,
  })

  return NextResponse.json({
    periodo,
    brief,
    objetivos,
    prevision,
    avance,
    // Las mediciones en crudo, para el "ver cálculo" de cada tarjeta: sin esto, la nota de salud vuelve
    // a ser un número que nadie puede discutir.
    mediciones: consulta.agregados,
    diagnostico,
    salud,
    procedencia: {
      filasLeidas: consulta.filasLeidas,
      fuentesConError: consulta.fuentesConError,
      fuentesRecortadas: consulta.fuentesRecortadas,
      ticketMedioUsado: ticketMedio,
      contextoConfigurado: contexto !== null && contexto.precioOfertaEur !== null,
      atribucion: consulta.atribucion,
    },
    requestId: auth.requestId,
  })
}
