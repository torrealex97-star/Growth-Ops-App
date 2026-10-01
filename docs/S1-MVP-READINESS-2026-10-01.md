# S1 — Auditoría de madurez MVP (continuación de S0)

Fecha: 2026-10-01. `main` en `1b1a58f` (verificado `git fetch` al abrir esta fase).
Responde al encargo: "llevar Growth-Ops-App a un estado de MVP profesional, estable, operativo y
usable de punta a punta — PRESERVAR → AUDITAR → PROBAR → CORREGIR → COMPLETAR → SIMPLIFICAR →
PROFESIONALIZAR → VERIFICAR → SOLO DESPUÉS EXTENDER".

## 0. Por qué este documento no se llama MVP_AUDIT.md

El encargo pide crear `MVP_AUDIT.md`, `MVP_HARDENING_PLAN.md`, `SMOKE_TEST_REPORT.md`,
`UX_UI_AUDIT.md` y `HANDOFF.md`, pero también dice explícitamente **"No duplicar docs
existentes"**. Este repo ya tiene un ciclo de auditoría MVP completo y reciente:

| Pedido en el encargo | Ya existe en este repo                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `MVP_AUDIT.md`         | `docs/S0-8-GRADUACION.md` (ledger P0–P4, journeys críticos, graduación) + `CAPABILITIES.md`          |
| `MVP_HARDENING_PLAN.md`| `PENDIENTES.md` (vivo, actualizado 28-sep, con dueño y prioridad por ítem)                           |
| `SMOKE_TEST_REPORT.md` | `docs/S0-2-JOURNEYS-CRITICOS.md` + 4 specs E2E reales en CI (`tests/e2e/*.spec.mjs`)                  |
| `UX_UI_AUDIT.md`       | `docs/DASHBOARD_VISUAL_AUDIT.md`, `PROMPT_UXUI_AUDIT.md`, `docs/S0-6-RENDIMIENTO-FRONTEND.md`         |
| `HANDOFF.md`           | `docs/ACTIVE_HANDOFF.md` (vivo, 1771 líneas, el que ya se usa en esta sesión)                        |

Siguiendo **REUSE > CREATE** y **EXTEND > REWRITE**: este documento es la pieza **S1** que falta en
la serie `S0-*` ya existente — continúa la graduación de S0 (22-sep) con una revalidación a fecha de
hoy — y actualiza `PENDIENTES.md`/`ACTIVE_HANDOFF.md` en vez de crear competidores. No se crean los
5 ficheros nombrados en el encargo.

## 1. Limitación de entorno declarada (obligatorio decirlo antes de auditar)

Esta sesión corre en un sandbox **sin credenciales reales de Supabase** (`.env.local` con
`placeholder.supabase.co`) y sin navegador con sesión autenticada contra el tenant real. Eso
significa:

- **Sí puedo hacer:** auditoría estática de código, RLS (vía políticas SQL en migraciones + Supabase
  MCP cuando está disponible), tests, quality gate, inventario de rutas, consistencia de
  nomenclatura, lectura de logs/Sentry reales (el MCP de Sentry SÍ tiene datos de producción).
- **NO puedo hacer sin ayuda:** recorrer clic a clic las 93 pantallas con datos reales como pide la
  sección 4 del encargo. La sección 4 de S0 (`S0-4-BARRIDO.md`) y la visual (`DASHBOARD_VISUAL_AUDIT.md`)
  ya cubrieron gran parte de esto en sesiones anteriores con acceso real — se referencia su contenido
  en vez de repetirlo a ciegas.

Cuando este documento dice "verificado", es contra código/tests/esquema real. Cuando dice "según
S0-*", es una cita de auditoría previa que no he vuelto a ejecutar yo mismo.

## 2. Skills usadas (sección 2 del encargo)

| Categoría           | Skill usada                                                      | Resultado                                               |
| -------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Marketing            | `marketing-and-copywriting` (ya instalada)                       | Vocabulario y fórmulas de KPI canónicas — en uso         |
| Sales / RevOps       | `sales-engineering` (ya instalada)                                | KPIs de ventas (§7) — en uso                             |
| Analytics/Dashboards | `dataviz`, `data-visualization-pro` (ya instaladas)               | Paleta y heurísticas de gráficos — a aplicar en Fase 10  |
| Security             | `security-review` (ya instalada)                                 | A ejecutar en Fase 1                                     |
| QA / Browser         | `browser-testing-with-devtools` (ya instalada)                   | **Requiere Chrome DevTools MCP configurado — no lo está en este entorno** (ver §1) |
| Supabase/RLS         | `supabase`, `supabase-postgres-best-practices` (ya instaladas)    | En uso para revisión de políticas                        |
| Next.js              | `nextjs-app-router-patterns` (ya instalada)                       | En uso                                                   |
| Accesibilidad        | buscada (`npx skills find accessibility`) → **0 resultados**      | Sin skill empaquetada; se audita con criterio WCAG manual |
| Performance web      | buscada (`npx skills find "web performance"`) → **0 resultados**  | Sin skill empaquetada; se audita con criterio manual      |
| UX/UI SaaS dashboard | buscada (`npx skills find "saas dashboard design"`) → **0 resultados** | Sin skill empaquetada; se sigue `data-visualization-pro` + criterio propio |
| RevOps dedicada      | buscada (`npx skills find revops`) → **0 resultados**             | Cubierta por `sales-engineering` + `marketing-and-copywriting` |

No se inventó ninguna skill inexistente, conforme a la instrucción explícita.

## 3. Baseline técnico objetivo (hoy, no heredado)

```
npm run quality
  format:check  → OK
  lint          → OK (solo warnings preexistentes, 0 errores)
  typecheck     → OK (0 errores)
  test          → 1202/1205 (3 fallos: red a Supabase no disponible en sandbox — mismo patrón documentado en S0)
  test:metrics  → 783/783
```

**P0 = 0** confirmado por el compilador y la suite completa. Esto coincide con el veredicto de
`S0-8-GRADUACION.md` ("ningún P0 abierto") y confirma que **no ha entrado ningún P0 nuevo** en los
9 días transcurridos desde esa graduación, a pesar de ~15+ PRs mergeados en ese periodo (visible en
`git log`).

Inventario de superficie: **93 páginas** bajo `app/[tenant]/*/page.tsx` (confirmado por `find`), más
rutas públicas (`/embed/vsl/[slug]`, `/firmar/[token]`, `/firmar-alumno/[token]`) y ~160 API routes
bajo `app/api/[tenant]/evergreen/`.

## 4. Revalidación del ledger P1/P2 de S0-8 (22-sep) — qué sigue abierto hoy

| Ítem de S0-8                                                  | Estado hoy (10-01)                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Índices únicos sin `tenant_id` (`campaigns`, `ig_media`)        | **RESUELTO** — verificado en migraciones: `20260914120000_tenant_scope_provider_uniques.sql` dropea los índices globales y crea los tenant-scoped. (La fecha de la migración es ANTERIOR a la graduación de S0; el ledger de S0-8 quedó desactualizado en este punto puntual.) |
| F6 — política de retención de `raw_events`/transcripciones      | **SIGUE ABIERTO.** Confirmado en `docs/F6-MAPA-PII.md`: "no se puede graduar, política de retención sin definir". Es una decisión de negocio, no de código — **requiere a Alex**. |
| Token de Instagram caducado                                     | Externo — **requiere a Alex** (reconectar en Meta). No verificable desde este sandbox.                |
| `RESEND_API_KEY` guardada en claro                              | Externo — **requiere a Alex** (rotar). No verificable desde este sandbox (no hay acceso a Vercel env). |
| GHL no manda UTMs / sin setter en citas de GHL                  | Externo — **requiere a Alex** (configurar workflows de GHL).                                          |
| Devolución de Stripe no entra sola / `refunds` vacía            | Pendiente de decisión A5 (`docs/MONEY.md`) — **no tocar sin decisión de Alex**, ya señalado así en `PENDIENTES.md`. |
| Cobro y comisión sin frontera transaccional / patrón de ~92 escrituras sin comprobar error | **RESUELTO.** Verificado en `git log`: PR #268 "barrido final de escrituras sin comprobar error — 10 hallazgos P0" cerró el patrón, con 29 tests de regresión permanentes (`tests/p0/p1/p2-escrituras-sin-comprobar-error.test.mjs`, los 29 en verde en el baseline de §3). `PENDIENTES.md` tenía esta línea desactualizada — corregida en esta misma fase. |
| `CRON_SECRET` no existe en Preview                              | Externo — **requiere a Alex** (config de Vercel Preview env).                                         |
| Contratos: firma concurrente sin CAS                            | **Sigue abierto**, documentado en `PENDIENTES.md` §Deuda técnica — requiere decisión del responsable de contratos antes de tocar código (impacto jurídico). |

**Conclusión de esta revalidación:** de los 9 ítems no-P0 que S0-8 dejó abiertos, **2 ya estaban
resueltos** (índices tenant-scoped; barrido de escrituras sin comprobar error vía PR #268), **5 son
bloqueos externos que dependen de Alex** (no de código), y **1 sigue genuinamente abierto pero
necesita una decisión de negocio antes de tocar código** (CAS en firma concurrente — el propio
`PENDIENTES.md` dice "decidir primero la semántica de doble submit; después, CAS"). No queda ningún
ítem de este ledger que sea código puro sin decisión previa pendiente.

## 5. Hallazgo de esta sesión — descartado tras lectura (falso positivo)

**"Duplicación aparente de afiliados"** — existen tres rutas con ese nombre. Leídas las tres
(Fase 2): **no es duplicación**, es un flujo de 3 piezas coherente y sin solape:

| Ruta                                      | SCREEN / ROLE                          | PURPOSE                                                                 |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------ |
| `settings/afiliados`                       | Admin/Director — configuración          | Define el programa: campos del formulario público, % comisión por defecto, intro/mensaje de éxito |
| `afiliados/registro` (pública, sin login)   | Visitante / afiliado potencial          | Formulario de alta que lee la config de arriba, por link de campaña (`?c=slug`) |
| `marketing/afiliados/afiliados`            | Admin/Director/el propio colaborador    | Panel de gestión de `collaborator_profiles` ya dados de alta: KPIs, ventas, comisiones — reutiliza las definiciones canónicas del resto del sistema, no inventa fórmulas propias |

No se toca nada aquí. Queda como ejemplo de por qué la regla "SCREEN/ROLE/PURPOSE antes de actuar"
de la sección 5 del encargo evita limpiezas erróneas.

## 6. Veredicto de esta fase (Fase 0)

**MVP READY WITH BLOCKERS** (no "READY", no "NOT READY") — usando la propia definición del encargo:

- P0 = 0 ✅
- P1 abiertos: todos tienen dueño/fase declarado, ninguno nuevo ✅ (requisito cumplido)
- Journeys críticos: PASS según S0-2 (no re-ejecutado por mí en esta fase) — **pendiente de
  re-confirmar con el smoke E2E real en Fase 13**
- Dashboards/Action Center/UX/Responsive/Accessibility: **no auditados todavía en este ciclo** — es
  el trabajo de las Fases 4-11 que siguen
- Tenant isolation / Security: PASS según auditorías FASE 1-3 de `PROJECT_CONTEXT.md` — **pendiente
  de re-verificar con `security-review` en Fase 1**, no asumido sin más

### 6.0.1 Veredicto consolidado tras Fases 0-9 (este corte de sesión)

Sigue siendo **MVP READY WITH BLOCKERS** — no cambia de categoría, pero el contenido detrás mejora
sustancialmente:

- **Cerrado en código esta sesión:** 1 vulnerabilidad de seguridad en producción (RPC de atribución
  de colaboradores sin verificación de llamador, §6.1); 1 hueco de datos real completado y validado
  contra producción (ventas sin `setter_id` en Data Health, §6.3).
- **Hueco de DATOS real encontrado y reportado** (no de código): pagos de Stripe sin cobro interno
  reconciliado en el único tenant con datos de producción (§6.4) — acción pendiente para Alex.
- **Verificado SIN hallazgos nuevos** (Fases 4, 5, 6, 7, 8): filtro de cuentas de marketing, orgánico,
  comparabilidad del funnel, pipeline interno del CRM, terminología y veto de comisiones, conciliación
  Stripe↔cobros, aislamiento de colaboradores (27/27 tests), diseño de Data Health/conectores. Todo
  correctamente implementado ya antes de esta sesión.
- **Hueco real confirmado, NO corregido por ser feature nueva** (Fase 9): no existe un Action Center
  unificado con los 9 tipos que pide el encargo — lo que hay son dos piezas correctas pero parciales
  (kanban de tareas genérico + alertas de métricas en el Header, esta última ya con scope por rol).
  Documentado para una fase de extensión deliberada posterior, no para esta de hardening.
- **Bloqueado para ESTA sesión, no para el proyecto:** las Fases 10-14 (UX/UI, responsive,
  accesibilidad, performance, smoke test, regresión final) piden específicamente un recorrido visual
  por 93 pantallas, medir LCP/INP/CLS reales, y probar en dispositivos/tamaños reales — ninguno de
  estos es verificable leyendo código fuente sin engañarse a uno mismo sobre lo que "verificar"
  significa. Necesitan navegador con sesión autenticada o capturas del Growth Operator; no se
  inventan hallazgos de código para rellenar fases que requieren otra herramienta.
- Nada de lo anterior sube ni baja el veredicto: sigue siendo "con bloqueadores" porque los
  bloqueadores de Fase 0 (F6, Instagram, RESEND_API_KEY, UTMs de GHL, CRON_SECRET, MONEY.md A5,
  doble-submit de firma — todos de Alex, §8) no han cambiado.

## 6.1 Fase 3 — cerrada: hallazgo de seguridad aplicado en producción

**Confirmado por el usuario ("Vale avanza") y aplicado el 2026-10-01**, migración
`20261001170000_revoke_collaborator_ghl_backfill_execute.sql`:

- `attribute_ghl_contacts_for_collaborator(uuid, uuid, text)` — era SECURITY DEFINER ejecutable por
  `anon`/`authenticated` sin verificar quién llama; permitía robar atribución de comisiones de
  cualquier tenant conociendo su `tenant_id` (público) y el código de otro colaborador (público por
  diseño). **REVOKE aplicado**, verificado contra `has_function_privilege`: `anon`/`authenticated`
  ya no pueden ejecutarla, `service_role` conserva acceso. Verificado en código que solo se llama
  internamente vía `PERFORM` desde otros triggers `SECURITY DEFINER` — nada se rompe.
- Mismo REVOKE aplicado a los 5 triggers relacionados (`ghl_backfill_on_*`, `ensure_collaborator_profile*`)
  por higiene (no explotables vía RPC directo, pero cerraban el mismo aviso del advisor).
- Re-ejecutado el advisor de seguridad de Supabase tras el cambio: los 6 hallazgos desaparecieron.
  Las 16 funciones que siguen apareciendo como "ejecutables por `authenticated`" son los helpers de
  RLS (`auth_tenant_ids`, `is_admin_or_director`, `is_my_collaborator_row/sale`, etc.) que **tienen
  que serlo** para que las políticas funcionen — documentado como intencional desde antes
  (`PROJECT_CONTEXT.md`), no es un hallazgo nuevo.
- `npm test` completo tras el cambio: mismo resultado que el baseline de §3 (1202/1205, los 3
  fallos son de red al sandbox) — nada se rompió.

## 6.2 Fase 4 — Marketing/funnel: filtro de cuentas y orgánico (sin hallazgos nuevos que corregir)

**Objetivo del encargo (§10):** comprobar que solo se usan cuentas de Integraciones seleccionadas en
todo el pipeline de métricas de marketing, y que el orgánico no fabrica estimaciones.

### Filtro de cuentas de Meta — correcto en los dos consumidores reales

- `app/[tenant]/marketing/adquisicion/campanas/page.tsx`: filtra con `useCuentasMetaActivas` →
  `cuentas.filtrar(items)` → `displayItems` → los totales de KPI se calculan sobre `displayItems`,
  nunca sobre `items` sin filtrar. Correcto.
- `lib/metrics/consulta.ts:143` (`campaign_daily`) es la capa central que alimenta tanto
  `/metricas/brief` (Dashboard) como la ruta de IA (`app/api/[tenant]/evergreen/ai/agent/route.ts`).
  Ambos consumidores le pasan `parseAccountIds(cfg.META_AD_ACCOUNT_ID)` — la MISMA fuente
  (`lib/meta/accounts.ts`) que usa la pantalla de Integraciones. No hay dos definiciones
  divergentes de "cuenta seleccionada".
- El caso `cuentasAds.length === 0` (sin selección guardada) cae a "todas las cuentas accesibles
  por el token" — es una convención **documentada y deliberada** en todo el módulo
  (`lib/meta/accounts.ts`: *"Lista vacía = todas las cuentas accesibles por el token"*), no un bug:
  antes de tener una cuenta seleccionada, mostrar 0 habría sido peor que mostrar todo lo accesible.
  Un tenant con el token ya conectado y una cuenta efectivamente elegida nunca cae en este caso.
- Esto es un camino DISTINTO al que motivó `campanasFueraDeSeleccion` en
  `lib/data-health/cross-source.ts` (ese fix era sobre otra vista); no había quedado sin aplicar aquí.
- **Gap de completitud conocido, no corregido (sería feature nueva):** `campanas/page.tsx` opera a
  nivel de campaña (con detalle por anuncio), pero no hay granularidad de ad-set explícita. No se
  construye — contradice "no features nuevas" y el token de Meta ya está roto a nivel externo
  (ver §8.2).

### Orgánico — solo Instagram vía API oficial, sin fabricar estimaciones (correcto, pero incompleto)

- `lib/social/organic.ts` + `components/os/PanelOrganico.tsx`: toda la cifra viene de
  `ig_media`/`ig_account_daily`, poblados por `lib/instagram/sync.ts` contra la Graph API oficial.
  Apify queda reservado exclusivamente a investigación de **terceros** (comentario explícito en el
  código, verificado). El dashboard nunca llama a Meta/Apify en el render.
  - Métricas no calculables se devuelven `undefined`, nunca `0` ni una estimación (p. ej.
    `engagementRate` solo se calcula si hay posts del periodo Y un `reach` o `views` > 0 real).
  - Estados vacíos honestos: sin credenciales → pide conectar; con credenciales pero sin sync →
    pide sincronizar. Nunca rellena con ceros falsos.
- **Hueco real frente al encargo:** el panel solo cubre Instagram. Facebook/YouTube/TikTok NO
  tienen sync oficial propio implementado (el propio comentario de `organic.ts` lo dice:
  *"TikTok/YouTube por su sync oficial cuando exista"*) — no se muestran (correctamente, no se
  fabrican), pero tampoco existen. Construir esos syncs es una feature nueva fuera del alcance de
  esta fase; se documenta como brecha de cobertura, no como bug.

### Comparabilidad del funnel conectado — ya resuelta en datos y en UI

- `lib/metrics/period-funnel.ts` (`buildPeriodFunnel`) documenta explícitamente en el propio código
  que sus cifras son "hechos del periodo, NO una cohorte enlazada: no permiten inferir conversiones"
  — exactamente la distinción Actividad-vs-Cohorte que pide el encargo (§10).
- `components/os/ConnectedFunnel.tsx:113` traslada esa misma advertencia a la UI: cuando la etapa
  no es comparable como conversión, el pie de la etapa dice literalmente *"Actividad del periodo; no
  expresa conversión entre personas"*, en vez de mostrar un % de conversión engañoso entre universos
  no comparables. Donde SÍ hay cohorte comparable, dice "Conversión respecto a la etapa anterior."
- No hay funnel falso mezclando denominadores incompatibles sin avisar: el requisito ya está cerrado
  en código, no solo en intención.

**Veredicto Fase 4 (completa):** sin bugs de código que corregir en el filtro de cuentas, en el
orgánico ni en la comparabilidad del funnel — las tres piezas ya implementan correctamente lo que
pedía el encargo. Dos huecos de cobertura conocidos y documentados (ad-set granularity, FB/YT/TikTok
orgánico) que NO se construyen en esta fase por ser features nuevas.

## 6.3 Fase 5 (en curso) — CRM/Setting/Sales: terminología correcta, un hueco real completado

**Terminología (Agendas/Asistencias/No-show/Cierres):** revisado `app/[tenant]/crm/agendas/page.tsx`
y `components/appointments/AgendasMetricsView.tsx` — las tablas de Setters y Closers ya usan los
términos exactos (Agendas/Agendadas/Llamadas atendidas/No asistieron/Tasa de asistencia para
setters; Asignadas/Agendadas/Cierres/Tasa de cierre para closers) y muestran el CONTEO junto a cada
tasa (nunca un % aislado sin su denominador) — cumple el requisito del encargo tal cual.

**Hueco real encontrado y completado — ventas sin `setter_id`:** `settings/data-health` ya tenía el
patrón exacto que pide el encargo para contactos sin canal (`leadChannelGaps`: se cuenta el hueco,
nunca se inventa el valor) pero NO existía el equivalente para asignación de setter en ventas, pese
a que `lib/commissions/attribution.ts` intenta resolverlo automáticamente y puede quedarse sin poder
hacerlo. Verificado con `grep` que no hay ningún control de este tipo en ningún otro sitio del repo
(cero resultados para `setter_id.*is null` / `setterGaps` / variantes). Completado (no es feature
nueva: es la misma sección de Data Health, mismo patrón, mismo componente `Metric`):

- `app/api/[tenant]/evergreen/settings/data-health/route.ts`: la query de `sales` ahora trae
  `setter_id, status, reservation_completed_at, payment_plans(method)`; `integrity.salesWithoutSetter`
  cuenta las ventas que `cuentaComoVenta()` (MONEY.md D8 — una reserva sin completar no es venta)
  acepta como venta real Y no tienen `setter_id`. `null` (no `0`) si la query de `sales` falla — "no
  se pudo comprobar" nunca se disfraza de "cero huecos".
- `components/settings/DataHealthPanel.tsx`: nueva tarjeta "Ventas sin setter" en la sección
  "Captura de origen" ya existente, mismo componente `Metric`, mismo criterio de color (`bad` si > 0,
  `warn` si no se pudo comprobar, `good` si 0).
- Verificado: `npx tsc --noEmit`, `npx eslint` sobre los dos ficheros y `npm test` completo tras el
  cambio — mismo 1202/1205 que el baseline (los 3 fallos son de red al sandbox), nada se rompió.
- Esto da el número concreto que pide el encargo (ej. "38 ventas sin setter_id") en vez de un aviso
  vago — el Growth Operator ve la cifra real de su tenant la próxima vez que abra Data Health.

**Pipeline/Oportunidades del CRM:** esta app no tiene una pantalla separada llamada "Pipeline" u
"Oportunidades" — la función la cubre `app/[tenant]/crm/seguimiento/page.tsx`, un kanban con sus
propias etapas internas (`pendiente_recontacto` / `en_seguimiento_pago` / `reagendado_pendiente` /
`cerrado` / `descualificado`), explícitamente separadas del `pipeline_stage` de integraciones
externas (comentario en el propio código, migración v58) para no confundir ambos conceptos. Es una
decisión de arquitectura ya tomada y correcta, no un hueco — no se construye una pantalla nueva de
"Pipeline" que duplicaría esta.

**Recorrido Lead→Agenda→Asistencia→Cierre con datos reales (el MCP de Supabase volvió a conectar
más tarde en esta misma sesión):** verificado contra el único tenant con datos reales de producción
(identidad no reproducida aquí — `docs/SECURITY_PRIVACY.md`). Magnitudes internamente coherentes
(agendas ≤ contactos, cierres ≤ asistidas); la tasa de cierre sobre asistidas no sugiere datos
corruptos. Sin anomalías.

**Validación con datos reales de la tarjeta "Ventas sin setter" (§6.3):** en ese mismo tenant, tanto
`salesWithoutSetter` como el equivalente de agendas salieron al 100%. Investigado antes de darlo por
un bug: el tenant SÍ tiene un setter activo en el roster, pero (a) el 100% de sus agendas llegan por
reserva directa del lead (sin paso por un setter que agende manualmente), (b) ningún registro de
atribución de este tenant referencia el código de seguimiento de esa persona, y (c) el ÚNICO
`participant_type` que aparece en `commissions` para este tenant es `collaborator` (cero
`setter`/`closer` jamás generados). Conclusión: no es un hueco de asignación roto — es un tenant cuyo
funnel real no enruta por setter (modelo dirigido por colaboradores/afiliados). La tarjeta de Data
Health informa el número real correctamente; el 100% no es una alarma falsa, es la foto real de cómo
opera ese negocio. Se documenta aquí para que no se lea como un fallo del sistema si se ve en
pantalla — el detalle identificable (qué tenant, qué persona) se comunica aparte, no en este repo.

**Veredicto Fase 5 (parcial):** terminología correcta, hueco de asignación de setter cerrado, pipeline
interno ya bien diseñado. Sin bugs adicionales encontrados en lo revisado.

## 6.4 Fase 6 (parcial) — Finanzas/Comisiones: terminología y veto D9 ya correctos

**Booked/Billed vs Cash vs Refunds vs Expenses vs Profit:** `app/[tenant]/finanzas/analitica/resumen/page.tsx`
ya distingue cada concepto con su propia tarjeta y etiqueta explícita — "Cash Collected", "Facturación",
"Gastos totales", "Comisiones plataforma", "Devoluciones del mes", "Resultado neto" (con la fórmula
citada: *"Mismo cálculo que I&G (Dirección › Métricas): Net Revenue − COGS − OpEx"*, para que no haya
dos definiciones de beneficio en pantallas distintas). No hay ninguna tarjeta "Revenue" ambigua sin
definición — el requisito del encargo ya está cumplido.

**`pays_commissions=false` como veto (D9 de MONEY.md):** verificado que el veto se aplica en los DOS
lados que el encargo y `CLAUDE.md` piden explícitamente:
- Generación: `lib/commissions/generate.ts` excluye a quien tenga `pays_commissions=false` tanto al
  generar desde un cobro nuevo como al reconciliar.
- Lectura: `app/[tenant]/comisiones/page.tsx:141-144` tiene una defensa explícita del lado de lectura
  ("Defensa en el lado de lectura: quien tenga `pays_commissions = false`… no…") que filtra filas aunque
  existieran de antes de marcar la exención — exactamente el caso que el encargo quería cerrado (un
  veto que solo actúa en generación no basta si ya hay filas viejas).

**Conciliación Stripe↔cobros con datos reales (MCP de Supabase reconectó en esta sesión):** el
control cruzado `pagosSinCobro` de `lib/data-health/cross-source.ts:147-154` (pagos `succeeded` en
Stripe sin ningún `collections.payment_reference` que los referencie) YA detecta correctamente un
hueco real y actual en el único tenant con datos de producción:

- Un puñado de pagos de Stripe `succeeded` recientes sin cobro interno correspondiente, por un
  importe conjunto de varios miles de euros. Verificado que esto NO es un bug de código: el control
  ya existe, ya corre y ya lo marcaría en la pantalla de Data Health (`crossSummary`) la próxima vez
  que se abra con ese tenant. Es un hueco de DATOS real y actual, no de implementación.
- **ACCIÓN REQUERIDA:** reconciliar esos pagos — confirmar si corresponden a cobros que faltan por
  registrar en `collections` (y registrarlos) o a cargos de Stripe ajenos a una venta de la app (en
  cuyo caso no hace falta nada). Mientras no se resuelva, el Cash Collected mostrado en Finanzas para
  ese tenant está subestimado frente a lo que Stripe reporta. Detalle exacto (IDs de pago, fechas,
  importes) comunicado aparte — no se reproducen aquí por ser datos de negocio de un tenant
  (`docs/SECURITY_PRIVACY.md` §2).

**Pendiente de Fase 6:** revisión de `docs/MONEY.md` A5 (refunds acumulados/clawback) sigue
bloqueada por decisión de Alex — no se toca. `finanzas/morosidad` y `finanzas/socios` quedan sin
revisar con datos reales para una sesión siguiente.

**Veredicto Fase 6 (parcial):** terminología de dinero y veto de comisiones ya correctos en los dos
lados. Sin bugs encontrados en lo revisado.

## 6.5 Fase 7 — Colaboradores: aislamiento ya cubierto en frontend, RLS y tests (sin hallazgos nuevos)

El encargo pide auditar que "un colaborador solo ve datos atribuibles a él, en frontend Y en
RLS/API, no solo en UI". Esto ya estaba cubierto con una profundidad inusual ANTES de esta sesión:

- `tests/colaboradores-aislamiento.test.mjs` (12 tests) + `tests/atribucion-colaborador-ui.test.mjs`
  + `tests/cadena-contrato-colaborador.test.mjs` — ejecutados en esta sesión: **27/27 OK**. Cubren
  exactamente los puntos del encargo: scope resuelto en la capa de datos (fail-closed: un error de
  BD devuelve `[]`, nunca "todo el tenant"), contactos/agendas/ventas/pagos con scope "sin
  escapatoria" en CADA query (`components/crm/ContactsAllView.tsx`, `crm/agendas`,
  `ventas/registro`, `ventas/pagos`), RLS como backstop (`is_my_collaborator_row/_sale` con
  `auth_tenant_ids()` para que ni el propio SECURITY DEFINER escape de subcuenta), override de
  atribución solo admin/director con motivo obligatorio y auditoría, un único ledger de comisiones
  (no tablas paralelas) y un test explícito que falla si aparece infraestructura paralela
  (`affiliate_users`, `collaborator_appointments`, etc.) en cualquier fichero del repo.
- `app/[tenant]/comisiones/page.tsx:87-120` confirma que la pantalla de comisiones también oculta
  los agregados de Setters/Closers a un colaborador (`esColaborador` resuelto vía
  `resolverScopeColaborador`) — el colaborador ve solo su propia lane, no los totales del equipo.
- La vulnerabilidad real de este dominio (RPC de atribución ejecutable sin sesión) ya se cerró en
  Fase 3 (§6.1) — es la pieza que estos tests NO podían cubrir porque atacaba por fuera de la capa
  de aplicación (RPC directo de PostgREST), no por el frontend ni por una query mal filtrada.

**Veredicto Fase 7:** sin hallazgos nuevos — el aislamiento de colaboradores está correctamente
implementado y probado en los tres niveles que pide el encargo (frontend, RLS, capa de datos).

## 6.6 Fase 8 — Integraciones/Data Health: ya central, sin hallazgos nuevos

El encargo pide que Data Health sea central y avise de syncs obsoletas, fallos de job, huecos
históricos y mapeos faltantes. Verificado por código (sin acceso a datos reales de ejecución esta
sesión — mismo bloqueo del proxy de Supabase):

- `lib/data-health/conectores.ts` (`saludDeConector`) deriva el estado del **historial de
  ejecuciones** (`sync_runs`), no de las filas de las tablas — exactamente la distinción que pide el
  encargo ("una integración rota 5 días no puede parecer sana porque el cron trae datos viejos").
  Separa fallo de credenciales de lectura vs webhook, declara si el conector soporta cursor
  (reanudación) y redacta secretos dos veces antes de llegar a la pantalla.
- `lib/data-health/cross-source.ts` tiene `sync_obsoleta` con un umbral de 48 h (`STALE_POR_DEFECTO_MS`)
  sobre la fecha de sync más reciente vista en `meta`/`instagram`/`tracking` — cubre el caso que
  `saludDeConector` por sí solo no cubriría (un cron que deja de dispararse del todo no generaría
  ejecuciones fallidas que detectar, pero sí deja de avanzar `synced_at`, y eso sí se detecta aquí).
  Las dos piezas se complementan; no hay doble definición de "obsoleto" compitiendo.
- `lib/data-health/webhooks.ts` tiene el mismo patrón para la mitad RECEPTORA (24 h sin recepción con
  la integración configurada = tiempo real roto), ya revisado en Fase 0 de este documento.
- Migración a contrato de conectores (F2): `CONECTORES = [ghl, meta, stripe, plantilla]` — el resto
  del catálogo (Calendly, Fathom, Instagram, YouTube) se declara explícitamente como
  `pendientesDeMigrar()` y la propia pantalla lo enseña ("X integraciones todavía sin contrato"). Es
  trabajo en curso ya rastreado, no un hueco oculto — no se migra en esta fase (sería expandir una
  pieza completa fuera del alcance de "corregir lo existente").

**Veredicto Fase 8:** sin hallazgos nuevos — el diseño de Data Health ya cumple el requisito de ser
central y de no disfrazar una tubería rota con datos viejos.

## 6.7 Fase 9 — Action Center: hueco real confirmado, NO se construye (es feature nueva)

El encargo pide un Action Center unificado con items tipados (TASK/ALERT/DATA ISSUE/FOLLOW-UP/
APPROVAL/OPPORTUNITY/REMINDER/AI INSIGHT/SYSTEM), cada uno con título/descripción/prioridad/
propietario/fuente/entidad/fecha límite/estado/acción, escalado por rol.

**Lo que existe hoy no es eso — son dos piezas separadas, cada una correcta en su propio alcance:**

- `app/[tenant]/tasks/page.tsx`: un kanban genérico de tareas (backlog/en curso/en revisión/hecho)
  con prioridad, asignado y generación por IA desde transcripciones. Es gestión de tareas, no un
  feed de items heterogéneos con fuente/entidad.
- `components/os/Header.tsx`: panel de alertas del Growth Brief en el propio Header, ya con scope
  por rol real (restringido a `admin`/`director`/`closer` para las alertas de métricas; las de
  "agenda asistida sin grabación" ya filtran por `closer_id`/`setter_id` cuando el rol no es de
  liderazgo) — pero es un solo tipo de alerta (métricas), no la taxonomía completa que pide el
  encargo, y vive en un dropdown del Header, no en un panel lateral dedicado.

**Por qué no se construye en esta fase:** unificar esto en un verdadero Action Center (con los 9
tipos, entidad/fuente por item y un panel lateral más grande y claro) es una pieza de UI nueva de
tamaño considerable, no una corrección de algo existente — contradice directamente "no features
nuevas" de esta fase de hardening. Además requeriría decisiones de diseño (qué entra en cada tipo,
cómo se prioriza entre fuentes) que no son mías para decidir unilateralmente.

**Veredicto Fase 9:** hueco real y confirmado, documentado para una fase de EXTENSIÓN deliberada
posterior (no esta), una vez cerradas las fases de corrección. No es un bug.

## 6.8 Fases 10-12 — lo que SÍ es auditable por código sin navegador, y dónde se para honestamente

El usuario pidió explícitamente avanzar primero en todo lo que no requiera navegador. Estas fases
piden mayoritariamente recorrido visual y medición en runtime, pero hay un ángulo de cada una que
sí se puede comprobar leyendo código. Esto es lo que se hizo y lo que no, sin fingir una
verificación que no se hizo:

### Fase 10 (UX/UI) — hallazgo real confirmado: Skeleton/EmptyState existen pero casi no se usan

- `components/ui/skeleton.tsx` existe y su propio comentario dice explícitamente que fue creado
  para "sustituir a los `<div className=\"... animate-pulse\" />` sueltos repetidos por ~20
  pantallas" (citando una auditoría UX previa) — pero **solo 1 fichero lo importa**. Hay **52
  ficheros** bajo `app/` con el patrón `animate-pulse` suelto, sin pasar por el componente. El
  hueco que esa auditoría anterior ya había detectado y para el que ya se construyó la pieza
  **nunca se terminó de aplicar**.
- `components/ui/empty-state.tsx` existe pero también lo importa **solo 1 fichero**; hay **49
  ficheros** con texto de estado vacío escrito a mano ("No hay…", "Aún no hay…") en vez de usar el
  componente compartido.
- **No se corrige en esta sesión:** migrar 52 + 49 ficheros sin poder verificar visualmente el
  resultado (sin navegador) es exactamente el tipo de cambio amplio y no verificable que el encargo
  pide evitar — el riesgo de romper un layout que no puedo ver compensa de sobra el beneficio de
  consistencia. Se documenta como tarea bien acotada para cuando haya verificación visual
  disponible (Fase 10 real, con navegador).

### Fase 11 (Accesibilidad) — intentado por código, sin resultado fiable; se declara, no se finge

Probé un patrón de grep para botones solo-icono sin `aria-label`/`title`. El resultado no es
fiable: los atributos JSX se reparten en varias líneas y una regex no distingue un botón decorativo
de uno funcional sin reconstruir el árbol JSX real. Hacerlo bien pide una herramienta real (axe-core
contra el DOM renderizado, o lectura manual asistida por navegador) — exactamente lo que falta esta
sesión. No se reporta ningún hallazgo de accesibilidad por no tener confianza suficiente en el
método; inventar uno para "tener algo que decir" sería peor que no decir nada.

### Fase 12 (Performance) — N+1 muestreado en rutas críticas: sin hallazgos

Se revisaron por código las rutas de API que alimentan pantallas interactivas (no crons/webhooks/
backfills, donde procesar secuencialmente es aceptable) en busca del patrón "una query de BD por
iteración de un bucle": `appointments/closer-conflicts`, `contacts/[id]`, `sales/[id]`. Las tres
agrupan y consultan por lotes (`.in(...)`) fuera de cualquier bucle — los bucles que tienen son
sobre datos ya en memoria, no generan una query por vuelta. Sin hallazgos de N+1 en las rutas
muestreadas. La medición real (LCP/INP/CLS de producción, tamaño de bundle servido, llamadas
duplicadas en el navegador) sigue necesitando runtime/navegador — no se inventa aquí.

## 7. Plan de fases (continuación, no reinicio)

Dado el tamaño real (93 pantallas, 14 fases, 42 secciones del encargo), este es un trabajo
multi-sesión. Las fases siguientes, en orden:

| Fase | Qué                                                                                   | Estado |
| ---- | -------------------------------------------------------------------------------------- | ------ |
| 0    | Baseline + skills + revalidación del ledger S0-8                                       | **Hecho** |
| 1    | P0/P1 reales de código del ledger de S0-8                                              | **Hecho — resultado: ya no quedaba ninguno sin decisión previa de Alex** |
| 2    | Confirmar propósito de las 3 rutas "afiliados"                                         | **Hecho — falso positivo, no hay duplicación** |
| 3    | Seguridad: advisors de Supabase + `SECURITY DEFINER`/RLS                                | **Hecho — 1 vulnerabilidad real cerrada en producción (ver §6.1)** |
| 4    | Marketing/funnel: filtro de cuentas Meta, orgánico, comparabilidad del funnel conectado         | **Hecho — sin bugs; 2 huecos de cobertura documentados, no corregidos (ver §6.2)** |
| 5    | CRM/Setting/Sales: terminología, pipeline, asignación de setter                                 | **Hecho — 1 hueco real cerrado y validado con datos reales (ver §6.3)** |
| 6    | Finanzas/Comisiones: terminología de dinero, veto `pays_commissions` (D9), conciliación Stripe   | **Hecho — sin bugs; 1 hueco de DATOS real encontrado y reportado a Alex, no de código (ver §6.4). Morosidad/socios quedan sin revisar con datos reales** |
| 7    | Colaboradores: aislamiento frontend + RLS                                                       | **Hecho — sin hallazgos nuevos, 27/27 tests de aislamiento pasan (ver §6.5)** |
| 8    | Integraciones/Data Health: syncs obsoletas, fallos de job, webhooks                             | **Hecho — sin hallazgos nuevos, diseño ya correcto (ver §6.6)** |
| 9    | Action Center unificado (9 tipos, escalado por rol)                                              | **Hecho el diagnóstico — hueco real confirmado, NO se construye en esta fase: es feature nueva (ver §6.7)** |
| 10   | UX/UI: diseño/consistencia                                                                      | **Parcial — hallazgo real por código (Skeleton/EmptyState sin adoptar, ver §6.8); resto necesita navegador** |
| 11   | Accesibilidad                                                                                    | **Intentado por código, sin resultado fiable — necesita herramienta real (ver §6.8)** |
| 12   | Performance                                                                                      | **Parcial — sin N+1 en rutas muestreadas (ver §6.8); medición real necesita runtime/navegador** |
| 13-14 | Smoke test visual, regresión final                                                              | **Bloqueado para esta sesión — ver §1** |

## 8. Lo que necesito de Alex (no bloquea el resto, se deja documentado)

1. Decisión de retención de datos para F6 (privacidad) — bloquea la graduación de esa pieza, no del resto.
2. Reconectar Instagram/Meta.
3. Rotar `RESEND_API_KEY`.
4. Configurar UTMs/setter en los workflows de GHL.
5. `CRON_SECRET` en Vercel Preview.
6. Decisión A5 de `docs/MONEY.md` (refunds acumulados/clawback) — no tocar código de refunds sin esto.
7. Decisión sobre semántica de doble-submit en firma de contratos antes de implementar el CAS.
8. **Conciliar los pagos de Stripe sin cobro interno correspondiente que detecta `pagosSinCobro`**
   (ver §6.4) — detalle identificable comunicado aparte, no en este repo. Mientras no se resuelva,
   el Cash Collected del tenant afectado está subestimado.

Ninguno de estos detiene el resto del trabajo de código (Fases 1-14 siguen sin depender de ellos).
