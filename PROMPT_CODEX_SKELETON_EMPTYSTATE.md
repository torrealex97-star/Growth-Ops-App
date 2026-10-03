# Prompt para Codex: terminar la adopción de `Skeleton` y `EmptyState`

Rol: Claude (esta sesión) es el estratega — auditó el código, confirmó el hueco con grep y lectura
real de ficheros, y escribe este plan. Codex es el implementador — ejecuta los pasos, verifica
visualmente (tiene navegador; esta sesión de Claude no) y hace los commits.

## 0. Contexto — por qué existe este documento

Durante la auditoría MVP (S1, `docs/S1-MVP-READINESS-2026-10-01.md` §6.8) se confirmó un hueco real
y ya documentado antes: dos componentes primitivos existen para unificar loading y estados vacíos,
pero casi nadie los usa.

- `components/ui/skeleton.tsx` — su propio comentario dice que se construyó para "sustituir a los
  `<div className=\"... animate-pulse\" />` sueltos repetidos por ~20 pantallas", citando una
  auditoría UX previa (`PROMPT_UXUI_AUDIT.md` #8, #62). **Hoy solo 1 fichero lo importa**
  (`components/ui/carga/AppLoading.tsx`, que además construye `PageSkeleton` encima — ver §2).
- `components/ui/empty-state.tsx` — mismo origen (`PROMPT_UXUI_AUDIT.md` #8, #63). **Hoy solo 1
  fichero lo importa** (`components/ui/carga/EstadoPanel.tsx`).

Mientras tanto hay **52 ficheros** con `animate-pulse` suelto sin pasar por el componente, y **49**
con texto de "no hay datos" escrito a mano (aunque, como se explica en §3, no todos esos 49 son
candidatos reales — hay que distinguir).

No se corrigió en la sesión de Claude porque tocar decenas de ficheros sin poder verlos renderizados
es el tipo exacto de cambio amplio-y-no-verificable que el encargo de auditoría pide evitar. Codex
sí tiene navegador: puede hacer el cambio Y verificarlo de verdad, pantalla por pantalla.

## 1. Objetivo y límites estrictos

**Objetivo:** migrar los `animate-pulse` sueltos a `Skeleton`/`PageSkeleton`, y los bloques reales
de "sin datos" a `EmptyState`, sin cambiar ningún comportamiento ni medida visual.

**Esto NO es un rediseño.** Reglas duras:

1. **Cero cambios de layout.** El resultado visual tiene que ser indistinguible del actual —
   mismas alturas, mismos anchos, mismo espaciado. `Skeleton` existe precisamente para no producir
   layout shift (CLS) — si el className que le pasas no reproduce las medidas del `div` original,
   lo estás haciendo mal.
2. **No tocar lógica.** Solo se sustituye el JSX del bloque de loading/vacío. No se cambian
   condiciones, no se cambian fetches, no se cambian props de componentes padres.
3. **No todo lo que dice "No hay…" es un `EmptyState`.** Ver criterio exacto en §3 — texto de ayuda
   inline (p. ej. "No hay huecos disponibles ese día. Prueba otra fecha." dentro de un selector de
   horario) NO se toca. Solo el patrón real de estado vacío de una lista/sección completa.
4. **Trabajar en lotes pequeños y verificables**, no un commit gigante. Ver §5.
5. **Si algo no está claro, no se adivina.** Un fichero con un `animate-pulse` dentro de una
   estructura rara (p. ej. SVG, canvas, grid con cálculo dinámico de columnas) se deja fuera y se
   anota en el informe final — no se fuerza.

## 2. Las piezas que ya existen (no crear nada nuevo)

### `components/ui/skeleton.tsx`

```tsx
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-lg bg-card', className)} {...props} />
}
```

Ya aplica `animate-pulse rounded-lg bg-card` por defecto. El `className` que le pases solo necesita
añadir lo que cambie (altura, ancho, si no quieres `rounded-lg` por defecto, etc.) — no repitas
`animate-pulse` ni `bg-card` si ya coinciden con el original.

### `components/ui/carga/AppLoading.tsx` → `PageSkeleton`

Ya existe un helper encima de `Skeleton` para el caso "N filas, cada una con una altura": úsalo en
vez de escribir el `Array.from({length: N}).map(...)` a mano cada vez que el original sea
exactamente eso.

```tsx
import { PageSkeleton } from '@/components/ui/carga/AppLoading'

<PageSkeleton filas={6} alturaFila={44} />
```

Internamente ya trae `role="status"`, `aria-live="polite"` y un `sr-only` con la etiqueta — mejor
accesibilidad que el `div` suelto que vas a sustituir, gratis.

### `components/ui/empty-state.tsx`

```tsx
interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}
```

Pinta: icono (si se pasa) + título + descripción (si se pasa) + acción (si se pasa), todo centrado
con `py-20`. Si el bloque original usa un `py-12` en vez de `py-20`, pásale `className="py-12"` para
no cambiar el espaciado real.

## 3. Cómo encontrar los candidatos reales (y descartar los falsos positivos)

### 3.1 Loading — `animate-pulse` suelto

```bash
grep -rn "animate-pulse" --include="*.tsx" app
```

Cada resultado es candidato. Clasifícalo así:

- **Una sola `div` con altura fija** (`<div className="h-48 bg-card rounded-lg animate-pulse" />`)
  → `<Skeleton className="h-48" />` (quita `bg-card` y `rounded-lg` del className si son iguales a
  los que `Skeleton` ya aplica por defecto; déjalos si el original usa un radio distinto como
  `rounded-xl` o `rounded-full`).
- **Un `Array.from({length: N}).map(...)` generando N divs idénticos de la misma altura** → usa
  `PageSkeleton` con el `filas`/`alturaFila` que correspondan, O si el contenedor no es una lista
  vertical simple (p. ej. es una rejilla de tarjetas 2x3), usa `Skeleton` directamente dentro del
  `.map()` existente, sin forzar `PageSkeleton` donde no encaja la forma.
- **Varias `div` de alturas DISTINTAS en secuencia** (p. ej. `contactos/[id]/page.tsx:591-593`: una
  de `h-8`, una de `h-32`, una de `h-64`) → tres `<Skeleton>` sueltos, cada uno con su altura. No
  es un caso para `PageSkeleton` (que asume filas iguales).

### 3.2 Estados vacíos — solo el patrón real, no cualquier "No hay…"

```bash
grep -rn "No hay \|No tienes \|Aún no hay\|Todavía no hay" --include="*.tsx" app
```

Esto da ~49 resultados, pero **la mayoría NO son candidatos**. El patrón real de estado vacío que
sí hay que migrar tiene ESTA forma (los tres elementos juntos, como bloque único reemplazando a una
lista/tabla/sección vacía):

```tsx
<div className="flex flex-col items-center py-12 text-center">
  <Calendar className="w-10 h-10 text-muted-foreground mb-3" />
  <p className="text-muted-foreground">No hay agendas para este contacto</p>
</div>
```

→ se convierte en:

```tsx
<EmptyState icon={Calendar} title="No hay agendas para este contacto" className="py-12" />
```

(ejemplo real: `app/[tenant]/crm/contactos/[id]/page.tsx:1182-1185`, hay otro igual en la misma
pantalla en la zona de ventas, línea ~1492-1495, con icono `ShoppingCart`.)

**Qué NO es candidato** (déjalo exactamente como está):

- Texto de ayuda dentro de un formulario o selector, aunque contenga "No hay": ejemplo real,
  `app/[tenant]/crm/agendas/page.tsx:2178`, `"No hay huecos disponibles ese día. Prueba otra
  fecha."` — es una `<p>` suelta dentro de la lógica de selección de horario, no el estado vacío de
  una lista. Migrarla a `EmptyState` cambiaría el layout de un selector por un bloque centrado de
  `py-20/py-12` que no pertenece ahí.
- Texto explicativo/informativo que no representa "esta lista/sección no tiene nada": ejemplo real,
  `app/[tenant]/funnels/page.tsx:135`, `"Faltan fuentes por configurar (...). No hay nada roto: son
  etapas que todavía no tienen de dónde leer."` — es una alerta informativa, no un estado vacío.
- Una celda de tabla (`<TableCell>`) con solo el mensaje, SIN el contenedor centrado con icono: si
  ya tiene icono + centrado dentro de la celda (como `crm/seguimiento/page.tsx:563-567`), SÍ es
  candidato — usa `EmptyState` dentro del `<TableCell colSpan={N}>`, conservando el `colSpan`.

Si tienes duda sobre un caso concreto, déjalo fuera y anótalo en el informe final (§6) en vez de
adivinar.

## 4. Ficheros ya confirmados por Claude como ejemplo (úsalos para calibrar el criterio antes de barrer el resto)

Verificados en esta sesión, con su clasificación exacta:

| Fichero | Línea(s) | Tipo | Acción |
| --- | --- | --- | --- |
| `app/[tenant]/unit-economics/page.tsx` | 1298 | loading, 1 div en `.map()` | `<Skeleton>` dentro del `.map()` existente |
| `app/[tenant]/crm/agendas/page.tsx` | 1417 | loading, 1 div en `.map()` | `<Skeleton>` dentro del `.map()` existente |
| `app/[tenant]/crm/agendas/page.tsx` | 2178 | **NO migrar** — texto de ayuda inline | dejar igual |
| `app/[tenant]/crm/contactos/[id]/page.tsx` | 591-593 | loading, 3 alturas distintas en secuencia | 3× `<Skeleton>` con su altura cada uno |
| `app/[tenant]/crm/contactos/[id]/page.tsx` | 1182-1185 | empty state real (icono `Calendar`) | `<EmptyState icon={Calendar} .../>` |
| `app/[tenant]/crm/contactos/[id]/page.tsx` | 1492-1495 | empty state real (icono `ShoppingCart`) | `<EmptyState icon={ShoppingCart} .../>` |
| `app/[tenant]/crm/seguimiento/page.tsx` | 485 | loading, 1 div en `.map()` | `<Skeleton>` dentro del `.map()` existente |
| `app/[tenant]/crm/seguimiento/page.tsx` | 563-567 | empty state real, dentro de `<TableCell colSpan={8}>` | `<EmptyState icon={ClipboardList} .../>` conservando `colSpan={8}` |
| `app/[tenant]/afiliados/registro/page.tsx` | 85 | loading, 1 div suelto | `<Skeleton className="h-72">` |
| `app/[tenant]/tasks/page.tsx` | 327 | loading, 1 div suelto | `<Skeleton className="h-64">` |
| `app/[tenant]/recursos/enlaces/page.tsx` | 566 | loading, 1 div suelto | `<Skeleton className="h-48">` |
| `app/[tenant]/recursos/biblioteca/page.tsx` | 275 | loading, 1 div suelto | `<Skeleton className="h-48">` |
| `app/[tenant]/recursos/contratos-producto/page.tsx` | 94 | loading, 1 div suelto | `<Skeleton className="h-64">` |
| `app/[tenant]/recursos/grabaciones/page.tsx` | 245 | loading, 1 div suelto | `<Skeleton className="h-40">` |
| `app/[tenant]/comisiones/page.tsx` | 715, 722, 734 | loading, 3 bloques en 3 `<TabsContent>` distintos (pending/approved/liquidated) — NO son una lista de filas, son 3 pestañas independientes | 3× `<Skeleton className="h-48">`, uno por pestaña — NO usar `PageSkeleton` aquí |
| `app/[tenant]/funnels/page.tsx` | 135 | **NO migrar** — alerta informativa | dejar igual |

El resto de los 52+49 no se revisó línea a línea en esta sesión — aplica el mismo criterio de §3.

## 5. Proceso de ejecución (lotes pequeños, cada uno verificado antes del siguiente)

1. **Rama nueva** desde el HEAD actual de `audit/mvp-phase0-baseline` (o desde `main` si esa rama
   ya se fusionó): `git checkout -b fix/skeleton-emptystate-adopcion`.
2. Regenera las dos listas de candidatos con los greps de §3 (puede haber cambiado desde que se
   escribió este documento).
3. Agrupa en lotes de ~8-10 ficheros (por carpeta tiene sentido: todo `app/[tenant]/crm/*` junto,
   luego `app/[tenant]/recursos/*`, etc.).
4. Por cada lote:
   a. Aplica la sustitución exacta (import + JSX), sin tocar nada más del fichero.
   b. `npx tsc --noEmit` — cero errores nuevos.
   c. `npx eslint <los ficheros del lote>` — cero errores/warnings nuevos.
   d. **Verificación visual real** (esto es lo que Codex puede hacer y Claude no pudo): levanta
      `npm run dev`, abre cada pantalla tocada, dispara el estado de loading y el estado vacío (si
      aplica — puede necesitar datos de prueba o cortar la red un instante) y compara contra una
      captura de ANTES del cambio. Mismas medidas, mismo aspecto, sin salto de layout.
   e. `npm test` completo — mismo resultado que el baseline (1202/1205; los 3 fallos de red al
      sandbox son conocidos y no son de este cambio).
   f. Commit del lote con mensaje descriptivo (qué carpeta/pantallas, cuántos ficheros).
5. Al terminar todos los lotes: `npm run quality` completo en verde.
6. Abre PR contra `main` (o la rama que el usuario indique en ese momento) siguiendo el formato de
   PR de este repo (ver plantilla si existe, o el estilo de PRs anteriores: resumen + qué se tocó +
   test plan).

## 6. Informe final (añadir, no sustituir, a los documentos vivos del repo)

Al terminar, actualiza (siguiendo el patrón ya establecido en esta auditoría — no crear ficheros
nuevos para esto):

- `PENDIENTES.md`: marca el ítem de Fase 10 (Skeleton/EmptyState) como hecho, con el recuento real
  de ficheros migrados vs. dejados fuera y por qué.
- `docs/S1-MVP-READINESS-2026-10-01.md` §6.8: añade los resultados reales (cuántos de los 52+49 se
  migraron, cuántos se descartaron como falso positivo tipo "texto de ayuda inline", y confirma con
  capturas o descripción de la verificación visual que no hubo layout shift).

No dupliques estos documentos — edítalos en el sitio ya establecido en esta sesión.
