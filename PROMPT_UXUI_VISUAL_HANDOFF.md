# Prompt: auditoría visual con navegador (continuación de PROMPT_UXUI_AUDIT.md)

Contexto: vengo de una sesión de Claude Code sin navegador que ya hizo una primera pasada de
`PROMPT_UXUI_AUDIT.md` limitada a lo que se podía inspeccionar solo por código (sin capturas). Tú sí
tienes navegador — tu trabajo es la parte visual real: capturas antes/después (regla #96 de
`PROMPT_UXUI_AUDIT.md`) y decidir/corregir lo que solo se puede juzgar viendo la app renderizada.

**Antes de nada**: comprueba si el prompt `PROMPT_ARQUITECTURA_PENDIENTE.md` ya ha terminado en esta
rama (`git log --oneline -20`, busca los commits de cierre de esa lista). Si sigue en marcha en otra
sesión, espera a que termine — este prompt depende de que las migraciones y la arquitectura de datos
estén cerradas para no rediseñar Dashboard/Finanzas dos veces. Si ya terminó, sigue.

## 0. Ya hecho (no lo repitas)

Ya está commiteado en esta rama (`claude/app-continuation-lpbupf`):
- `components/ui/skeleton.tsx` y `empty-state.tsx` (primitivos nuevos, sin migrar los ~20 call sites
  que aún reinventan `animate-pulse` a mano — decide tú, viéndolo, si merece la pena migrarlos).
- `aria-label` en los 8 botones de solo-icono que no lo tenían.
- `focus:ring-1 focus:ring-brand-500` en ~19 inputs/textareas que solo cambiaban el borde al enfocar
  (sin indicador de foco visible por teclado).

Verifica con capturas que estos cambios se ven bien (el ring no debería romper nada visualmente,
pero no se ha comprobado en navegador real — hazlo tú).

## 1. Lo que quedó identificado pero SIN tocar (deuda de diseño, necesita tu criterio visual)

Un agente de exploración (solo código, sin navegador) encontró esto — verifícalo viendo la app y
decide qué corregir:

**a) Paleta de color duplicada.** Existen tokens semánticos bien centralizados en `app/globals.css`
y `tailwind.config.ts` (`background/card/border/muted-foreground/brand-*`), pero convive con ~136
colores hardcoded (`#0A0A0B`, `#141416`, `#26262A`, `#A1A1AA`, etc.) en:
- `app/[tenant]/unit-economics/page.tsx` (líneas ~239-419)
- `components/os/Header.tsx:78`
- `app/[tenant]/login/page.tsx:56-76`
- `app/[tenant]/instagram/page.tsx:709-720` (colores de Recharts hardcoded)

Decide si esa paleta oscura paralela es intencional (¿un tema distinto para alguna pantalla?) o debe
migrarse a los tokens ya existentes. Si migras, haz captura antes/después de cada pantalla tocada.

**b) Tamaños de fuente arbitrarios.** ~223 usos de `text-[9px]`/`text-[10px]`/`text-[11px]`/`text-[13px]`
en vez de la escala de Tailwind, concentrados en `crm/agendas`, `crm/seguimiento`, `tasks` (vistas
densas de calendario/kanban). Si es un patrón real y necesario (la escala `text-xs` de 12px no cubre
UI muy densa), considera ampliar la escala en `tailwind.config.ts` con un token semántico (p. ej.
`text-2xs`) en vez de dejar arbitrarios sueltos — pero solo si lo confirmas viendo que esas pantallas
realmente necesitan ese tamaño.

**c) Formato de moneda/fecha sin una sola fuente de verdad.** `lib/utils.ts` tiene `formatCurrency`/
`formatDateTime` "oficiales", pero se ignoran en más de la mitad de los usos: `Intl.NumberFormat`
inline duplicado en 8+ archivos, `toLocaleDateString` con opciones distintas cada vez en ~15 archivos,
manejo manual de fecha en 36 más. Antes de consolidar, confirma visualmente que no hay ninguna
pantalla que dependa de un formato distinto a propósito (p. ej. fechas técnicas en logs/auditoría).

**d) Modales caseros.** Al menos 6 sitios reinventan un overlay con `fixed inset-0 bg-black/…` en vez
de `components/ui/dialog.tsx`: `instagram/page.tsx` (dos sitios), `instagram/competencia/page.tsx`,
`components/os/ScriptQueue.tsx`, `marketing/contenido/page.tsx` (dos modales). Compara visualmente
si el modal de `dialog.tsx` (animaciones, overlay, cierre con Escape/click fuera) ya cubre esos casos
antes de migrarlos.

## 2. Auditoría visual completa

A partir de aquí sigue `PROMPT_UXUI_AUDIT.md` tal cual está escrito (167 reglas) — es la fuente de
verdad de todo el criterio de diseño. En particular, para esta fase con navegador, prioriza:

1. **Regla #96 (screenshot audit)**: capturas BEFORE de las pantallas críticas antes de tocar nada:
   Dashboard (desktop + mobile), Finanzas, navegación (sidebar + mobile nav), WDC (mismas pantallas
   con el tenant `women-digital-closer`, para comparar contra Evergreen), y las 4 pantallas del punto 1
   de arriba.
2. Aplica el resto de fases del prompt en el orden que marca la regla #113 (tokens → componentes
   compartidos → navegación → dashboard → finanzas → resto → mobile → accesibilidad → visual
   regression).
3. Regla #111: entrega la matriz de paridad Evergreen/WDC con capturas de cada área.
4. Regla #119: reporte final con el formato PASS/FAIL/NOT AVAILABLE/NOT APPLICABLE de esa regla.

## 3. Reglas para todo

- Sigue `CLAUDE.md`/`AGENTS.md` (cambio mínimo salvo que el propio audit pida rediseño de una
  pantalla completa; nunca destructivo sin confirmación; `npm run quality && npm run test:metrics &&
  npx next build` en verde antes de cada commit).
- No toques lógica de datos/cálculos — si un cambio visual te obliga a tocar algo funcional,
  trátalo como cambio funcional aparte y avísalo explícitamente en el resumen.
- Trabaja sobre `claude/app-continuation-lpbupf`.
- Cierra con el resumen IMPLEMENTED/VALIDATION/REMAINING RISKS de siempre, e incluye qué capturas
  tomaste y dónde quedaron (o inclúyelas directamente en el resumen si tu entorno lo permite).
