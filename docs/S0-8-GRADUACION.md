# S0.8 — Graduación de S0

Fase: **S0 tramo 2**, ítem S0.8 (`docs/plan/08-fases-s0-f4.md`). Fecha: 2026-09-22.
`main` en `529d729`.

El plan cierra S0 cuando: los recorridos críticos están documentados y protegidos; los P0, P1 y P2
están corregidos **o formalmente bloqueados**; existe baseline de datos, UX y rendimiento; y se sabe
qué partes pueden evolucionar con seguridad y cuáles no.

## 1. Entregables

| Requisito del plan               | Dónde está                                                              | Estado    |
| -------------------------------- | ----------------------------------------------------------------------- | --------- |
| `CAPABILITIES.md` actualizado    | `CAPABILITIES.md` (raíz)                                                | **hecho** |
| Journeys críticos con regresión  | `docs/S0-2-JOURNEYS-CRITICOS.md` + §2 de aquí                           | **hecho** |
| Ledger de bugs priorizado P0–P4  | §3 de aquí (consolida S0.4, S0.5, S0.6, S0.7 y A0)                      | **hecho** |
| Baseline de datos                | `docs/S0-5-CONSISTENCIA-DATOS.md`, `scripts/consistencia-cash.sql`      | **hecho** |
| Baseline de rendimiento y UX     | `docs/S0-6-RENDIMIENTO-FRONTEND.md`, `scripts/rendimiento-baseline.sql` | **hecho** |
| Baseline de integraciones        | `docs/S0-7-INTEGRACIONES.md`                                            | **hecho** |
| Áreas seguras y áreas bloqueadas | `CAPABILITIES.md` §final                                                | **hecho** |

## 2. Recorridos críticos y su red de seguridad

743 tests unitarios (0 fallan) y 4 recorridos end-to-end reales en CI con navegador.

| Recorrido                       | Qué lo protege                                                                                                                                   | Cobertura                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Lead → CRM (webhook de GHL)     | `webhook-ghl`, `webhook-secret-diagnostico`, `contactos-carrera`, `custom-fields-ghl`, `citas-estado-externo-y-asistencia`                       | **alta**                                                            |
| Agenda → asistencia             | `agenda-marcado-ui`, `metrics/agenda-marcado`, `cron-calendly-ghl`, `fathom-match`, `fathom-sync`                                                | **alta**                                                            |
| Venta → cobro → comisión        | `e2e/venta-completa`, `stripe-import`, `commission-base-neta`, `commissions-tenant`, `tramos-mes`, `plan-cuotas`, `reparar-comisiones-por-venta` | **alta**                                                            |
| Reserva → venta completa        | `e2e/reserva-desde-cero`, `e2e/reservas`, `control-pagos-personas`                                                                               | **alta**                                                            |
| Pago de Stripe → cash collected | `stripe-webhook-route`, `cron-stripe-payments`, `canonical/cash`, `salud-pagos-stripe-sin-cobro`, `golden-dataset`                               | **alta**                                                            |
| Login y subcuenta               | `login-subcuenta-inexistente`, `tenant-isolation`, `tenant-no-enumeration`, `tenant-root-redirect`, `rol-por-tenant`, `cascada-sesion`           | **alta**                                                            |
| Integraciones (alta y prueba)   | `integraciones-guia`, `integraciones-conectores`, `webhooks-entrantes`, `webhooks-secreto-por-subcuenta`, `integration-health`                   | **alta**                                                            |
| Panel y métricas                | `metrics/*` (60 ficheros), `golden-dataset`, `pantallas-hueco-no-es-cero`                                                                        | **alta**                                                            |
| Privacidad (borrado de persona) | `f6-plan-borrado`, `f6-erase-person`, `f6-vinculo-contacto`                                                                                      | **alta**                                                            |
| Marketing (Meta e Instagram)    | `meta/actions`, `metrics/meta-*`, `organico`, `funnels/*`                                                                                        | media — la fuente está caída, así que el camino real no se ejercita |
| Colaboradores                   | `colaboradores-aislamiento`, `cadena-contrato-colaborador` (de la otra hebra)                                                                    | **sin auditar por mí**                                              |
| Contratos y portales públicos   | `cadena-contrato-colaborador`, `email-plantillas`                                                                                                | media                                                               |

## 3. Ledger P0–P4

**Corregidos en S0 tramo 2** (con su PR como evidencia):

| Prio   | Qué                                                                         | Evidencia                                               |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| **P0** | RPC del RAG sin comprobar la subcuenta y ejecutable sin sesión              | #133 + migración `20260921172046` aplicada y verificada |
| **P1** | 12 pagos de Stripe (5.095,41 €) sin cobro y sin aviso                       | #132; registrados el 21-sep: Stripe = cobros al céntimo |
| **P1** | El espejo de Stripe no guardaba el correo del cliente                       | #132                                                    |
| **P2** | Secreto del webhook de Calendly compartido entre subcuentas                 | #175                                                    |
| **P2** | Webhook de Apify abierto si no había secreto configurado                    | #175                                                    |
| **P2** | Un fallo de lectura se pintaba como **0 €** en las pantallas de dinero      | #176                                                    |
| **P2** | Traducción de estados de GHL duplicada: `no-show` se guardaba como agendada | #177                                                    |
| **P2** | La grabación no marcaba la asistencia (107 grabadas, 3 marcadas)            | #177; 99 marcadas por evidencia                         |
| **P2** | El 401 del webhook de GHL no decía cuál de las cuatro causas era            | #127                                                    |
| P3     | `deploy.yml` inservible y comentario falso en CI                            | #135                                                    |
| P3     | Migraciones aplicadas sin registrar (6)                                     | registradas el 22-sep                                   |

**Abiertos, con dueño declarado** (ninguno es P0):

| Prio   | Qué                                                                                     | Dueño / fase                            |
| ------ | --------------------------------------------------------------------------------------- | --------------------------------------- |
| **P1** | Token de Instagram caducado; cuenta de Meta no reconocida                               | **Alex** (reconectar)                   |
| **P1** | `RESEND_API_KEY` guardada como valor legible                                            | **Alex** (rotar)                        |
| **P1** | Porcentaje de comisión en el código                                                     | F3 / `MONEY.md`                         |
| **P1** | GHL no manda UTMs: sin setter en ninguna cita de GHL                                    | **Alex** (configurar GHL)               |
| **P1** | La devolución de Stripe no entra sola; `refunds` vacía                                  | F5                                      |
| **P2** | El webhook de GHL no escribe capa raw: sin replay                                       | F1                                      |
| **P2** | Un contacto sin nombre tumba el lote entero de GHL                                      | F1                                      |
| **P2** | 362 contactos de GHL sin correo ni teléfono                                             | F1                                      |
| **P2** | Cobro y comisión sin frontera transaccional                                             | F5                                      |
| **P2** | Índices únicos sin `tenant_id` (`campaigns`, `ig_media`)                                | F7                                      |
| **P2** | `CRON_SECRET` no existe en Preview                                                      | **Alex**                                |
| P3     | RLS evaluada por fila (×30 en cada lectura)                                             | F7                                      |
| P3     | Historial de migraciones desalineado (29 ficheros)                                      | reparación con respaldo, como el 13-sep |
| P3     | Sin medición de tiempos de carga de página                                              | F8                                      |
| P3–P4  | Resto (índices sin uso, extensiones en `public`, `evergreen` en 168 rutas, `url.parse`) | F7 / F8                                 |

**Deuda declarada hoy, no un fallo**: las **249 citas marcadas como asistidas de forma provisional**
el 22-sep por decisión de Alex. La tasa de asistencia no es fiable hasta que los closers las revisen;
se listan con `notes like '%PENDIENTE de que el closer confirme%'` y están en `audit_logs`.

## 4. Veredicto

**S0 gradúa.** Los cuatro requisitos se cumplen: journeys protegidos, ningún P0 abierto, todos los P1
y P2 abiertos con dueño y fase asignada, baselines escritos y reproducibles, y el mapa de lo que se
puede tocar.

Con dos condiciones escritas, para que graduar no signifique olvidar:

1. **F6 no gradúa con S0.** El borrado de una persona no se puede declarar completo mientras la
   política de retención no esté decidida y `raw_events` no permita localizarla.
2. **Los cuatro bloqueos de Alex son de calendario, no de código** (Instagram, Meta, rotar Resend,
   UTMs de GHL). Nada de F1 los espera, pero las métricas de marketing y de setter **seguirán siendo
   falsas** hasta que se resuelvan.

## 5. Lo siguiente

**F1 — event core.** Es donde caen tres P2 ya diagnosticados: la capa raw del webhook de GHL (sin
ella no hay replay), el lote que se cae entero por un contacto sin nombre, y el vínculo de
`raw_events` con la persona, que además desbloquea el borrado de F6.
