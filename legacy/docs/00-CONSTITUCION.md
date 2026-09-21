# 00 — Constitución del proyecto

Cuándo cargarlo: en toda sesión. Es el único documento que siempre se lee.

## 1. Tesis y producto

No construir un dashboard con muchas integraciones. Construir un modelo digital continuamente actualizado del negocio que permita consultar, diagnosticar y operar dónde se crea o se pierde dinero.

Producto en una frase: un sistema que unifica el journey económico de cada persona, detecta el cuello de botella con mayor impacto, explica por qué ocurre con evidencia y permite actuar de forma segura.

Resultado que debe entregar: fuente de verdad canónica independiente del proveedor; trazabilidad de anuncio, DM o registro hasta venta, cash, entrega y LTV; diagnóstico del punto que más dinero frena; evidencia rastreable de cada conclusión; y acción a través de la misma capa de dominio que usa la UI.

## 2. Ruta de producto

| Etapa | Qué es | Criterio para pasar |
|---|---|---|
| A — Interno | Workspaces de las ventures de Scalix | El equipo lo usa cada semana; se actúa sobre al menos un constraint con € recuperados medibles; el reporting manual baja de forma verificable |
| B — Clientes de Scalix | Workspaces de clientes con DPA firmado y credenciales de solo lectura | Clientes que renuevan o pagan; onboarding repetible sin tocar el core |
| C — Producto | Billing, self-serve, apps públicas, pricing | Solo si B demuestra demanda, con design partners y criterio de kill con fecha |

Umbrales de la etapa A (a completar por ti antes de arrancar F1; sin números esta etapa no puede graduarse):

- € recuperados que dan la etapa por validada: **[definir]** € en **[definir]** semanas.
- Horas de reporting manual ahorradas por semana: **[definir]**.
- Fecha de revisión de la etapa A y criterio de continuar o parar: **[definir]**.
- Capacidad real: **[definir]** horas por semana; ejecuta **[definir]** con los agentes de coding.
- Límite de trabajo en curso: una fase activa a la vez. Nada nuevo empieza hasta cerrar la graduación de la anterior.

Funnels de partida, con la cola común Booked → Show → Close → Cash:

- **A — DM orgánico**: Post/Reel/Story → DM (IG/TikTok) → cualificado en chat → link Calendly → Booked → Show → Close → Cash.
- **B — Webinar Meta**: Meta Ads → Registro → Asistencia → Aplicación/CTA → Booked → Show → Close → Cash.

## 3. Principios no negociables

| Principio | Regla |
|---|---|
| Canonical first | El proveedor nunca define el dominio; todo dato externo se adapta al modelo canónico |
| Postgres first, monolito modular | Una base y una codebase bien separada antes de microservicios |
| Raw + normalized | Conservar la fuente con política de retención y derivar lo canónico de forma reprocesable |
| Facts ≠ attribution | El evento real y la interpretación de atribución son objetos distintos |
| Code calculates; AI explains | Dinero, métricas, permisos y reglas se calculan de forma determinista |
| Evidence by default | Ningún insight sin fuente, periodo, volumen y última sincronización |
| Human agency | Preview y aprobación en comunicación masiva, ads, finanzas y acciones destructivas |
| Tenant-scoped from day 1 | `tenant_id`, RLS e invariante de esquema en CI en toda tabla nueva |
| Config, not code | Si algo difiere entre tenants, va a configuración versionada |
| Privacy by design | La PII vive en un único sitio conocido; borrar a una persona es un procedimiento probado |
| Untrusted content is data | Mensajes, transcripciones y notas nunca son instrucciones para el agente |
| Evolucionar, no reescribir | Antes de crear una tabla o módulo, comprobar si ya existe uno que cubra el papel |
| Preservation first | La app ya funciona en producción: preservar comportamiento correcto, regresión antes de refactor, mejorar antes de reemplazar |

## 4. Estado real (auditoría del 2026-09-20)

La app Growth-Ops-App es el sistema de registro (CRM, ventas, finanzas, comisiones, contratos, tracking, agente con RAG). GHL entra por webhook y Calendly se usa sobre todo para crear reservas.

| Pieza | Estado | Evidencia |
|---|---|---|
| Event core | Parcial | `raw_events`, `canonical_events`, `delivery_attempts` con idempotencia; cubre tracking y Stripe; el webhook de GHL escribe directo; 3 filas en cada tabla en producción |
| Organization sobre tenant | Ausente | Sin `organizations` ni `participation_pct` |
| Connector SDK | Parcial | `integration_sync_runs`, health e historial; sin interfaz común ni plantilla |
| Capa semántica | Parcial fuerte | Registro de métricas con fiabilidad y estado del dato, registro de fuentes con primary y fallbacks; faltan lineage, grain, madurez y confianza estadística |
| Constraint Engine | Existe | `lib/metrics/cuello-botella.ts`; faltan € por etapa, mix shift y persistencia Claim + Evidence |
| Command Engine | Parcial | Lista blanca deny-by-default y `PropuestaAccion`; faltan `commands`, `approvals`, idempotencia y estados |
| Privacidad | Ausente | PII en claro en `contacts`; sin `erase_person` |
| Identidad | Parcial | `contacts` con `merged_into`, normalizados, `ghl_contact_id`, `instagram` (texto); sin `handle_only` |

Datos de producción (recuentos): 2 tenants, 972 contactos, 559 citas, 28 ventas, 49 cobros, 69 pagos Stripe.

## 5. Roadmap por fases

Orden de ejecución: S0 tramo 1 → A0 → F-1 → S0 tramo 2 → F1 → F2 → F3 → F7 → F4 → F6 → IA cualitativa (llamadas, transcripciones, mensajes, RAG) → F5 → F0 → F8 → F9. Una sola fase activa a la vez. Los meses son orientativos; manda el orden y la graduación.

| Fase | Qué | Graduación |
|---|---|---|
| S0 tramo 1 (S0.1 a S0.3) | Inventario de capacidades, journeys críticos y regresión golden | Journeys críticos documentados y protegidos por tests |
| A0 | Cierre de auditoría (queda Vercel) | Ningún ítem de la auditoría en estado unknown |
| F-1 | Higiene de seguridad, invariante de tenant obligatorio en CI, fixtures sintéticos Tenant A y B y pruebas básicas de prompt injection | Sin secretos expuestos, sin funciones ni esquemas abiertos, sin tests de aislamiento omitidos, tools de lectura resistentes a contenido hostil |
| S0 tramo 2 (S0.4 a S0.8) | Barrido de bugs, consistencia de datos, baseline de frontend e integraciones | P0/P1/P2 corregidos o bloqueados; baseline de datos, UX y performance |
| F1 | Event core a GHL y Stripe con replay (requiere staging, observabilidad inicial, backup con restore comprobado y flags mínimos para el cutover) | Un webhook duplicado no crea dos efectos; un día completo se reprocesa y converge |
| F2 | Contrato Connector y plantilla (con tests de arquitectura) | Un conector nuevo implementa manifest y pasa la suite de contrato |
| F3 | Semántica + `MONEY.md` | Cada cifra nombra definición, versión, grain, fuente, frescura y confianza |
| F7 | Funnel A (DM orgánico) de primera clase; depende de F1 y F3 | Se mide hasta cash con cobertura y confianza visibles |
| F4 | Cuello de botella con impacto económico | Estimación con supuestos, rango y evidencia abrible; sabe abstenerse |
| F6 | Privacidad y `erase_person`; debe cerrarse antes de ingerir más transcripciones, mensajes o llamadas al RAG | Sin PII recuperable en stores activos; informe de borrado verificable |
| IA cualitativa | Llamadas, transcripciones, mensajes y RAG, con evals y control de coste | El agente responde qué pasó, por qué, a quién afecta y con qué evidencia |
| F5 | Commands, policies y approvals; IA solo en riesgo 0 y 1 | Acciones reversibles con permiso e idempotencia; niveles 2 y 3 solo con flujo humano |
| F0 | `organizations`, `participation_pct`, `org_metric_snapshots`; se ejecuta justo antes de F8 | Las vistas de organización solo consumen agregados; tests prueban que no hay acceso persona a persona entre tenants |
| F8 | Segundo tenant real + consolidado | El segundo tenant funciona solo con configuración |
| F9 | Weekly Brief, vistas por rol, call intelligence con rúbrica y evals completos | Uso semanal; los evals bloquean regresiones |
| F10 | Producto (aplazado) | Solo si la etapa B valida |

Plan de 6 meses (orientativo):

- **Mes 1**: S0 tramo 1, A0, F-1 (incluye CI con el invariante de tenant obligatorio, fixtures Tenant A y B y pruebas básicas de prompt injection). Nada más.
- **Mes 2**: S0 tramo 2, staging y entornos separados, observabilidad inicial, backup con restore comprobado, flags mínimos y F1.
- **Mes 3**: F2 (solo GHL, Stripe y Meta; con tests de arquitectura) y F3 con `MONEY.md`, `METRICS.md` y `SOURCE_OF_TRUTH.md`.
- **Mes 4**: F7 y F4; mejora de Command Center, Funnel, Person 360 y Data Health.
- **Mes 5**: F6 y, después, IA cualitativa (llamadas, transcripciones, mensajes, RAG) con evals y control de coste.
- **Mes 6**: F5 (acciones IA solo riesgo 0 y 1), F0 y F8, y el resto de F9.

Un solo tenant real hasta F4; los tenants sintéticos A y B existen desde F-1.

Reparto orientativo del esfuerzo inicial: 70 % estabilizar y simplificar, 20 % completar workflows existentes, 10 % explorar. P0 y P1 siempre pasan primero.

Dependencias: F-1 → F1 → F2 → F3 → (F7, F4). F7 depende de F1 y F3. F4 depende de F1, F3, `MONEY.md` y Data Health. F6 → IA cualitativa. Commands → acciones IA. F0 → F8. F0 ya no bloquea F1 a F7 porque `organizations` es una tabla aditiva.

## 6. Definición de terminado del MVP

- Funnels A y B medidos hasta cash en un venture real, definidos por configuración.
- Person 360 con timeline trazable e identidades `handle_only`.
- Métricas por cohorte con madurez, lineage y confianza de datos y estadística.
- Al menos un constraint cuantitativo con impacto en € y evidencia abrible.
- Preguntas de solo lectura con evidence y timestamp; golden set en CI.
- Data Health expuesto; webhooks y jobs idempotentes y replayables.
- Aislamiento de tenant en todas las queries y tools; `erase_person` pasa su test.
- Cash manual importable por CSV o Sheets.

## 7. Riesgos principales

Secretos en refs públicas antiguas; PII en claro sin borrado reproducible; webhook de GHL sin capa raw; consolidado imposible sin `organizations`; conclusiones sobre ruido por métricas sin madurez; deriva de migraciones entre repo y Supabase; hardcodear el core a las operaciones de Scalix; dependencia de APIs cerradas (TikTok DM, Skool).

## 8. Decisiones pendientes

| Decisión | Bloquea |
|---|---|
| Cifra oficial del consolidado: bruta o atribuible | `MONEY.md`, F3 y F8 |
| Fuente del show: plataforma de llamadas, etapa de GHL o manual | `show_rate`, F3, F4 |
| Plataforma de webinar y datos de asistencia | Conector del funnel B |
| Captura de DMs de Instagram y TikTok | `content_trigger` y atribución del funnel A |
| Retención de raw y transcripciones | Cierre de F6 y, por tanto, la IA cualitativa |
| Primer tenant del vertical slice | F1 a F4 con datos reales |
| Repo privado o recreado | Cierre de F-1 |
| Umbrales, fecha de revisión y capacidad de la etapa A (`[definir]` en la sección 2) | Arranque de F1 |

Regla: una decisión pendiente solo detiene la fase si cambia de forma irreversible el modelo o la semántica. Si no, se implementa lo reversible y se marca el punto bloqueado.

## 9. Prioridad permanente y admisión de features

Clasifica cada idea: **P0** seguridad, pérdida de datos o aislamiento de tenant; **P1** fuente de verdad o dinero; **P2** workflow principal; **P3** productividad; **P4** nice-to-have. P0 y P1 interrumpen el roadmap; P3 y P4 no retrasan las fases fundamentales.

Feature Admission Gate: (1) si la capacidad relacionada existente no es estable, mejorarla primero; (2) si completa un workflow existente, tiene prioridad; (3) si crea un workflow nuevo, va a backlog salvo necesidad demostrada.

## 10. Won't Have y después de 6 meses

No hacer: Kafka, Kubernetes, microservicios, base de datos por tenant, warehouse externo, event sourcing puro, Neo4j; atribución multi-touch sofisticada antes de identidad y tracking fiables; autonomía financiera o publicitaria sin aprobación; billing, self-serve, wizard de onboarding y apps públicas antes de la etapa C; cruce de personas entre tenants; dependencia de APIs no oficiales.

Solo tras demostrar uso y valor: billing, self-service, integraciones públicas, API pública, webhooks salientes, constructor de automatizaciones, marketplace, app móvil, warehouse u OLAP.

Regla final: no añadir una tecnología porque "puede escalar"; solo cuando exista una carga concreta que Postgres, el monolito modular y los workers no resuelvan.

## 11. North Star

Técnica: añadir tenant, integración, métrica, dashboard, tool de IA o funnel es configurar o completar un contrato existente, no inventar arquitectura.

Producto: un Growth Operator recorre ATTENTION → LEADS → CONVERSATIONS → BOOKINGS → SHOWS → SALES → CASH → DELIVERY → RESULTS → LTV sin abrir otras cinco herramientas, y el agente responde qué pasó, por qué, dónde, cuánto dinero afecta, qué evidencia existe y qué se puede hacer, con datos exactos, auditables y con permisos correctos.

No optimizar por cantidad de features, integraciones o dashboards, sino por confiabilidad del dato, time-to-insight, calidad de decisión, impacto económico y velocidad de acción.
