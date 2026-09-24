// LA SERIE TEMPORAL, que es lo que hace posible una previsión honesta.
//
// El resto del motor mide un periodo entero y devuelve un número. Para contestar "¿voy a llegar?" hace
// falta lo otro: cómo ha ido día a día. Este módulo convierte filas en puntos, y es PURO para poder
// probarlo contra series inventadas sin base de datos.
//
// DOS DECISIONES QUE CAMBIAN EL RESULTADO:
//
// 1. LOS DÍAS SIN NADA VALEN CERO, y aquí sí. Es lo contrario de la regla del resto del motor —donde
//    sin dato nunca es cero— y el motivo es que estas series son FLUJOS ACUMULABLES: un día sin ningún
//    cobro es un día en el que entraron 0 €, no un día del que no se sabe nada. Si se omitieran esos
//    días, la serie tendría huecos y la regresión los leería como si el tiempo no hubiera pasado: un mes
//    con tres días buenos y veintisiete vacíos proyectaría como si fueran treinta días buenos. Una TASA
//    (close rate, show rate) NO se puede tratar así, y por eso este módulo solo sirve para flujos.
// 2. EL DÍA SE SACA DEL TEXTO DE LA FECHA, con `slice(0, 10)`, igual que `enPeriodo` en agregados.ts.
//    Construir un `Date` y leerle el día local movería los cobros de medianoche al día anterior o
//    siguiente según el huso de quien mira el panel, y entonces el mismo mes sumaría distinto en Madrid
//    que en el servidor.

import type { PuntoSerie } from './prevision'

export type Periodo = { desde: string; hasta: string }

/** Una fila reducida a lo único que la serie necesita: cuándo y cuánto. */
export type FilaSerie = { fecha: string | null | undefined; valor: number }

/** Suma un día a una fecha `YYYY-MM-DD` sin tocar husos: todo en UTC. */
export function diaSiguiente(dia: string, pasos = 1): string {
  const t = Date.parse(`${dia}T00:00:00Z`)
  if (!Number.isFinite(t)) return dia
  return new Date(t + pasos * 86_400_000).toISOString().slice(0, 10)
}

/** Todos los días del periodo, en orden. Acotado para que un periodo absurdo no genere una lista infinita. */
export function diasDelPeriodo(p: Periodo, maximo = 400): string[] {
  const dias: string[] = []
  let d = p.desde
  while (d <= p.hasta && dias.length < maximo) {
    dias.push(d)
    d = diaSiguiente(d)
  }
  return dias
}

/**
 * Serie diaria de un flujo: un punto por día del periodo, los días sin filas a cero.
 *
 * Solo para flujos acumulables (euros cobrados, ventas cerradas, leads, inversión). Para una tasa,
 * devolvería un cero que significa "no hubo denominador", que es exactamente la mentira que el resto
 * del motor evita.
 */
export function serieDiaria(filas: FilaSerie[], p: Periodo): PuntoSerie[] {
  const porDia = new Map<string, number>()
  for (const f of filas) {
    if (!f.fecha) continue
    const dia = f.fecha.slice(0, 10)
    if (dia < p.desde || dia > p.hasta) continue
    porDia.set(dia, (porDia.get(dia) ?? 0) + (Number.isFinite(f.valor) ? f.valor : 0))
  }
  return diasDelPeriodo(p).map((fecha) => ({
    fecha,
    valor: Math.round((porDia.get(fecha) ?? 0) * 100) / 100,
  }))
}

/** La misma serie, acumulada. Es la que se compara contra un objetivo mensual. */
export function acumular(serie: PuntoSerie[]): PuntoSerie[] {
  let suma = 0
  return serie.map((p) => {
    suma += p.valor
    return { fecha: p.fecha, valor: Math.round(suma * 100) / 100 }
  })
}

export type AvancePeriodo = {
  /** Fracción del periodo ya transcurrida, 0-1. */
  fraccion: number
  diasTotales: number
  diasTranscurridos: number
  diasRestantes: number
  /** `true` si el periodo ya terminó: entonces no hay ritmo ni proyección que calcular. */
  cerrado: boolean
}

/**
 * Cuánto del periodo ha pasado ya.
 *
 * EL DÍA DE HOY CUENTA COMO TRANSCURRIDO COMPLETO. A media mañana del día 10 de un mes de 30 se declara
 * un 33% y no un 31,5%: partir el día en curso por horas daría una proyección que sube y baja durante la
 * mañana sin que haya pasado nada en el negocio, y nadie puede decidir con un número así.
 */
export function avanceDelPeriodo(p: Periodo, hoy: string): AvancePeriodo {
  const dias = diasDelPeriodo(p)
  const diasTotales = dias.length
  if (diasTotales === 0) {
    return { fraccion: 0, diasTotales: 0, diasTranscurridos: 0, diasRestantes: 0, cerrado: true }
  }
  const transcurridos = dias.filter((d) => d <= hoy).length
  const cerrado = hoy >= p.hasta
  return {
    fraccion: Math.min(1, transcurridos / diasTotales),
    diasTotales,
    diasTranscurridos: transcurridos,
    diasRestantes: Math.max(0, diasTotales - transcurridos),
    cerrado,
  }
}
