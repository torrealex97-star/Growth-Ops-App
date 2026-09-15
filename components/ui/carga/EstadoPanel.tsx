'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, Database, Inbox, Lock, PlugZap, Settings2, type LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import type { EstadoDatos } from '@/lib/ui/carga'
import { AppLoading, PageSkeleton } from './AppLoading'

// LOS ESTADOS SIN DATOS, DICHOS COMO SON.
//
// La app usaba dos estados para nueve situaciones: skeleton, y luego un 0 o una lista vacía. El
// problema no es estético. "No has facturado nada este mes" y "no hay ventas importadas en el sistema"
// se pintaban igual, y son opuestos: el primero es un problema comercial y el segundo de integración.
// Alguien que mira un 0 y decide sobre él está decidiendo sobre un dato que nadie ha medido.
//
// Cada estado trae su SIGUIENTE ACCIÓN. Un estado vacío que no dice qué hacer obliga a adivinar.

export type EstadoPanelProps = {
  estado: EstadoDatos
  /** Qué se está mirando: "campañas", "ventas del periodo". Se mete en los mensajes. */
  que: string
  /** Nombre de la integración cuando el estado depende de una. */
  integracion?: string
  /** Mensaje del fallo real, cuando estado === 'error'. Nunca se inventa uno genérico si hay este. */
  mensajeError?: string
  /** Cuándo se sincronizó por última vez, para 'desactualizado'. */
  desde?: string
  onReintentar?: () => void
  onConfigurar?: () => void
  /** Contenido a pintar cuando el estado sí tiene datos que enseñar. */
  children?: ReactNode
  /** Forma del esqueleto mientras carga. */
  filasSkeleton?: number
}

// Un icono por estado: la forma ayuda a distinguir "no hay datos" de "no está conectado" antes de
// leer el texto. Los estados que no llegan a este render (cargando, sincronizando) no llevan icono.
const ICONO_ESTADO: Partial<Record<EstadoDatos, LucideIcon>> = {
  vacio: Inbox,
  cero_real: Database,
  sin_configurar: Settings2,
  desconectado: PlugZap,
  sin_permiso: Lock,
}

type Copia = { titulo: string; detalle: string; accion?: 'reintentar' | 'configurar' }

function copia(p: EstadoPanelProps): Copia {
  const { que, integracion } = p
  const nombre = integracion ?? 'la integración'
  switch (p.estado) {
    case 'vacio':
      // Hay fuente y se ha medido: simplemente no hay filas en este filtro. Es un hecho, no un fallo.
      return { titulo: `No hay ${que} en este periodo`, detalle: 'Prueba a ampliar el rango de fechas.' }
    case 'cero_real':
      return { titulo: `${que}: 0`, detalle: 'Es el dato real del periodo, no un hueco de medición.' }
    case 'sin_configurar':
      return {
        titulo: `Falta configurar ${que}`,
        detalle: 'Sin esa configuración no se puede calcular. No se rellena con un cero.',
        accion: 'configurar',
      }
    case 'desconectado':
      return {
        titulo: `No hay ${que} porque ${nombre} no está conectado`,
        detalle: `Conecta ${nombre} para empezar a traer datos. Mientras, esto está vacío por falta de conexión, no porque no haya actividad.`,
        accion: 'configurar',
      }
    case 'sincronizacion_fallida':
      return {
        titulo: `${nombre} está conectado, pero la última sincronización falló`,
        detalle: `Lo que se ve puede estar incompleto. ${p.mensajeError ?? ''}`.trim(),
        accion: 'reintentar',
      }
    case 'sincronizando':
      return { titulo: `Sincronizando ${nombre}…`, detalle: 'Los datos aparecerán en cuanto termine.' }
    case 'desactualizado':
      return {
        titulo: `Estos ${que} pueden estar desactualizados`,
        detalle: p.desde ? `Última sincronización: ${p.desde}.` : 'Hace demasiado de la última sincronización.',
        accion: 'reintentar',
      }
    case 'sin_permiso':
      return { titulo: 'No tienes permiso', detalle: `Tu rol no permite ver ni editar ${que}.` }
    case 'error':
      return {
        titulo: `No se han podido cargar ${que}`,
        // El motivo real, no un "algo ha ido mal": sin él nadie puede decidir si reintentar o avisar.
        detalle: p.mensajeError ?? 'El servidor ha devuelto un error.',
        accion: 'reintentar',
      }
    default:
      return { titulo: '', detalle: '' }
  }
}

export function EstadoPanel(p: EstadoPanelProps) {
  if (p.estado === 'cargando') {
    return <PageSkeleton filas={p.filasSkeleton ?? 5} etiqueta={`Cargando ${p.que}…`} />
  }
  if (p.estado === 'sincronizando') {
    return <AppLoading mensaje={`Sincronizando ${p.integracion ?? p.que}…`} />
  }
  // Los estados con datos reales pintan el contenido; el aviso de desactualizado va ENCIMA, no en vez.
  if (p.estado === 'cero_real' || p.estado === 'desactualizado') {
    const c = copia(p)
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {c.titulo}
          {c.detalle ? ` — ${c.detalle}` : ''}
          {c.accion === 'reintentar' && p.onReintentar && (
            <button type="button" onClick={p.onReintentar} className="ml-2 underline hover:no-underline">
              Actualizar
            </button>
          )}
        </div>
        {p.children}
      </div>
    )
  }

  const c = copia(p)
  const esError = p.estado === 'error' || p.estado === 'sincronizacion_fallida'
  // El ASPECTO lo da `EmptyState`, el primitivo que ya existía en components/ui (escrito y sin usar).
  // Este componente aporta lo que faltaba: QUÉ estado es, qué dice y qué acción ofrece. Repintar aquí
  // el bloque "icono + título + texto" habría dejado dos estados vacíos distintos en la misma app.
  return (
    <div role={esError ? 'alert' : undefined}>
      <EmptyState
        icon={esError ? AlertTriangle : ICONO_ESTADO[p.estado]}
        title={c.titulo}
        description={c.detalle || undefined}
        className="rounded-lg border border-dashed border-border py-10"
        action={
          <div className="flex gap-2">
            {c.accion === 'reintentar' && p.onReintentar && (
              <button
                type="button"
                onClick={p.onReintentar}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Reintentar
              </button>
            )}
            {c.accion === 'configurar' && p.onConfigurar && (
              <button
                type="button"
                onClick={p.onConfigurar}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-foreground underline transition-colors hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {p.estado === 'desconectado' ? `Conectar ${p.integracion ?? ''}`.trim() : 'Configurar'}
              </button>
            )}
          </div>
        }
      />
    </div>
  )
}
