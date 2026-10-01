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
| Cobro y comisión sin frontera transaccional                     | **Mejorado, no cerrado.** `PENDIENTES.md` (27-sep) documenta `collections/approve-review` ya recuperable (PR #245) y el patrón de ~92 escrituras sin comprobar error reducido activamente PR a PR. Queda barrido pendiente en `app/api` sin auditar completo. |
| `CRON_SECRET` no existe en Preview                              | Externo — **requiere a Alex** (config de Vercel Preview env).                                         |
| Contratos: firma concurrente sin CAS                            | **Sigue abierto**, documentado en `PENDIENTES.md` §Deuda técnica — requiere decisión del responsable de contratos antes de tocar código (impacto jurídico). |

**Conclusión de esta revalidación:** de los 9 ítems no-P0 que S0-8 dejó abiertos, **1 ya estaba
resuelto** (índices), **5 son bloqueos externos que dependen de Alex** (no de código), y **3 siguen
genuinamente abiertos y son código mío para trabajar** (frontera transaccional cobro/comisión, CAS
en firma concurrente, barrido completo del patrón de escrituras sin comprobar error).

## 5. Hallazgo nuevo de esta sesión (no estaba en S0)

**Duplicación aparente de "afiliados"** — existen tres rutas con ese nombre:
`app/[tenant]/afiliados/registro`, `app/[tenant]/marketing/afiliados/afiliados`,
`app/[tenant]/settings/afiliados`. Antes de tratarlo como duplicación a limpiar, hay que leer las
tres (pendiente — ver Fase 2): es plausible que sean registro público / gestión / configuración,
que son pantallas legítimamente distintas. **No se toca sin confirmar el propósito real de cada
una** (regla de la sección 5 del encargo: SCREEN/ROLE/PURPOSE antes de actuar).

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

## 7. Plan de fases (continuación, no reinicio)

Dado el tamaño real (93 pantallas, 14 fases, 42 secciones del encargo), este es un trabajo
multi-sesión. Las fases siguientes, en orden:

| Fase | Qué                                                                                   | Estado |
| ---- | -------------------------------------------------------------------------------------- | ------ |
| 0    | Baseline + skills + revalidación del ledger S0-8                                       | **Hecho (este documento)** |
| 1    | P0/P1 reales de código (frontera transaccional, CAS firma, barrido escrituras sin check) + `security-review` | Siguiente |
| 2    | Confirmar propósito de las 3 rutas "afiliados"; cerrar huecos de wiring encontrados     | Pendiente |
| 3-14 | Según el orden original del encargo                                                    | Pendiente |

## 8. Lo que necesito de Alex (no bloquea el resto, se deja documentado)

1. Decisión de retención de datos para F6 (privacidad) — bloquea la graduación de esa pieza, no del resto.
2. Reconectar Instagram/Meta.
3. Rotar `RESEND_API_KEY`.
4. Configurar UTMs/setter en los workflows de GHL.
5. `CRON_SECRET` en Vercel Preview.
6. Decisión A5 de `docs/MONEY.md` (refunds acumulados/clawback) — no tocar código de refunds sin esto.
7. Decisión sobre semántica de doble-submit en firma de contratos antes de implementar el CAS.

Ninguno de estos detiene el resto del trabajo de código (Fases 1-14 siguen sin depender de ellos).
