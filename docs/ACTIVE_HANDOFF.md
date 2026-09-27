# Relevo activo

## ✅ RESULTADO (27-sep): Paridad VSL II — carga, customización, thumbnails y métricas (PR #246)

Fusionada en `main` (`405821f`), CI en verde tras re-disparo (quality 1m32s, build 2m42s, Smoke E2E
5m18s; el primer run salió CANCELADO por la cola e2e-tenant-qa, no es fallo). Segunda pasada de la
petición de Alex — lo más importante de Wistia/PandaVideo/Vidalytics, todo SIN migración:

- **Velocidad de carga**: HLS fast-start (`startLevel 0`, ABR conservador) para el primer frame ya,
  y preload selectivo (auto solo con autoplay). Se suma al preconnect/preload del embed existente.
- **Customización**: botón play central y pantalla completa configurables por vídeo (por defecto
  visibles). Con #241: colores, barra, autoplay, lockSeek, fakeProgress, loop, prueba social,
  exit hook y CTA programado.
- **Thumbnails dinámicos**: `derivadosDeSource()` (en `lib/vsl/types.ts`, módulo puro, porque
  `bunny.ts` arrastra `node:crypto` y lo importa el dashboard en cliente) deriva thumbnail.jpg,
  preview.webp animado y storyboard.vtt de la URL de Bunny sin API ni migración; las tarjetas del
  dashboard muestran miniatura + preview animado al hover (lazy).
- **Métricas conectadas**: nuevo `/vsl/resumen` (KPIs agregados de la subcuenta, mismos criterios
  que las métricas por vídeo, `requirePantalla`, filtro tenant en todas las subconsultas) pintado
  como fila superior de KPIs del dashboard de VSL.
- **Verificado:** suite focal 11/11 (el test importa la función pura real vía alias-loader) ·
  quality completo (971 unit / 0 fail / 3 skips, 740 métricas) · CI verde · rama borrada. **No
  verificado:** review visual con navegador (sandbox sin sesión).
- **Anotado:** scrub con thumbnails en el player (storyboard ya derivado) y `cta_clicks` requieren
  migración/decisión; pendientes del próximo lote.

## ⚠️ CONCURRENCIA (27-sep, tarde): Codebuff corriendo la skill "taste" — no tocar UI sin comprobar antes

Alex tiene a **Codebuff ejecutando la skill `taste`** en paralelo a esta sesión. Esa skill es de
diseño/UX visual — el mismo terreno que el bloque de "R4 pendiente" de más abajo. **Antes de tocar
cualquier fichero de `app/**/page.tsx` o `components/ui/*` por temas de tokens de color, tipografía
o modales, comprueba primero**:

1. `git log --all --oneline -20` y `git branch -r` — si ya existe una rama de Codebuff sobre estos
   mismos ficheros, no la pises: extrae lo útil, no la sobrescribas (regla de siempre: DIFF →
   UNDERSTAND → CLASSIFY → PORT, nunca merge a ciegas).
2. Esta sección del tablero (más abajo) — si Codebuff ha reclamado fila, respétala.
3. Si no hay rastro de Codebuff en git pero Alex dice que sigue corriendo, es probable que su
   resultado llegue como PR o rama nueva DESPUÉS de que leas esto: vuelve a mirar `git branch -r`
   justo antes de empezar a escribir código, no solo al principio de la sesión.

## 📋 RELEVO (27-sep, tarde): 12 ramas de Claude Code sin PR + inventario detallado de UX R4

**Contexto:** sesión completa de Claude Code (torre.alex97) trabajando sobre el informe de auditoría
FASE A (26-sep) + puesta al día de Dependabot + arranque de UX R4. Nada de esto se ha mergeado
todavía (salvo lo que ya diga "✅ RESULTADO" más abajo) — son 12 ramas remotas, cada una con su
propio quality gate local en verde, esperando revisión/PR. Alex prefirió revisar antes de abrir PRs.

**Ramas pendientes de PR** (todas verificadas: format+lint+typecheck+tests+build en verde en su día;
re-verificar contra `main` actual antes de abrir PR, puede haber avanzado):

**Hallazgos P1 del informe FASE A (dinero/seguridad), cierran el hilo abierto en la sección de
arriba de PR-R2.2b:**

- `fix/disputed-no-es-cash` — `disputed` dejaba de tratarse como cash confirmado en
  `lib/sales/plan-cuotas.ts`, `payments/mark` y la ficha de venta (`ventas/registro/[id]`, donde
  además inflaba el importe prellenado de una devolución). Docs/MONEY.md D5.
- `fix/collections-patch-sync-cuota` — `PATCH` de `collections/[id]` con status `reversed`/`disputed`
  no llamaba a `syncInstallmentStatus` (solo lo hacía `DELETE`): la cuota quedaba `collected` para
  siempre, bloqueada para recobrarse.
- `fix/collections-approve-review-recuperable` — `approve-review` limpiaba el flag de revisión
  ANTES de garantizar la comisión; si `generateCommissionsForCollection` fallaba después, el cobro
  quedaba aprobado sin comisión y sin poder reintentar (el propio guard respondía 400). Ahora lee la
  venta primero, verifica errores, y revierte el flag si la generación falla.
- `fix/ai-tools-lectura-fallida-no-es-cero` — `getSales`/`getBusinessOverview`/`getFunnel` (tools del
  agente IA) y `detectAnomalies` presentaban un fallo de lectura como "0 ventas"/"ROAS cayó". Ahora
  devuelven `error` explícito y `detectAnomalies` se salta la comparación en vez de inventar una
  anomalía sobre un cero fabricado.

**Otros, fuera del informe FASE A pero de la misma sesión:**

- `fix/ai-agent-historial-orden` — el historial del agente mandaba los MAX_HISTORY mensajes más
  ANTIGUOS de la conversación (bug de `order(ascending:true) + limit`), no los recientes.
- `feat/port-pr225-ads-filter-nuevo-recurrente` — port manual (no rebase) de 2 de las 3 piezas de tu
  PR #225 (`feat/money-25sep`, todavía abierta, tuya): filtro de cuentas ads en `consultarMetricas`
  (agente/brief) + nuevo-vs-recurrente canónico cableado en comisiones futuras. **Queda 1/2**: el
  gráfico dual facturación-vs-cash de unit-economics (más abajo, sección propia).
- `docs/a3-alertas-deprioritizadas` — solo documentación: registra que las 5 alertas A3 (impago,
  vencimiento, lead sin contactar, no-show, onboarding/engagement) están DEPRIORIZADAS por decisión
  de Alex (no bloqueadas por canal), con el criterio para cuando se retomen (detección separada del
  envío). Sin riesgo, se puede mergear sola en cualquier momento.

**Dependabot majors — investigados de verdad (peer deps + build real), no aceptados a ciegas. Las 5
PRs de Dependabot (#227-230, #235) deberían cerrarse como CLOSED/superseded una vez esto se mergee:**

- `chore/recharts-3-major` — recharts 2.12.7→3.10.1. Sin conflicto de peer deps. Único cambio real:
  tipo de `labelFormatter` en `app/[tenant]/instagram/page.tsx` (`ReactNode` en vez de
  `string | null`). Build limpio en los 9 ficheros que usan recharts.
- `chore/eslint-9-config-next-16` — eslint 8→**9** (NO 10) + `eslint-config-next` 15→16, migrado a
  flat config (`eslint.config.mjs`, sustituye `.eslintrc.json`). **ESLint 10 crashea de verdad**:
  `eslint-plugin-react@7.37.5` (dependencia de `eslint-config-next@16`) llama a una API de contexto
  de regla que ESLint 10 quitó (`getFilename is not a function`) — verificado ejecutando `next lint`
  real, no en documentación. ESLint 9 resuelve limpio. Las 4 reglas nuevas de
  "React Compiler readiness" de `eslint-plugin-react-hooks@7` (`set-state-in-effect`, `purity`,
  `immutability`, `incompatible-library`) se desactivan EXPLÍCITAMENTE en el config con el motivo
  escrito: penalizan `useEffect(() => fetchX(), [...])`, patrón válido de React 18 en 109 sitios de
  esta app — adoptarlas es decisión de arquitectura para cuando se migre a React 19, no algo que
  deba colar en un bump de linter. **Si algún día se migra a React 19**: revisar si esas 4 reglas
  deben reactivarse antes de reescribir esos 109 sitios.
- `chore/tailwind-4-major` — tailwindcss 3.4.1→4.3.3. `postcss.config.js` → `@tailwindcss/postcss`
  (autoprefixer desinstalado, ya lo hace Lightning CSS). `globals.css`: `@tailwind base/components/
utilities` → `@import 'tailwindcss'` + `@config '../tailwind.config.ts'`. Un error real de tipos:
  `darkMode: ['class']` (sintaxis v3) no tipa en v4 (`DarkModeStrategy` exige `'class'` a secas o el
  par `['class', selector]`) — cambiado a `darkMode: 'class'`, misma semántica (la app usa
  `classList.toggle('dark', ...)`). **Verificado en el CSS COMPILADO** (no solo que el build no
  reviente — el primer intento con `| tail` ocultó un fallo real por la trampa del exit-code de
  `tail`, ojo con eso si se repite el build en background): el sistema de color de marca por tenant
  (`hsl(var(--brand-NNN) / <alpha-value>)`, 114 líneas de tokens) resuelve igual, incluidos los
  modificadores de opacidad vía el `color-mix()` nuevo de v4; `tailwindcss-animate` (usado por
  dialog/alert-dialog/sheet/popover/select, TODA la capa de overlays) sigue generando
  `animate-in/out`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`.
- **Los tres de arriba comparten la misma advertencia**: verificado el artefacto real (CSS
  compilado / build / lint ejecutado), no solo que compile — pero **sigue pendiente un vistazo
  VISUAL en preview desplegado** antes de mergear a main. Esta sesión no tuvo navegador. Mínimo:
  dashboard, finanzas, comisiones, y abrir un modal/dropdown cualquiera (Dialog/Select/Popover) para
  confirmar que la animación de entrada/salida se ve.

**UX R4 — arrancado, 1 de 4 hecho:**

- `chore/ux04-formato-moneda-fuente-unica` — HECHO. Barrido completo de la app: solo había un
  duplicado real de `formatCurrency`/`Intl.NumberFormat` inline (`ColaboradorDashboard.tsx`), ahora
  reusa `formatNumber` de `@/lib/utils`. Los otros 2 sitios con `style: 'currency'` fuera de
  `lib/utils.ts` (`components/metrics/KpiCard.tsx`, `settings/integraciones/page.tsx`) YA reusaban
  correctamente el helper — no tocar, no son duplicados.

### UX R4 — lo que queda, inventariado con precisión para no redescubrirlo

**REQ-UX-02 (paleta duplicada → tokens) — 7 ficheros con hex hardcodeado en vez de los tokens de
marca (`bg-brand-*`, `hsl(var(--...))`), grep exacto para reproducir:**
`grep -rEo "#[0-9a-fA-F]{6}\b" --include="*.tsx" app/ components/ | grep -v "components/ui/"`
→ `components/os/Sidebar.tsx` (8), `components/settings/EmailTemplatesPanel.tsx` (3),
`components/vsl/VslDashboard.tsx` (2), `app/[tenant]/layout.tsx` (2),
`components/os/MetaAdsDashboard.tsx` (1), `app/[tenant]/settings/integraciones/page.tsx` (1),
`app/[tenant]/instagram/page.tsx` (1). Antes de tocar cada uno: comprobar si el hex es intencional
(p. ej. un color de marca de un proveedor externo como Instagram/Meta que no debe seguir el sistema
de tokens propio) o si debería ser un token — no convertir a ciegas.

**REQ-UX-03 (escala tipográfica, falta `text-2xs`) — mucho más grande de lo que sugería el registro:
80 ficheros, cientos de usos de `text-[10px]`/`text-[11px]` en vez de un token. Grep exacto:**
`grep -rc "text-\[1[0-1]px\]" --include="*.tsx" app/ components/ | grep -v ":0$"` (top 10 por
volumen: `setting-ai/page.tsx` 22, `marketing/contenido/page.tsx` 22, `ContactsAllView.tsx` 11,
`recursos/testimonios/page.tsx` 11, `instagram/reels/page.tsx` 11...). Plan sugerido, NO ejecutado:
(1) añadir `text-2xs` (probablemente `0.6875rem`/`11px`, a decidir con Alex si hay dos tamaños o
solo uno) a `tailwind.config.ts` → `theme.extend.fontSize`; (2) sustituir mecánicamente
`text-[10px]`/`text-[11px]` por el token nuevo, fichero a fichero, con verificación visual — es
demasiado volumen para un solo PR, dividir en varios.

**REQ-UX-05 (migrar 6+ modales caseros a `components/ui/dialog.tsx`) — 14 candidatos encontrados
(el registro decía "6+", hay más). Grep exacto:**
`grep -rl "fixed inset-0" --include="*.tsx" app/ components/ | grep -v "components/ui/" | xargs grep -L "from '@/components/ui/dialog'\|from '@/components/ui/sheet'\|from '@/components/ui/alert-dialog'"`
→ `tasks/page.tsx`, `recursos/biblioteca/page.tsx`, `settings/subcuentas/page.tsx`,
`setting-ai/page.tsx`, `marketing/contenido/page.tsx`, `marketing/adquisicion/campanas/page.tsx`,
`instagram/page.tsx`, `instagram/competencia/page.tsx`, `csm-events/page.tsx`, `contratos/page.tsx`,
`finanzas/gastos-facturas/gastos/page.tsx`, `drops/page.tsx`, `components/os/MetaFunnelAssigner.tsx`,
`components/os/ScriptQueue.tsx`. **`components/os/Sidebar.tsx` salió en el grep pero es
probablemente un falso positivo** (drawer de navegación móvil, no un modal) — triar antes de tocar.
Cada uno: confirmar que es de verdad un overlay modal (backdrop + cierre) antes de migrar, y probar
visualmente que el foco/cierre con Esc/click-fuera sigue funcionando tras migrar a Dialog (Radix ya
lo da gratis, pero hay que confirmarlo).

**Por qué esta sesión no llegó más lejos en R4**: REQ-UX-02/03/05 exigen criterio visual (qué es
intencional vs qué debería ser un token, cómo se ve el resultado) que no se puede verificar sin
navegador — esta sesión no tuvo uno. El siguiente agente con `browser-testing-with-devtools` o un
preview desplegado puede ejecutar el plan de arriba con mucha más confianza que intentarlo a ciegas.

**Nota (post-merge de esta misma actualización):** el PR #241 de abajo (skill taste + paridad VSL)
ya se fusionó MIENTRAS se escribía este relevo — confirma que el aviso de concurrencia de arriba
era necesario, no teórico. Comprobar `git branch -r` de nuevo antes de reclamar cualquier fichero de
UI: puede haber más trabajo de Codebuff en curso que este documento todavía no registre.

---

## ✅ RESULTADO (27-sep): skill taste instalada + paridad VSL (PR #241)

Fusionada en `main` (`fef2673`), CI en verde (quality 1m49s con dead-code, gitleaks 7s, build 2m14s,
Smoke E2E 3m39s). Petición de Alex: instalar la skill taste para el diseño y completar las
funcionalidades de Vidalytics/PandaVideo/Wistia que "se avanzaron" y no están (el trabajo "VSL V1/V2"
de una hebra perdida nunca llegó a main — confirmado por el registro de peticiones).

- **Skill taste**: `.codebuff/skills/design-taste-frontend/SKILL.md` (taste-skill v2 de
  Leonxlnx/taste-skill, MIT) + puntero de uso obligatorio en `AGENTS.md` (design read, dials,
  bans anti-slop, pre-flight check; respeta #2563EB y copy en español; no reescribe dashboards).
- **CTA programado con auto-pausa** en `VslPlayer` (el clásico de Vidalytics): aparece al cruzar
  un % configurable, pausa el vídeo opcionalmente, cerrable (ctaOnce), URL saneada (solo relativa
  o http(s)), evento 'cta' en el latido, accesible (role/aria/foco/contraste).
- **Hitos de visión 25/50/75/95/100** en métricas (paridad reporting Vidalytics/Wistia),
  derivados de `max_position` de `vsl_sessions` — SIN migración: la config nueva es JSONB
  fusionada por `mergeConfig` y los vídeos existentes quedan con CTA desactivado.
- **Dashboard**: tarjeta "Hitos de visión" + editor del CTA (texto/URL/%/pausa/cerrable).
- **% VSL directo del reproductor (WISHLIST 4/REQ-WISH-04): ya existía** — `syncContactWatchPct`
  copia el % exacto a `contacts.vsl_watch_pct` en cada latido; lo que faltaba era el reporting de
  hitos, añadido. El webhook `vsl.progress` de la landing sigue como vía complementaria.
- **Verificado:** suite focal 6/6 (`tests/vsl-cta-paridad.test.mjs`) · quality local completo
  (966 unit / 0 fail / 3 skips, 740 métricas) · CI verde · rama borrada. **No verificado:** review
  visual del overlay/editor con navegador (sandbox sin sesión).
- **Anotado (requiere migración):** `vsl_sessions.cta_clicks` para contar clicks del CTA, con el
  lote de migraciones pendientes (misma lección de `20260922100000`).

## ✅ RESULTADO (27-sep): PR-R2.2b — allowlist de campos en `sales/complete-reservation` (PR #240)

Fusionada en `main` (`c8d70b2`), CI de la PR en verde (quality 1m30s con dead-code, gitleaks 8s,
build 2m47s, Smoke E2E 5m8s). Hallazgo P1 #1 del informe FASE A del 26-sep:

- **Allowlist del `patch`** (commit de Claude adoptado, verificado campo a campo contra la UI):
  exactamente los 24 campos de `ventas/registro/nueva`; campo fuera de la lista → 400 antes de
  tocar la base. Cerraba la escritura arbitraria de columnas de `sales` por service role desde
  roles no directivos (manager/closer/setter/cobros).
- **Extensión de esta unidad:** el insert del calendario de cuotas también recibía spread del
  cuerpo del cliente; ahora filas copiadas campo a campo contra `ALLOWED_INSTALLMENT_FIELDS`,
  400 ante campo no previsto y `sale_id`/`tenant_id` sellados por servidor (p. ej.
  `is_monitoring=true` escondía cuotas del motor de morosidad).
- **Delete de cuotas verificado** antes del insert (un fallo duplicaba el calendario) — parte
  del commit adoptado.
- **Test:** `tests/sales-complete-reservation-allowlist.test.mjs` (6 invariantes estáticos).
- **Verificado:** suite focal 6/6 · quality local completo (960 unit pass / 0 fail / 3 skips
  preexistentes, 740 métricas) · CI verde · rama borrada.
- **Sigue del informe FASE A (unidad siguiente):** `approve-review` (limpia el flag antes de
  garantizar la comisión y el retry responde 400), PATCH `reversed` sin devolver la cuota a
  pendiente, `disputed` tratado como cobrado (contradice D5 de MONEY.md).

## ✅ RESULTADO (27-sep): PR-R0.1 y PR-R0.2 del RECOVERY_ROADMAP fusionadas en main

- **PR-R0.1 — PR #237** (`579a379`): port de `docs/BASELINE_QUALITY_2026-09-26.md` desde la rama
  local `6160dc3` (único contenido no fusionado según la auditoría). Byte-idéntico salvo la
  realineación de la tabla por Prettier (texto verificado palabra por palabra). Docs-only, CI no
  corre por paths-ignore. La rama local NO se borra: conserva WIP ajeno sin commitear.
- **PR-R0.2 — PR #238** (`94e2a4d`): crons `monthly`/`reminders` sin escrituras silenciosas. En
  `monthly`, las lecturas de `tenant_members`/`users`/comisiones/plantillas se comían el error
  como "lista vacía" (sueldos del mes ausentes con `ok`); ahora verifican `{ error }`, el recorte
  de paginado (`truncated`) tumba el run y una subcuenta que falla responde 500 al trigger (rerun
  idempotente por `(auto_source, period)`). En `reminders`, la lectura de ventas fuera de ventana
  y la aprobación de comisiones verifican, el flag de limpieza de Calendly no se baja
  fire-and-forget y un fallo de subcuenta responde 500. Presupuesto 45 s repartidos entre
  subcuentas (lección 504 de calendly-ghl); el corte se declara (`cortado`) y no cuenta como
  fallo. Test estático nuevo: `tests/cron-monthly-reminders.test.mjs`.
- **Verificado:** suite focal 29/29 · quality local completo (946 unit pass / 0 fail / 3 skips
  preexistentes sin credenciales, 740 métricas) · CI de la PR verde (quality 1m39s con dead-code,
  gitleaks 8s, build 2m22s, Smoke E2E 5m9s, Vercel) · ramas borradas en remoto y local.
- **Siguiente unidad del patrón:** barrido del resto (recuento pendiente del próximo barrido); la
  R0.3 (drift ledger) sigue BLOCKED_USER sin credenciales Supabase.

## ✅ RESULTADO (27-sep): PR-R2.2 — borrado compensable de ventas y comisiones futuras verificadas (PR #239)

Fusionada en `main` (`cc2c021`), CI de la PR en verde (quality 1m25s con dead-code, gitleaks 6s,
build 2m54s, Smoke E2E 5m7s, Vercel), rama borrada. Criterio #231/#236/#238 aplicado a las dos
rutas del foco P2 del 26-sep:

- **`sales/delete`:** el snapshot de auditoría (única vía de reconstrucción tras borrar) se
  construía de 6 lecturas sin comprobar — un fallo daba un snapshot incompleto y un borrado
  irrecuperable; ahora verifican y un snapshot roto no llega a borrar. Los 5 desenlaces se
  comprueban uno a uno. El borrado del dinero (comisiones → devoluciones → cobros → venta)
  COMPENSA: si un paso falla, se restauran las filas completas del snapshot en orden inverso
  (respetando la FK `commissions.collection_id`); si la compensación también falla, el 500 ordena
  NO repetir el borrado y apunta al snapshot en `audit_logs`.
- **`commissions/future`:** las 7 lecturas se tragaban el error como "lista vacía" — fallback del
  % a 5/10, veto `pays_commissions` (MONEY D9) saltado y previsión FIFO falsa; ahora responden
  500 con motivo. Sin cambios de cálculo (`comisiones-futuras-desglose.test.mjs` en verde).
- **Test estático nuevo:** `tests/sales-delete-atomico.test.mjs` (snapshot íntegro, orden inverso
  de restauración con filas completas, mensaje anti-reintento ciego, guards de las 7 lecturas).
- **Verificado:** suite focal 24/24 · quality local completo (954 unit pass / 0 fail / 3 skips
  preexistentes, 740 métricas) · CI verde · rama borrada.
- **Anotado como unidad propia (no incluido):** `repNetCash`/`loadTramoContext` del motor de
  comisiones tragan errores por dentro; `resolverScopeColaborador` es fail-open ante fallo de BD
  (contradice el fail-closed declarado en `scope.ts`), 9 llamadores.

## PROJECT RECONCILIATION — auditoría total 27-sep-2026 (Freebuff/Buffy)

Auditoría de reconciliación completa (236 PRs, todas las fuentes de petición históricas, ramas, CI y
código). **Entregables**: `PROJECT_RECONCILIATION.md`, `FEATURE_REQUEST_REGISTER.md`,
`BRANCH_RECONCILIATION.md` y `RECOVERY_ROADMAP.md` en la raíz del repo. Resumen de estado:

### VERIFIED COMPLETE

Multi-tenancy/RLS · money path (ventas/reservas/cobros/Stripe/comisiones/socios) · F1+F2 (event core +
conectores) · webhook GHL endurecido · Calendly · funnels · Fathom + cola · grabaciones · GA4 ·
facturas IA · contratos · colaboradores · RAG/skills · aprovisionamiento · Data Health · Smoke E2E CI.

### PARTIAL

Escrituras silenciosas (crons #238 y `sales/delete`+`commissions/future` #239 cerrados el 27-sep;
queda el barrido del resto + helpers compartidos anotados) · F3 resto de fases · rename
Afiliados→Colaboradores · filtros globales (pnl/finanzas/cohorts) · deuda UX (tokens, tipografía,
formatos, modales) · Sequra monitorización · clasificación canónica de llamadas.

### BROKEN

Nada bloqueante en main (CI success 27-sep). Crons `ai-insights`/`stripe-payments` fallan en schedule
(preexistente, ajeno). `sequra-morosos` 500 por `SEQURA_MERCHANT_REFERENCE` (USER).

### IMPLEMENTED NOT MERGED

PR #225 (`feat/money-25sep`, 9 commits, 34 ficheros — del propio Alex): base 14 commits atrás con
solapes (#207–#236). NO fusionar a ciegas: rebase + resolución + quality (PR-R2.1). Doc único sin
fusionar: `docs/BASELINE_QUALITY_2026-09-26.md` (rama local) → SAFE TO PORT (PR-R0.1).

### LOST / REGRESSED

Nada perdido en ramas remotas (no existe ninguna aparte de main). Los 40 PRs CLOSED sin merge:
Dependabot superado + `codex/qa-fixes` #4 (superseded, contenido llegado por otras vías) + #210 duplicado.

### NOT IMPLEMENTED

Rate limiting login · restore drill/PITR · alertas A3 (necesitan canal) · tipado Database Supabase ·
crear usuarios desde Subcuentas · auditoría visual completa (167 reglas).

### USER ACTION REQUIRED

1. Credenciales Supabase read-only en el entorno (desbloquea drift-ledger + 3 tests) · 2) decisión sobre
   PR #225 · 3) rotaciones (Anthropic/GROQ/Management/GHL secret) · 4) SEQURA_MERCHANT_REFERENCE en Vercel ·
2. pixel + UTMs en la web real · 6) reconexiones de proveedores y workflows GHL · 7) Railway worker ·
3. retención legal (F6) · 9) majors Dependabot. Detalle: `RECOVERY_ROADMAP.md`.

### NEXT PRS IN ORDER

PR-R0.1 (port baseline doc) → PR-R0.2 (crons monthly/reminders fail-ruidoso) → PR-R0.3 (drift ledger,
BLOCKED_USER credenciales) → PR-R2.1 (port #225 con Alex) → PR-R2.2/2.3 → R3 (datos) → R4 (UX).

### CONCURRENCY NOTES

⚠️ **27-sep (Buffy): 6 ramas `claude/*` remotas son linajes HUÉRFANOS** (`git merge-base origin/main <rama>`
vacío: `claude/{comisiones-reservas-fix, app-continuation-lpbupf, socios-reparto-beneficio,
ltgp-cac-aproximado, objetivos-prevision-f65, growth-context-coste-entrega}`). Sus puntas describen
trabajo que YA ESTÁ en main vía #201/#208/#211–#213 (anterior al repunto del 19-sep). **NO fusionar
NI rebasar** (regla «sin merge-base no hay merge», caso #210); verificado contenido a contenido.
Solo `claude/socios-flecos-finales` tiene base legítima (`5114973`) — pero su hermana
`socios-reparto-beneficio` (mismo tema) ya llegó a main por #213: tratarla como superseded salvo
verificación inversa. El clon del worktree tiene refspec de rama única (`origin/main`): para
inspeccionar ramas remotas, fetch con refspec explícito.

Checkout raíz (`fix/money-path-silent-writes`) conserva WIP ajeno sin commitear (informe FASE A del
26-sep en `docs/ACTIVE_HANDOFF.md`, +176 líneas: sus hallazgos de crons/sales-delete/commissions-
future/Correo-Drops ya están resueltos por #238/#239/#233 — cerrarlos en el doc antes de publicarlo;
stash@{0} del checkout raíz es copia redundante del mismo diff): NO tocado, NO borrado.
Rama local conservada por contener ese WIP (borrar la ref no borra el working tree). `gh run list
--commit` usado para diagnóstico de CI (un run cancelled no es fallo). Sin migraciones, sin deletes,
sin merges de ramas antiguas durante la auditoría.

## ✅ RESULTADO (27-sep): webhook GHL sin escrituras silenciosas — PR #236 fusionada en main

La unidad «Escrituras silenciosas — webhook GHL» está FUSIONADA: PR #236 (merge `a595298`), CI de la
PR en verde (quality 1m54s con dead-code incluido, gitleaks, build 2m47s, Smoke E2E 4m18s, Vercel) y
rama borrada en remoto y local. El bloqueo de credencial GitHub de la tarde del 26-sep se resolvió
solo: la App volvió a mintear credenciales y la rama se publicó sin intervención manual.

- **Qué entró:** update de `appointments`, `lead_status` (ambos caminos), insert/update de
  `contact_attributions`, cualificación y `audit_logs` de citas del webhook GHL verifican ahora el
  `{ error }` y responden 500 para que GHL reintente la entrega idempotente; `last_seen_at` y
  `set_source` se degradan a warn a propósito (reintentar no los arregla). Tests estáticos nuevos
  en `tests/webhook-ghl.test.mjs` fijan el criterio: ninguna escritura de estado de negocio
  fire-and-forget.
- **Verificado:** tests dirigidos de la ruta y su capa raw 131/131; suite completa 937 pass (3 skip
  sin credenciales Supabase, preexistente) + 740 métricas; CI de la PR en verde.
- **Siguiente unidad del patrón (~76 escrituras restantes):** crons `monthly`/`reminders` (confluyen
  con los P1 del relevo del 26-sep), después `commissions/future` y `sales/delete`.

## Revisión integral: bugs de dinero (fase 1) — 2026-09-26 (Freebuff/Buffy)

**PUBLICADO: PR #231 (`fix/money-path-silent-writes`, commit `fcb6457`) abierta contra `main` con CI
en verde (quality 1m47s, gitleaks, build 2m18s, Smoke E2E 4m54s, Vercel). Fila de tablero cerrada al
publicar; el barrido de los ~88 escritos restantes queda como siguiente relevo.**

**Fila de tablero (CERRADA — publicada en #231):** Freebuff/Buffy — revisión integral de bugs y
seguridad; carril producto (cobros/comisiones/gastos). Ficheros: `app/api/[tenant]/
evergreen/collections/[id]/route.ts`, `app/api/[tenant]/evergreen/payments/mark/route.ts`,
`app/api/[tenant]/evergreen/afiliados/registro/route.ts`.

**Hallazgo estructural confirmado (el backlog lo avisaba, sin fila):** los inserts/updates de
supabase-js que no comprueban `{ error }` siguen siendo el patrón dominante — contados ~92 escrituras
`await` sin comprobar en `app/api`+`lib`. Los más caros ya corregidos (todo de dinero):

1. **DELETE de cobro (`collections/[id]`)**: el borrado de comisiones y del cobro se hacía con `await`
   plano. Un fallo silencioso dejaba **comisiones huérfanas apuntando a un cobro ya borrado** — el
   invariante exacto que S0-5 cerró. Ahora: se comprueba el error del delete de comisiones, se
   verifica con `.select('id')` que el cobro realmente se borró, y el `audit_logs` de update/delete
   ya no es fire-and-forget (un cambio de dinero sin rastro de auditoría devuelve 500 con motivo).
2. **`payments/mark`**: las tres escrituras de `sale_expected_installments` (paid/monitoring/delinquent/
   unflag) iban sin comprobar; "marcar pagada" devolvía `ok` aunque la cuota no quedara cobrada.
   Ahora cada escritura se verifica y devuelve 500 con el motivo.
3. **`afiliados/registro` (alta pública)**: el upsert de `users` tras invitar al usuario en Auth iba
   sin comprobar; un fallo dejaba **cuenta huérfana en Auth con correo enviado y sin perfil, ni código
   de tracking, ni forma de cobrar comisiones**. Ahora revierte con `deleteUser` (mismo patrón que la
   ruta de invitación) y avisa.

**Verificado local:** typecheck OK · format:check OK · 928/928 unit (3 skips de credenciales, como
en el baseline) · 740/740 métricas · 21/21 y 46/46 en suites focales de aislamiento/comisiones/
webhook GHL. E2E Playwright no ejecutable en este sandbox (sin `E2E_PASSWORD`); corre en CI.

**Seguridad (spot-check, inspeccionado no probado en vivo):** webhooks GHL/contract/onboarding
comparan secreto con `timingSafeEqual` (`lib/webhooks/verifySecret.ts`); Stripe verifica firma sobre
el body crudo; Resend svix fail-closed; `ver-como` exige OTP + coincidencia de sesión y audita. Sin
nuevo hallazgo P0. El invariante de esquema vivo (`esquema-tenant-invariante.test.mjs`) corre en CI;
aquí se salta sin credenciales.

**Desfase confirmado (no corregido, fila de Claude Code):** `lib/types/database-generated.ts` NO
contiene las 9 columnas de `20260922100000` (invoice__, paid_at, paid_from_account,
payment_reference, counterparty__). La pantalla de gastos usa tipos a mano en la propia página, por
eso typecheck no lo caza: es otra señal de que **la migración sigue sin aplicar en producción**.

**Queda (priorizado):** (1) el barrido de los ~88 escritos sin comprobar restantes, empezando por
webhook GHL (`contact_attributions`, updates de citas) y crons; (2) smoke con navegador cuando haya
preview/credenciales E2E; (3) regenerar tipos tras aplicar la migración pendiente; (4) pulido UX/UI
global (F3/Taste) — explícitamente DESPUÉS de estabilizar.

## MONEY.md v1 en main + relevo de la PR #210 — 2026-09-25 (Freebuff/Buffy)

**Estado real del vocabulario financiero (F3):** `MONEY.md` v1 está en `main` desde #209 (`43f78e5`):
booked/collected mapeados a Contracted Revenue y Cash Collected; billed y recognized declarados
abiertos (A1/A2) sin cálculo a medias; mecánica bruto/atribuible SIN modo oficial (D1); EUR por
tenant con FX a la fecha del hecho (D2); IVA bruto para negocio (D3); fees solo en P&L (D4);
refunds cuando ocurren y disputas a cola de revisión (D5); cash manual deduplicado por
`payment_reference` (D6); comisiones, cuotas y financiación neta (D7). La auditoría de Claude Code
(#212/#213) añadió encima D8 (reservas no comisionan hasta completar), D9 (`pays_commissions` veto
absoluto) y D10 (token compartido nunca sincroniza "todas" sin selección) — compatible, no conflicto.

**PR #210 cerrada como sustituida (no fusionada).** Su rama `docs/money-v1-cierre` era un linaje
huérfano (sin merge-base con `main`, exactamente el caso de las reglas de trabajo del 21-sep): lo
único exclusivo que contenía era este texto de relevo, que entra ahora por esta PR. Verificado antes
de cerrarla: ni `MONEY.md` ni ningún otro fichero del linaje tenía contenido que no estuviera ya en
`main` (comparado commit a commit).

**Pendiente de Alex:** validar las decisiones y desbloquear las que quiera (sobre todo A3 — el modo
oficial del consolidado — y A5 clawback). Ninguna bloquea código hoy. El tablero queda con la
migración `20260922100000` como única fila activa (prioridad 1 de Claude Code).

## Auditoría financiera: reservas, comisiones, socios y gasto de Meta — 2026-09-25 (Claude Code)

**Fusionado en `origin/main`:** PR #211 (`1bb4e5b`), #212 (`5114973`), #213 (`2d73520`). Origen: Alex pidió auditar comisiones/reservas/gastos tras sospechar errores reales (no una tarea de roadmap). Se encontraron y corrigieron 4 bugs de negocio distintos, todos con impacto real en producción:

- **Reservas comisionaban al instante.** `saleNeedsCommissionReview` (`lib/commissions/generate.ts`) ahora bloquea la comisión de un cobro de reserva (`plan.method === 'reserva'`) mientras `reservation_completed_at` siga null; se reabre y reconcilia al completar la reserva. Una reserva abierta tampoco cuenta ya como venta/cliente (`esReservaAbierta`, `lib/metrics/agregados.ts`).
- **`users.pays_commissions` existía en producción (sin migración en el repo) pero ningún código la leía.** Ahora se respeta en `calculateCommissionsForCollection`, en el Dashboard de Comisiones y en `commissions/future` (proyección). Un socio marcado así puede seguir comisionando por error si algo nuevo genera comisiones sin pasar por estos puntos — grep de `pays_commissions` antes de tocar el motor de comisiones.
- **`resolveMetaConfigs` trataba "sin cuenta seleccionada" como "sincroniza todas las que vea el token."** Un token de Meta Business Manager que ve cuentas de OTRO negocio mezclaba 164 campañas / ~190.081 € de gasto / 16.552 € ya en `expenses` de este tenant. Corregido: exige selección explícita o `META_AD_ACCOUNTS_ALL` puesto a propósito. Datos ya limpiados en producción.
- **No existía ningún sitio para ver las ganancias reales de un socio en €** (solo el % configurado en `/settings/socios`, que además no estaba enlazada en el menú). Nuevo `/finanzas/socios` + `lib/finance/socios.ts` (puro): reparte el Pre-Tax Profit del periodo entre socios activos. Un socio vinculado por `partners.user_id` (columna nueva) ve su propia ganancia en el Sidebar sin necesitar rol de dirección.

**Corrección de datos en producción (con confirmación explícita de Alex en cada decisión):** reclasificada una venta de 50€ importada mal desde Stripe como la reserva que era; eliminadas 3 comisiones de reserva nunca completada; **eliminadas las 43 comisiones históricas de closer de una socia marcada `pays_commissions=false`** (1.992,20€, decisión explícita: nunca representaron dinero transferido, su compensación es el reparto de socios); limpiados los 164 campañas/gasto ajeno de Meta.

**Documentado para que no se repita:** `docs/MONEY.md` D8 (reservas no son venta ni comisionan hasta completar), D9 (`pays_commissions` es veto absoluto, en generación y lectura), D10 (integración con token compartido nunca sincroniza "todas" sin selección explícita). `PROJECT_CONTEXT.md` §14 tiene el resumen operativo de los 4 patrones de bug (regla de negocio "a medias", columna sin migración que nadie lee, "vacío" como default peligroso, fix de código que no repara datos ya escritos).

**Verificado:** CI de las 4 PRs en verde (quality, build, Smoke E2E — un fallo de Smoke E2E en #211 confirmado como flake ajeno, tests/e2e/contacto-ficha, re-run verde). Local: typecheck exit 0, 902/905 unit (3 fallos preexistentes de esquema Supabase en vivo, sin relación), 719/719 métricas (incluye tests nuevos de `lib/finance/socios.ts` y los de Meta reescritos a la nueva política de selección de cuentas).

**Queda pendiente, no abordado en esta auditoría:** claridad de pagos/impagos por cliente y KPIs personales en tiempo real — revisados (`ventas/pagos`, `ventas/registro/[id]`, Dashboard de Comisiones) y ya cubren bien lo pedido, no se tocó código ahí.

## F3 trozo 1: contrato de métrica versionado — 2026-09-24 (Freebuff/Buffy)

**Fusionado en `origin/main`:** PR #202 (squash `48e32be`, rama `feat/f3-metric-definitions` borrada). `lib/metrics/definiciones.ts`: `DefinicionVersionada` (version, grain period/cohort, ventana de maduración, muestra mínima, lineage) construida DESDE el registro canónico, y `evaluarDefinicion` que etiqueta cada resultado (`muestra_insuficiente`, `en_maduracion`) sin sustituir el valor. MER y refund_rate declaradas con fórmula y motivo, sin cálculo a medias. 14 tests con golden fixtures deterministas (show_rate 70.59, close_rate 25, CAC 1249.99, ROAS) en `tests/metrics/f3-definiciones.test.mjs`.

**Verificado:** CI de la PR y de `main` (run 36069960953) en verde; local: 693/693 métricas, 894/897 unit, typecheck exit 0.

**Queda de F3:** `MONEY.md` (decisión financiera: booked/billed/collected/recognized, bruto vs atribuible, FX, IVA, fees — requiere validación de Alex; el plan dice "si bruto vs atribuible no está decidido, implementar ambos y NO marcar ninguno como oficial") y cablear `MetricaPublicada` en consumidores de UI/API. Conectado con #201 (anotaciones, más abajo): las marcas describen periodos, no fechas — el grain del contrato ahora lo hace declarable por métrica.

**Incidente CI en `main` (2026-09-25):** el run del squash de #203 (`67d3ae5`, run 36070984980) falló SOLO en Smoke E2E: `TimeoutError: page.waitForURL` en `tests/e2e/global-setup.mjs:48` — el login del global-setup no navegó a `**/qa-e2e/dashboard` en 30s tras crear el tenant. No es regresión de código: el mismo árbol pasó el mismo E2E en la PR #204 (cuyo HEAD incluía #203 vía merge). Sin permiso para `gh run rerun`, la validación verde del árbol idéntico quedó en la PR #205 (run 36098777163, Smoke E2E 4m52s). Ojo con el mecanismo: los pushes docs-only a `main` no crean run (paths-ignore) — un commit de docs NO re-lanza el CI de main; el commit vacío solo funciona como workaround en ramas de PR. Conclusión: flakiness transitorio del login del global-setup; si se repite, añadir reintento/timeout ahí, no revertir #203. Hallazgo añadido al diagnosticar el incidente: la concurrencia del workflow es GLOBAL (un solo run a la vez en todo el repo, no por rama) — un push de cualquier PR cancela los runs en marcha de las demás (pasó con esta misma nota: su primer run fue cancelado a mitad de build por el push de `claude/growth-context-coste-entrega`; cancelled ≠ fallo). Al coordinar en paralelo: no pushear encima del run ajeno en marcha y re-disparar con commit nuevo cuando la ventana esté libre.

## Anotaciones en gráficos + limpieza de tipos — 2026-09-24 (Claude Code)

**Fusionado en `origin/main`:** PR #201 (squash `72fe57b`). Cierra tres pendientes de la sesión
anterior:

- **#66** — tabla `annotations` (fecha, título, descripción, categoría, autor) para marcar
  picos/valles en `TrendChart`. Migración `20260924100000_annotations.sql` con RLS calcada de
  `ai_business_facts` (el equipo lee y anota, el autor o admin/director corrige o borra,
  aislamiento por tenant vía `auth_tenant_ids()`). API en `/anotaciones` y `/anotaciones/[id]`,
  componente `AnotacionesInspector`, wiring de ejemplo en `analitica/embudo`.
- **#54** — eliminados los `any` restantes de `setting-ai`, `carruseles/*` y `VslPlayer`. De paso
  corrigió un bug real: el contador `convo` de las correcciones automáticas de setting-ai nunca se
  guardaba (el panel mostraba "CNaN" en vez del número de conversación).
- **#53** — verificado que ya estaba resuelto por trabajo previo (`cascada-sesion.test.mjs`,
  17/17). Sin cambios de código, solo confirmación.

**Migración aplicada y verificada en producción** vía el conector MCP de Supabase, sin depender de
red local (ver "Puedo hacer mejor que Freebuff" más abajo): 5 políticas RLS confirmadas por SQL
directo contra `pg_policies`, `get_advisors` sin hallazgos nuevos.

**CI se puso rojo, causa raíz encontrada y arreglada sin reabrir el PR**:
`tests/esquema-tenant-invariante.test.mjs` falló porque `lib/types/database-generated.ts` no traía
la tabla nueva. `npm run tipos:bd` no pudo correr en este sandbox (sin red real a Supabase,
`.env.local` con placeholders); se añadió el bloque `Annotations` a mano siguiendo el patrón
mecánico del generador (todo opcional/nullable, igual que el resto del artefacto) y se verificó
1:1 contra las 111 tablas reales del esquema vivo vía el conector — 0 faltan, 0 sobran. CI en
verde tras el push; PR mergeado.

**Extra — `CRON_SECRET` creado en Preview** (Vercel, proyecto `growth-ops`). Llevaba desde el
21-sep como bloqueo abierto ("CRON_SECRET existe solo en Production... bloquea el staging que F1
necesita") sin que nadie lo tocara; verificado hoy que seguía faltando. Es aditivo, no toca
Production ni sustituye ningún valor existente: cualquier disparo manual de cron sobre un preview
deja de devolver 401 por falta de secreto.

**Verificado hoy — estado real de los bloqueos de hace 3 días (nada ha cambiado salvo lo de
arriba)**:

- `RESEND_API_KEY` sigue marcada `readable-secret` en Vercel. No se puede rotar desde aquí: hace
  falta que Alex regenere la clave en el dashboard de Resend primero.
- El repo sigue público (decisión ya tomada, no es una regresión).
- El proyecto `go-prod` de Vercel sigue existiendo, vacío (`live: false`). No lo he borrado sin
  confirmación explícita de hoy — es una acción destructiva sobre infraestructura compartida y la
  aprobación de la sesión del 21-sep no cuenta como vigente.
- `growth_context` (bloqueo de #57): **parcialmente relleno, no vacío como se creía**. Tiene
  `business_type` = "Formación B2C", `offer_price_eur` = 1996.97, `target_monthly_revenue_eur` =
  30000, `target_cash_roas` = 4.00. **Faltan**: `target_ltgp_cac`, `capacity_calls_per_week`,
  `capacity_active_clients` — sin esos tres, el motor de objetivos/previsión (#65, en curso) sigue
  sin poder calcular ritmo ni capacidad aunque el código (`lib/metrics/series.ts`) ya esté listo.

## F2 completa: Stripe sobre el contrato — 2026-09-24 (Freebuff/Buffy)

**Fusionado en `origin/main`:** PR #199 (squash `9f8ba50`, rama `feat/stripe-conector-f2` borrada). El conector de Stripe completa el alcance de F2 (GHL #185, Meta #187, Stripe #199). Envuelve el webhook y el sync ya probados sin reescribir semántica económica: `normalize` delega en `derivarStripe` (`lib/eventos/stripe.ts`), `backfill` en `syncStripePayments`, salud con `GET /v1/balance` del cliente existente. Fixture sanitizado + 7 tests nuevos en la suite de contrato; el marcador `pendientesDeMigrar` ya no lista Stripe.

**Verificado:** CI de la PR en verde (quality 1m28s, gitleaks, build 2m54s, Smoke E2E 4m40s, Vercel) y CI de `main` en verde sobre el squash (run 36061066607, los 4 jobs). Validación local previa: 30/30 en contrato+arquitectura, 894/897 unit (0 fallos, 3 skips), 679/679 métricas, typecheck exit 0.

**Queda de F2:** nada de código. Los conectores restantes del catálogo (Calendly y demás) no formaban parte del alcance declarado del plan ("solo GHL, Stripe y Meta"); migrarlos sería decisión de relevo, no deuda.

## Lote facturas IA + comisiones lote + contratos externos — 2026-09-23 (Freebuff 7a08c143)

**Publicado en `origin/main`:** #192 (`4293c06`, facturas IA — identidad del emisor y trazabilidad del pago), #190 (`09afde9`, comisiones: aprobar/liquidar en lote), #191 (`ec708a7`, contratos: adjuntar firmado externamente + verificación de identidad pospuesta). Los tres con quality, build, Smoke E2E y Vercel en verde. Ramas remotas ya eliminadas.

**🔴 Bloqueo URGENTE — migración `20260922100000_invoice_ai_identity_traceability.sql` SIN APLICAR en producción.** La UI de Gastos ya desplegada en Vercel hace `INSERT` con las columnas nuevas: **crear un gasto o marcarlo pagado falla hasta aplicar la migración**. Las lecturas (`select *`) siguen funcionando. No se pudo aplicar desde la máquina local: el host `db.***.supabase.co` solo resuelve por IPv6 y esta red no tiene ruta IPv6; el pooler tampoco es alcanzable. Instrucción exacta para el siguiente relevo:

1. Desde cualquier entorno con salida a Supabase (otra red, o la CLI/SQL editor del Dashboard): dry-run obligatorio por reglas del repo — `BEGIN;` + DDL del fichero `supabase/migrations/20260922100000_*.sql` + `ROLLBACK`, verificar que añade 9 columnas a `expenses` y 2 índices parciales; después aplicarlo de verdad (`supabase db push` o pegarlo en el SQL editor del Dashboard).
2. Regenerar tipos: `npm run tipos:bd` y commitear `lib/types/database-generated.ts` si cambia.
3. Verificar: crear un gasto de prueba desde la UI y marcarlo pagado; borrarlo.

**Notas:** el checkout de `~/Documents/.../Scalix Systems App` sigue siendo el linaje viejo con WIP ajeno sin commitear — no se ha tocado. El preview de este hilo corre en `/tmp/growthops-preview-3003` (launchd `growthops-preview-3003`, puerto 3003) sincronizado a `ec708a7`.

## Cierre de consolidación — 2026-09-22

**Estado publicado:** `origin/main` está en `c2c3e6a33a847b9d3220b9783a01106dc87f73c8`, commit squash de la PR #173 (`docs: consolidate handoff and user blockers`). Contiene la PR #172 (`269754f`) de custom fields/hardening y la PR #171 (`24a9646`) de coordinación. Las tres ramas remotas fueron eliminadas. Los checks de código de #171 y #172 (quality, gitleaks, build y Smoke E2E) terminaron en verde; #173 solo cambió documentación y no generó un workflow nuevo por `paths-ignore`. No se aplicó manualmente ninguna migración en producción.

**Regla de verdad:** el checkout compartido `claude/constitucion-y-fases` sigue en `2af651a` y conserva WIP local de varias áreas; no se ha publicado ni mezclado automáticamente. No debe afirmarse que "todo" el trabajo de las hebras está en `main` hasta separar cada bloque, probarlo y fusionarlo como PR atómico. No hacer `git reset`, `git clean`, `git add -A` ni copiar desde `/tmp` sobre esa carpeta.

**Aprendizajes incorporados:** verificar siempre `origin/main` y el merge-base antes de editar; una sola rama/PR por unidad; pathspec explícito al commitear; diagnosticar CI por SHA final y no por runs cancelados; comprobar esquema vivo antes de escribir SQL o queries; ejecutar `BEGIN … ROLLBACK` funcional antes de aplicar migraciones; no convertir fallos de fuente en ceros; no guardar PII, tenants, clientes o credenciales en código/documentación; y distinguir inspeccionado, probado y verificado en producción.

**Bloqueo conocido:** sigue pendiente el dry-run SQL en QA de `cleanup_custom_field_values()` tras revocar `EXECUTE` público: comprobar trigger, limpieza JSONB y rechazo de RPC directa. La migración no se ha aplicado manualmente en producción.

**Trabajo de las hebras referenciadas que NO se puede declarar publicado sin un PR/SHA verificable:** integraciones Hotmart/TikTok/Instagram DM, VSL V1/V2, callback OAuth de YouTube, trazabilidad IA de facturas, comisiones por lote, adjuntos de contratos, custom fields del WIP compartido y cualquier migración creada localmente. Revisar cada bloque contra `git log origin/main`, no confiar en mensajes de sesiones anteriores.

**Siguiente relevo:** trabajar únicamente desde un checkout limpio de `origin/main`; reclamar el área en el tablero; separar primero seguridad/migraciones, después integraciones con credenciales reales y por último UX; cada bloque debe incluir regresión, quality/build proporcional, CI por SHA y evidencia de deploy si aplica.

## Candidato aislado de custom fields — 2026-09-22

Checkout creado desde `origin/main` (`2ec86f5`), sin commit ni push. El diff intencionado contiene únicamente: aislamiento de cuotas/cobros/comisiones por `sale_id` y `tenant_id` en la ficha, regresiones focales de custom fields, y la migración `20260922130000_revoke_custom_field_cleanup_execute.sql`. La migración canónica `20260921200000_contact_custom_fields.sql`, la API y los tipos ya existen en `origin/main`; no se duplican.

Quedan expresamente fuera contratos, colaboradores, RAG, facturación, IA, integraciones, dashboards, archivos generados y secretos. Validación pendiente: ejecutar tests, typecheck, formato y un dry-run QA de la revocación antes de abrir PR. No afirmar que la revocación está aplicada en producción hasta verla en la lista de migraciones y confirmar que el trigger sigue limpiando `contacts.custom_fields`.

> **Lee esto entero antes de tocar nada.** Este documento es el punto de coordinación entre los
> agentes que trabajan en el proyecto (Claude Code, Freebuff, Codex, Copilot). Debajo de la sección
> "Estado" hay un histórico por hebras que se conserva como registro; lo vigente es lo de arriba.

## CODEX — DASHBOARD & METRIC AUDIT

**2026-09-25 — EN CURSO, NO CERTIFICADA.** Base `7a150cc`; rama única `codex/dashboard-metric-audit`. Matriz: [DASHBOARD_AUDIT.md](../DASHBOARD_AUDIT.md). Plan: [DASHBOARD_CORRECTION_PLAN.md](../DASHBOARD_CORRECTION_PLAN.md). No confundir inspección de código con revisión visual completa.

### COMPLETED

- Skills de marketing/copywriting y sales-engineering del proyecto, MONEY/METRICS y contratos existentes revisados.
- Inventario por rutas; trazabilidad de métricas críticas de dashboard, analytics, funnels, marketing, CRM, ventas, comisiones, finanzas, delivery y Ask.
- Consultas de producción de solo lectura: cobertura, asignación, estados, monedas y jobs. Evidencia real comunicada privadamente; documentos sin datos de tenant.
- Prueba de lectura RLS con rol autenticado de colaborador y rollback: scope excesivo demostrado (F01). Endpoints privilegiados revisados (F02); HTTP por rol pendiente.
- Reproducciones sintéticas: reserva abierta, cobro pendiente, moneda ignorada y refund de cobro antiguo. No se modificaron datos, roles, políticas ni integraciones.
- Quality local PASS: format/lint/typecheck, unit 902 pass / 3 skipped / 0 fail, métricas 729 pass. Build PASS; knip informativo ejecutado. Sin E2E ni browser del build modificado. Producción aún anterior.
- Browser admin: paneles principales, campañas/Meta, Instagram, CRM/ventas/comisiones, finanzas/cohortes, alumnos/CSM/bajas, Data Health, contenido/Setting AI. Interacciones y pendientes exactos en DASHBOARD_AUDIT.md.
- Incidente Ver como: contrato ocultó retorno; salida dejó cookie auth HttpOnly. Se eliminó únicamente sesión local defectuosa, usuario volvió a iniciar sesión y dashboard admin verificado. No repetir impersonación. F21 código pendiente.

### SAFE FIXES APPLIED

- `lib/ai/agent/tools.ts`: HEAD de contactos devuelve count, no filas; Ask ahora conserva total/0/null. Test nuevo `tests/metrics/agent-overview-count.test.mjs` falló en 12 y 0 antes, pasa después.
- F19: filtros tenant en dashboard/unit-economics/finanzas resumen,P&L,cohortes,proyección; usuarios por membresía. F20: CTR multiplicado por 100. Regresiones en tests/metrics/dashboard-tenant-scope.test.mjs (dos tenants y n=0).
- Documentos actualizados F01–F25. Correcciones en rama, sin despliegue. CRM/alumnos/selectores globales y seguridad siguen pendientes.

### USER ACTION REQUIRED

- Admin ya operativo. Roles restantes requieren acceso existente de prueba; no firmar contratos ni ampliar permisos.
- Confirmar setters y mapping real de citas/ventas sin asignar; confirmar enlaces venta-cita y asistencia provisional con evidencia. Preparar lotes privados, jamás IDs reales en Git.
- Indicar inicio esperado de histórico por fuente/cuenta para poder cuantificar huecos; primer registro importado no demuestra completitud.

### EXTERNAL BLOCKERS

- Colaborador bloqueado en UI por contrato; no omitirlo. Mobile, exports y otros roles siguen sin validar.
- Conversaciones orgánicas sujetas a acceso del proveedor. Logs de timeout y éxito mezclados requieren revisión por job, no un diagnóstico global de integración rota.

### BUSINESS DECISIONS REQUIRED

- Pendientes de MONEY (modo bruto/atribuible y fuente FX, billed/recognized/clawback cuando se activen).
- Grano clientes únicos vs ventas en cohortes, close rate total vs cualificado y ventanas de maduración por oferta/canal. No sustituir definiciones por benchmark.

### FINDINGS BY PRIORITY

- **P0 F01–F02:** colaborador lee equipo por RLS; APIs Funnels/VSL usan privilegio sin scope de rol suficiente. Coordinar carril de seguridad antes de migrar.
- **P1 F03–F10,F13:** reservas contadas de forma distinta; FX ausente; refunds/fechas y cash heterogéneos; filtros del resumen; población del funnel; diagnóstico sin gates; cohortes inmaduras; capa AI divergente; errores como cero financiero.
- **P2 F11–F12,F14–F18:** mapping/asistencia/histórico; fronteras temporales; proyección/morosidad; filtros atribución; control Data Health usa name no seleccionado; delivery no acredita retención.
- **P0 F19:** datos de otra subcuenta en panel seleccionado, fix local parcial. **P1 F20:** CTR, fix local. **P2 F21–F23:** retorno de sesión, ratios sin muestra, webhook sin actividad.
- **P3:** desktop revisado parcialmente; gastos tiene etiquetas recortadas y dashboard prioriza tabla de comisiones sobre KPIs. Responsive pendiente.

### DATA GAPS

Asignaciones y enlaces incompletos, notas provisionales, fuentes de vídeo/conversaciones sin datos y fecha histórica esperada sin acreditar. Alcance exacto en plan. **Ningún hallazgo clasificado como problema real de negocio fuera de KPI.** Orden obligatorio: definición → fuente → completitud → periodo → maduración → asignación → cálculo → benchmark orientativo.

### NEXT RECOMMENDED WORK

1. Resolver P0 con dry-run y contrato por rol; no confiar en UI.
2. Funnels desktop/móvil ya observado: F24 ancho=1 cuando primera etapa cero; F25 HTTP400 con sintaxis NOT sospechosa. Sin fix aún. Unit-economics móvil solo cabecera/filtros (sin overflow); viewport restaurado. Continuar eventos/socios/Brief/integraciones/recursos/Person360, roles/exports. Sesión admin activa, no Ver como.
3. Corregir P1 en unidades pequeñas, comparar UI/API/AI con mismo scope y datos sintéticos.
4. Obtener mappings/fechas humanas y ejecutar backfill auditado en unidad separada.
5. Actualizar scorecard y cerrar solo al verificar todos los módulos/roles críticos. La auditoría permanece abierta.

### CONCURRENCY NOTES

Checkout alternativo antiguo conservado intacto: WIP de comisiones, dashboard de colaborador, clasificación nuevo/recurrente y documentación de otros agentes. Migración/gastos `20260922100000` y tipos BD reclamados por Claude Code: no tocados. No reset, stash, rebase ni force push. No se desplegó ni fusionó este trabajo.

## Tablero de reclamaciones (en curso AHORA)

**CODEX — DASHBOARD & METRIC AUDIT (25-sep):** Ampliación tras browser: reclama filtros tenant en `dashboard/page.tsx`, `unit-economics/page.tsx`, `finanzas/analitica/{resumen,pnl,cohortes,proyeccion}/page.tsx`, CTR en `marketing/adquisicion/campanas/page.tsx` y tests asociados. No toca RLS ni motor financiero. auditoría transversal solicitada por el usuario; rama `codex/dashboard-metric-audit`. Reclama `DASHBOARD_AUDIT.md`, `DASHBOARD_CORRECTION_PLAN.md`, sección propia de relevo y fix acotado del conteo HEAD de contactos en `lib/ai/agent/tools.ts` con `tests/metrics/agent-overview-count.test.mjs`. Inspección de código y producción de solo lectura; ningún cambio de datos. No tocar el WIP del checkout Documents ni las migraciones/gastos reclamados por Claude Code. Regla KPI: definición → fuente → completitud → periodo → maduración → asignación → cálculo → benchmark orientativo.

Carriles y reglas en `AGENTS.md` › "Trabajo en paralelo". **Antes de empezar, añade tu fila; al
fusionar, bórrala.** Si lo que vas a tocar está aquí a nombre de otro, no lo toques.

| Agente            | Qué                                                                                                                                                                                                                                                                                                                                                                                            | Rama           | Toca                                                                                            | Desde  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- | ------ |
| Claude Code       | **🔴 PRIORIDAD 1 absoluta (encargo de Alex, 25-sep): aplicar la migración `20260922100000` en producción ANTES que cualquier otra tarea.** Pasos exactos en la sección «Lote facturas IA…» de más abajo: dry-run `BEGIN…ROLLBACK` (9 columnas en `expenses` + 2 índices parciales), aplicar, registrar versión en `schema_migrations`, regenerar tipos y verificar crear/marcar gasto en la UI | (por reclamar) | `supabase/migrations/20260922100000_*.sql`, tabla `expenses`, `lib/types/database-generated.ts` | 25-sep |
| Freebuff 7a08c143 | **Facturas IA + comisiones lote + contratos externos**: fusionado en #190/#191/#192. 🔴 Pendiente: aplicar migración `20260922100000` en producción (ver sección arriba; bloqueada por red IPv6 desde local) y regenerar tipos — **25-sep: Alex lo encargó a Claude Code como prioridad 1 (ver su fila)**                                                                                      | (fusionadas)   | solo `expenses` vía migración pendiente; nada en código                                         | 23-sep |

## Reglas de trabajo (2026-09-21)

Se escribieron tras encontrar una carpeta local que llevaba días trabajando sobre un linaje de git
**sin ancestro común** con `origin/main`: todo lo hecho ahí era irrecuperable por merge. Existen
para que no vuelva a pasar.

1. **Una sola carpeta local y un solo repo.** El repo es
   `github.com/torrealex97-star/Growth-Ops-App`. La carpeta de trabajo es
   `~/GIT HUB/Growth-Ops-App`. No se crean clones paralelos "para probar".
2. **Al empezar sesión, comprueba que no has derivado**:
   ```
   git fetch --prune && git rev-list --left-right --count main...origin/main
   ```
   Cualquier cosa que no sea `0 0` (o un simple "detrás") se investiga **antes** de escribir código.
   Si `git merge-base main origin/main` no devuelve nada, la carpeta no sirve: para y avisa.
3. **Rama corta, PR, merge.** Una rama por unidad de trabajo, PR en cuanto haya algo coherente y
   merge a `main` con CI en verde. Nada de acumular días sin pushear: lo que no está en `main` es
   invisible para los demás agentes y para Alex desde el móvil.
4. **Ramas vivas, las mínimas.** Tras mergear se borra la rama. Una rama que sobrevive a su PR es
   trabajo que otro agente rehará sin saberlo.
5. **Antes de empezar algo, mira si ya está hecho.** Lee esta sección y `git log origin/main`. Si
   dos agentes pueden tocar lo mismo, decláralo aquí primero.
6. **Actualiza este documento al terminar**, aunque quede a medias: qué tocaste, qué validaste de
   verdad y qué queda. Un relevo que no se escribe no existe.
7. **Nada de PII ni credenciales en commits.** El repositorio es **público**: `docs/SECURITY_PRIVACY.md`.

## Estado (2026-09-21, tarde — hebra Freebuff 4250bf8e)

**Citas (Calendly/GHL) arregladas — #108 + #110 + #112 fusionados.** Síntoma: la semana mostraba
1 agenda con muchas más en Calendly/GHL. Causa raíz: la sync de citas solo existía como botón
manual (history-sync), la importación del 12-sep jamás tuvo planificador y ni un run de estos
proveedores en `integration_sync_runs` desde entonces. Ahora: **cron diario de Calendly**
(04:20 UTC, ventana 14 días, upsert idempotente, presupuesto 35 s) por GitHub Actions; **GHL va
SOLO por botón** — su API lista todos los contactos de la ubicación antes de tocar eventos y no
cabe en los 60 s de Vercel Hobby (dos pasadas en producción: 504 y run colgado en 'running'; el
webhook cubre el tiempo real). Implementación única en `lib/integrations/citas-sync.ts`
(botón + cron comparten código; test prohíbe duplicarla). `SYNC_DEFS` declara `calendly-citas`
y `ghl-citas` (route: null + manualReason). Resultado verificado en BD: 1 → **16 citas esta
semana** (+19 importadas, 67 actualizadas; 0 duplicados GHL↔Calendly en 30 días).

**Ops extra de la misma sesión**: migración `20260918140000` (meta_actions/meta_action_values de
`campaign_daily`) estaba SIN aplicar en producción — el cron `meta-daily` llevaba días en error
"schema cache". Aplicada, registrada en `schema_migrations` y `NOTIFY pgrst 'reload schema'`
verificado vía REST. También se cerró a mano el run de GHL que quedó colgado en 'running'.

Tests: 519 → 568 (la otra hebra añadió los suyos); `tests/cron-calendly-ghl.test.mjs` fija los
invariantes (auth CRON_SECRET, config por subcuenta, idempotencia, no-colisión de horarios,
GHL prohibido en el cron, una sola implementación).

## Estado (2026-09-21)

`main` al día, sin PRs abiertos ni ramas de trabajo vivas.
**582 tests, 579 pasan, 0 fallan** (3 se auto-saltan sin credenciales y sí corren en CI) ·
**666 de métricas, todos pasan** · `typecheck` exit 0 · 68 migraciones.

### Fases

| Fase | Entregable                                                                                                                                                            | Estado                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| S0.1 | `docs/S0-1-INVENTARIO-CAPACIDADES.md`                                                                                                                                 | cerrada                               |
| S0.2 | `docs/S0-2-JOURNEYS-CRITICOS.md`                                                                                                                                      | cerrada                               |
| S0.3 | `tests/webhook-ghl.test.mjs`                                                                                                                                          | cerrada                               |
| A0   | `docs/A0-CIERRE-AUDITORIA.md`                                                                                                                                         | cerrada                               |
| F-1  | `tests/agente-contenido-hostil.test.mjs`, `tests/invariante-tenant-negativo.test.mjs`, `lib/seguridad/invariante-tenant.ts`, fixtures A/B, 2 migraciones de seguridad | cerrada salvo lo de Alex              |
| F6   | `docs/F6-MAPA-PII.md`, `lib/privacidad/{plan-borrado,erase-person}.ts`                                                                                                | implementada y probada; **no gradúa** |
| S0.5 | `docs/S0-5-CONSISTENCIA-DATOS.md`, `scripts/consistencia-cash.sql`                                                                                                    | cerrada                               |
| S0.8 | `docs/S0-8-GRADUACION.md` + `CAPABILITIES.md` — **S0 GRADÚA**: ningún P0 abierto, P1/P2 con dueño y fase                                                              | cerrada                               |
| S0.6 | `docs/S0-6-RENDIMIENTO-FRONTEND.md`, `scripts/rendimiento-baseline.sql` — baseline medido + el fallo de lectura ya no se pinta como 0 €                               | cerrada                               |
| S0.7 | `docs/S0-7-INTEGRACIONES.md` — baseline de las 13 integraciones + 2 arreglos de webhook                                                                               | cerrada                               |
| S0.4 | `docs/S0-4-BARRIDO.md` — 6 resueltos (1 P0 pendiente de aplicar), resto con dueño                                                                                     | cerrada salvo aplicar el P0           |

El plan completo vive en `docs/plan/`. Empieza por su README.

### Lo siguiente, en este orden

1. **Resolver lo pendiente listado abajo.**
2. **F1 en curso** (event core), por trozos:
   - **Trozo 1 (#180, fusionado):** el webhook de GHL guarda el sobre en bruto ANTES de procesar, con
     identidad estable (id de GHL o huella determinista), propiedades sin PII y cierre del sobre en
     las ocho salidas.
   - **Trozo 2:** `canonical_events` derivado del sobre al terminar (con los vínculos de contacto y
     cita ya conocidos), correcciones como hecho nuevo que apunta al original —nunca reescritura— y
     tabla `event_types` sembrada desde `lib/eventos/canonico.ts`.
   - **Trozo 3:** reprocesado (`lib/eventos/replay.ts` + `POST /api/[tenant]/evergreen/eventos/replay`).
     Simula por defecto (hay que pedir `simulacion: false` a propósito), es reanudable por cursor
     `(received_at, id)`, idempotente, no toca el sobre y no reasigna contacto ni cita. Acceso:
     admin/director o `Bearer CRON_SECRET`.
   - **Trozo 4:** Stripe por el mismo camino. Su webhook ya guardaba el sobre; ahora deriva el hecho
     conservando la clase que decide `lib/stripe/webhook.ts` (de los tres eventos por pago, solo uno
     es dinero). **No escribe en `collections`: la semántica financiera no cambia.**
   - `event_types` **aplicada** el 23-sep con los 10 tipos (5 de GHL, 5 de Stripe).
   - **Falta para graduar F1:** evidencia de convergencia con datos reales (hoy 0 sobres de GHL: el
     último evento entró el 22-sep a las 08:09, antes del despliegue) y el shadow/compare del cutover.
3. **S0 CERRADA** (tramos 1 y 2). Acta en `docs/S0-8-GRADUACION.md`; estado por área en
   `CAPABILITIES.md`. Ledger P0–P4 consolidado ahí: ningún P0 abierto.
4. **F1 — event core.** Es donde van tres cosas ya diagnosticadas: el webhook de GHL no escribe capa
   raw (sin replay), un contacto sin nombre tumba el lote entero de GHL (`23502`), y `raw_events` no
   permite localizar a una persona (bloquea el borrado de F6).

### Por qué F6 no gradúa

Dos motivos, ninguno es código:

- Las tres decisiones de retención (`docs/F6-MAPA-PII.md` §7): raw, transcripciones y hechos
  financieros. Son de negocio y base legal.
- **`raw_events` no tiene `contact_id`** ni forma de localizar los payloads de una persona. No es
  una decisión pendiente: es una limitación real que decidir la retención NO desbloquea. **Requisito
  para F1**: cuando el webhook de GHL escriba en la capa raw, debe dejar los payloads localizables
  por persona.

### Migraciones escritas y NO aplicadas

El plan prohíbe que un agente toque producción por su cuenta. Espera confirmación:

- ~~P0 del RAG~~ **APLICADA el 2026-09-21** con aprobación de Alex, como
  `20260921172046_s0_4_match_knowledge_chunks_gate_subcuenta.sql` (renombrada a su versión real).
  Verificado: las 3 firmas sin EXECUTE para `anon`; la de 6 argumentos exige pertenencia.
- `20260921100000_f6_fathom_match_review_contact_id.sql` — vincula 69 de 177 filas de
  `fathom_match_review` a su contacto. Las otras 108 son correos de personas que no son contactos:
  ningún borrado por `contact_id` las alcanza, y `erase_person` las cubre borrando por correo.

`contacts.lifecycle` **ya está en producción** (PR #115, nullable TEXT sin constraint). Se eliminó
la migración duplicada `20260921110000_f6_contacts_lifecycle.sql`, que la declaraba
`NOT NULL DEFAULT 'identified'` con CHECK: habría dejado el repo con una restricción que producción
no tiene. **Deuda para F7**: `docs/plan/01-arquitectura-datos.md` §3 quiere el enum completo y
`NOT NULL`; endurecerla exige backfill de las 996 filas vivas.

### Dos fallos míos que encontró el gate de columnas fantasma (PR #115)

Se anotan porque la lección vale más que el arreglo: **escribí contra columnas que no comprobé**.

- El audit de `erase_person` usaba `entity` y `metadata`; las columnas reales son `entity_type` y
  `new_values`. El insert habría fallado en el primer borrado real.
- `contacts.lifecycle` no existía cuando el ejecutor ya la escribía.

La regla de `CLAUDE.md` —"BD antes que código: consulta el MCP de Supabase, no infieras el esquema
leyendo código"— existe exactamente para esto, y no la seguí. El auditor de columnas fantasma lo
cazó; conviene no gastar esa red dos veces.

### Incidencias abiertas

- **Agenda (22-sep, con GHL ya en uso).** Arreglados dos fallos y un backfill:
  1. La traducción de estados de GHL estaba duplicada (webhook y cron) y se había separado: la del
     cron no normalizaba separadores, así que `no-show` se guardaba como `scheduled`, e `invalid`
     también. Ahora es una sola función (`lib/appointments/status.ts`).
  2. Nadie marcaba la asistencia al llegar la grabación de Fathom: **107 citas grabadas y solo 3
     marcadas**. Ahora el emparejado marca `show` si la cita está sin resolver (nunca pisa un
     `no_show` ni una cancelada) y se hizo el backfill: **99 citas marcadas**, shows 3 → 102, tasa de
     asistencia de 30 días **28,4 %**. Las 8 grabaciones sobre citas canceladas se dejaron intactas.
  3. **Marcado provisional (decisión de Alex, 22-sep, SOLO esta vez y sin automatizar):** las **249**
     citas pasadas que seguían en `scheduled`/`confirmed` se marcaron como `show`. Cada una lleva en
     `notes` "PENDIENTE de que el closer confirme si asistió o no" y su fila en `audit_logs`
     (`origen` = `2026-09-22: marcado provisional…`), así que se puede revertir o listar. **No se
     tocaron** las 17 futuras, las 225 canceladas ni ningún `no_show`.
     ⚠️ **La tasa de asistencia deja de ser fiable hasta que los closers revisen esas 249**: hoy
     figuran 351 asistidas, de las cuales 249 son provisionales. Para saber cuáles son:
     `select id from appointments where notes like '%PENDIENTE de que el closer confirme%'`.
  - **Queda:** citas pasadas sin grabación cuyo resultado real nadie ha confirmado (ver punto 3) y
    **ninguna cita de GHL trae setter** — depende de que GHL mande UTMs (bloqueo de Alex).
  - **Ojo:** 362 de 968 contactos de GHL no tienen ni correo ni teléfono (335 son de la importación
    del 12-sep, pero sigue pasando: 10 de 19 el 21-sep). Sin ninguno de los dos no se pueden
    deduplicar ni enlazar con pagos: hay 26 nombres repetidos entre ellos. Va a F1.

- **Instagram: token caducado el 14-sep** (26 ejecuciones en error). **Meta: cuenta publicitaria no
  reconocida** en 22 de 52 ejecuciones. Las dos dependen de que Alex reconecte. Detalle y resto de
  hallazgos en `docs/S0-7-INTEGRACIONES.md`.
- **GHL: un contacto sin nombre tumba el lote entero** de la sincronización (`23502` sobre
  `contacts.full_name`, 5 ejecuciones). Va a F1, que rehace esa ingesta.

- **12 pagos de Stripe sin cobro registrado: 5.095,41 €** — **CAUSA ENCONTRADA (S0.4, 2026-09-21)**.
  No es el sync (funciona: 69 pagos leídos a diario por GitHub Actions). El cobro de Stripe se
  registra A MANO y por lotes (mediana: 33 días de retraso; último lote 14-sep), y el único aviso
  existente (`pago_stripe_sin_venta`) mira CLIENTES, no pagos: se le escapaban las **cuotas de
  quien ya tiene venta** (748,50 y 332,83 repetidos) y los **pagos sin cliente en Stripe** (los
  cinco de 50 €). Arreglo: controles `pago_stripe_sin_cobro` y `cobro_de_pago_devuelto` en Ajustes ›
  Salud de datos, que dicen a dónde ir en cada caso. Además el sync guardaba el correo solo de
  `receipt_email` (vacío en los 59): ahora cae al de facturación (resincronizado: ya tienen correo).

  **Registro de los 12 — HECHO el 2026-09-21** con aprobación de Alex (incluido el de julio). Una
  transacción; cada fila lleva la nota `S0.4 2026-09-21`. Resultado verificado: **0 pagos sin cobro;
  Stripe 27.029,46 € = cobros de esos pagos 27.029,46 €**. 8 ventas nuevas, 2 cobros añadidos a
  ventas existentes (2.ª cuota de un 1997/6; julio a la venta 1497/4 de la misma clienta), 4
  contactos nuevos, plan nuevo `WDC — Reserva (50 €)` (método `reserva`) para las 3 reservas sueltas.
  Precio por fecha: 1497 € hasta julio, 1997 € desde agosto.

  **Comisiones**: las genera el motor en código (`reconcileSaleCommissions`), no la base.
  `sales/reconcile-all` acepta ahora `{ saleIds }` y hay un workflow manual
  (`reparar-comisiones.yml`) para lanzarlo sobre ventas concretas sin tocar el resto.
  **Lanzado el 2026-09-21** sobre las 10 ventas afectadas: 18 comisiones pendientes para los 12
  cobros (closer 12 = 480,18 €; colaborador 6 = 249,64 €), 0 duplicadas, 0 cobros sin comisión.
  Ojo: ya existían antes de lanzarlo (algo las generó tras el registro; total de la subcuenta 91
  antes y después) y la reparación las rehízo idénticas. Si alguien sabe qué proceso fue, anótelo.

- **Un cobro de 50 € contra un pago que Stripe devolvió**, con `refunds` a 0 filas: el camino de
  devolución no está cerrado.
- **GHL**: el webhook YA FUNCIONA (contacto de prueba recibido el 21-sep a las 13:56). Falta
  confirmar que entran CITAS: el workflow de prueba era de contacto y no traía datos de agenda.

### Cambios de identidad aplicados en producción (2026-09-21)

- La app se llama **GrowthOps**, en una palabra.
- La subcuenta de Scalix: slug `evergreen` → **`scalix`**, nombre → **Scalix Systems**.
  Su URL es `https://app.scalixsystems.com/scalix/login`. No tiene ni debe tener credenciales
  propias: es la plataforma. Todas las integraciones (23 claves) viven en `women-digital-closer`.
- `RESEND_FROM` a nivel de plataforma: `GrowthOps <soporte@scalixsystems.com>`. WDC conserva el suyo.
- **No se ha renombrado** el segmento literal `evergreen` de las 168 rutas de API: está dentro de la
  URL del webhook de WDC. Va antes de F8, con las rutas nuevas conviviendo con las viejas.

### Lo que NO hay que volver a auditar

Verificado y cerrado. Repetirlo es trabajo perdido:

- Cash: cuando un cobro se registra, se registra bien — 0 desvíos de importe en los 47 pares
  conciliados, 0 referencias duplicadas, 0 comisiones huérfanas (`docs/S0-5-CONSISTENCIA-DATOS.md`).
- Aislamiento: `requireTenant()` en 149 de 168 rutas; las 19 restantes son legítimamente sin sesión.
- El esquema vivo cumple el invariante entero: 107 tablas, todas con RLS y al menos una política.
  Las únicas 5 sin `tenant_id` están declaradas en `lib/seguridad/invariante-tenant.ts`.
- El RAG contiene **solo** skills de plataforma, no PII. La línea roja de F6 no se ha cruzado.
- Los crons no se solapan: 2 en Vercel, 8 en GitHub Actions.
- El linaje huérfano de `~/GIT HUB/Growth-Ops-App` se repuntó y sus 20 ramas se borraron tras
  verificar por `patch-id` y por contenido que todo estaba en `main`. Queda
  `rescate/linaje-viejo-20260913` como red de seguridad; se puede borrar.

### Bloqueos que dependen de Alex

Solo lo que ningún agente puede hacer:

| Bloqueo                                                                                          | Bloquea                 |
| ------------------------------------------------------------------------------------------------ | ----------------------- |
| Rotar `RESEND_API_KEY` (guardada como valor legible en Vercel) y confirmar Google, GHL y staging | Graduación de F-1       |
| Activar leaked-password protection en Supabase Auth                                              | Graduación de F-1       |
| Decidir retención de raw, transcripciones y hechos financieros                                   | Graduación de F6        |
| Configurar UTMs y `source` en el webhook de GHL (`contact_attributions` a 0)                     | F7 y F4 de raíz         |
| Reconectar el token de Meta de WDC (`#10 Application does not have permission`)                  | Sync de Meta            |
| Rellenar los `[definir]` de la etapa A (`docs/plan/00-constitucion.md` §2)                       | Arranque de F1          |
| Comprobar que `https://app.scalixsystems.com` está en Supabase → Auth → URL Configuration        | Enlaces de recuperación |
| Commitear el WIP del checkout de `~/Documents` y retirarlo                                       | Carpeta única           |
| Configurar Bunny en Integraciones › Bunny Stream (guía en la propia pantalla)                    | Subida de VSL           |

Puedo hacer, con su visto bueno: poner el repo privado, borrar el proyecto `go-prod` de Vercel
(vacío), crear `CRON_SECRET` en Preview, borrar la rama de rescate.

---

## Histórico

Las entradas por hebra anteriores al 2026-09-21 se han compactado. El detalle está en el historial
de git (`git log --follow docs/ACTIVE_HANDOFF.md`) y, sobre todo, en los documentos y tests que
produjeron, que son la memoria durable.

Resumen de lo que cubrían: barrido data-viz con tokens de diseño en Recharts (19-sep) · base neta
de comisión de pasarela (19-sep) · copy del embudo de analítica (16-sep) · filtros de fecha
unificados, embudo de ventas e Instagram (15-sep) · endurecimiento multi-tenant e invitaciones
(15-sep) · observabilidad de navegador y cascada de sesión (15-sep) · brief de
Integraciones/Stripe/Métricas/Funnels (14-sep) · barridos de bugs (13 y 14-sep).

Dos lecciones operativas de esas hebras que siguen vigentes:

- **CI usa `cancel-in-progress`**: un run "cancelled" no es un fallo. Valida el ÚLTIMO commit con
  `gh run list --commit <sha>`, no el precedente.
- **No afirmes lo que no has verificado.** Se construyó un panel manual de crons sobre la creencia
  falsa de que Vercel Hobby solo permitía 3, y se recortó CI sobre la creencia falsa de que el repo
  era privado. Las dos premisas eran inventadas.

Tres más del 25-sep (codificadas también en `AGENTS.md`, con el caso que las originó):

- **Arnés canónico o nada**: suites solo por los scripts de `package.json`. Lanzar specs de
  Playwright o `tests/metrics/` con `node --test` a mano produce fallos falsos — el 25-sep costó
  dos diagnósticos equivocados antes de mirar el arnés.
- **Sin merge-base no hay merge**: la PR #210 (rama `docs/money-v1-cierre`) era un linaje huérfano.
  Se cerró como sustituida tras verificar commit a commit que su único contenido exclusivo era el
  texto de relevo (relevado en #216). Fusionarla habría revertido el tablero.
- **La fila del tablero es un contrato de relevo**: el trabajo sin commitear de esta hebra (fix E2E
  - cron) fue recogido, commitado y publicado por otro agente siguiendo la fila — así funciona el
    tablero cuando funciona; si un trabajo no debe continuarse, no se deja sin commitear.

### Correcciones de auditoría: Correo, Drops, Documentos y Apify — 2026-09-26

**Estado FINAL (26-sep): entregado y fusionado en `main` vía PR #233 (merge `ae98914`); CI del merge SUCCESS (run 36256579445) y `npm run quality` re-verificado PASS sobre `main` fusionada; rama borrada en remoto y local.** No se ejecutaron migraciones ni se consultó/escribió producción.

- **Correo:** las rutas de configuración, plantillas, historial, detalle y envío de prueba exigen rol funcional de gestión (`admin`, `director`, `manager`) ya acotado al tenant por `requireTenant`, o `super_admin` de plataforma. El control del frontend no es el permiso.
- **Drops:** las consultas/actualizaciones/alta llevan `tenant_id` explícito desde el contexto; contactos y nombres de responsables se cargan limitados a la subcuenta. La UI también informa fallos de lectura y revierte el cambio optimista si falla el update.
- **Documentos:** el handler comprueba venta y contacto dentro del tenant y rechaza discrepancia con el `contact_id` canónico de la venta antes de subir; Storage y fila de verificación derivan de ese ID canónico. Se valida tipo/nombre/base64 y límite de 10 MiB antes de reservar el buffer.
- **Apify:** errores de lectura/upsert/finalización ya no se convierten en `completed`; webhook devuelve 500 ante fallos para solicitar retry. La persistencia normalizada usa upserts y payload raw se consulta antes de insertar. Se añadió claim CAS con lease de cinco minutos para que webhooks concurrentes no procesen dos veces y un fallo deje el job reintentable. **Prueba del escenario con fallo/reintento aún por ejecutar.**
- **Prefijos de migración:** se mantienen los pares `20260919230000` y `20260921100000`; su duplicidad de nombre local no demuestra conflicto del ledger vivo. No se renombró ni aplicó DDL; verificar el ledger de Supabase de forma read-only/QA sigue pendiente.

**Validación local final (26-sep):** `npm run quality` completo PASS (exit 0) sobre los 13 ficheros modificados: `format:check` PASS, lint PASS con cinco avisos preexistentes (`<img>` en páginas instagram y dependencia de hook en ContactsAllView), typecheck integral `tsc --noEmit` PASS (653 fuentes TS/TSX, sin errores), `npm test` PASS (933 pass, 3 saltados por falta de credenciales Supabase) y `npm run test:metrics` PASS (740). `git diff --check` PASS. Tests focalizados de documentos/email/Apify: 38/38 PASS en ejecución previa al formateo final. La configuración temporal `tsconfig.audit.json` se borró tras su prueba y no está versionada.

**Bloqueo de memoria RESUELTO — causa raíz identificada (26-sep):** tsc no moría por el preview gestionado sino por un `next-server` huérfano de una gestión anterior escuchando en `:3000` (~1,7 GiB RSS, 8 h en pie); `freebuff-preview restart` recicló el preview nuevo (`:3001`, verificado sirviendo) pero no limpió el huérfano. Se terminó ÚNICAMENTE el árbol huérfano de `:3000` (SIGTERM y SIGKILL al PID confirmado como huérfano, no al preview). Además, el pico de tsc supera 2,2 GB de heap incluso con ~2,4 GB disponibles, así que se activaron 2 GB de swap dentro del contenedor (`fallocate -l 2G /swapfile; mkswap; swapon /swapfile`) y el typecheck se lanzó con `NODE_OPTIONS='--max-old-space-size=3584'`: pasó integralmente. No se cambió `tsconfig.json` ni se excluyó ruta alguna. La rama tiene base común directa con `origin/main` (`b87ab41`).

**Cierre de la unidad (26-sep):** commit del fix `b6f85d2` + relevo `7a24627`, push, PR #233, CI de PR verde (run 36255945786) y run cancelado posterior por `cancel-in-progress` (no es fallo), merge `ae98914`, CI de `main` SUCCESS (run 36256579445), `npm run quality` PASS sobre `main` fusionada, rama remota y local eliminadas, fila del tablero retirada. De los pendientes de producto, el escenario Apify con fallo/reintento quedó CERRADO el 26-sep vía PR #234 (merge `1cb7659`): congelado en `tests/apify-retry-scenario.test.mjs`, que ejecuta `processRunResults` real con un mini-DB en memoria (CAS genuino, upserts idempotentes) y `fetch` interceptado — sin red ni credenciales; CI de PR run 36263193522 success y quality PASS sobre `main` fusionada. Reserva honesta: en el run del merge sobre `main` (36263667257) quality/build/secretos pasaron y el job Smoke E2E salió CANCELADO por la cola de concurrencia `e2e-tenant-qa` ("higher priority waiting request"), no por fallo; el E2E del mismo árbol pasó en el run de la PR. La credencial gestionada de GitHub no permite `gh run rerun` ("not accessible by integration"): quien fusione a continuación o Alex debe relanzar ese job (Re-run failed jobs) o validar el E2E con el próximo push de código a `main`. Sigue pendiente además la verificación read-only del ledger de migraciones de Supabase (requiere credenciales). Nota de entorno para próximos agentes: el typecheck integral necesita >2,2 GB de heap; si el sandbox arranca sin swap, recrearlo con `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` y lanzar con `NODE_OPTIONS='--max-old-space-size=3584'` (verificado en esta sesión; no debilitar cobertura).
