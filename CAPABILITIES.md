# CAPABILITIES — qué funciona, con qué reservas

Estado a **2026-09-22**, `main` en `529d729`. Exigido por la graduación de S0
(`docs/plan/08-fases-s0-f4.md` §S0.8).

Vocabulario del plan: **STABLE** (funciona y está cubierto por tests) · **WORKING_WITH_ISSUES**
(funciona, con defectos conocidos y anotados) · **PARTIAL** (hecho a medias, a propósito) ·
**BROKEN** (no funciona hoy) · **LEGACY** · **UNUSED** · **UNKNOWN** (nadie lo ha auditado).

Ningún estado de aquí es una opinión: cada uno cita la evidencia. Lo que no se ha comprobado se
declara UNKNOWN en vez de suponerlo bien.

## Superficie

| Dimensión                        | Hoy     | Era (20-sep) |
| -------------------------------- | ------- | ------------ |
| Páginas                          | 97      | 92           |
| Rutas de API                     | 188     | 180          |
| Módulos de dominio (`lib/`)      | 78      | 73           |
| Migraciones                      | 78      | 66           |
| Ficheros de test                 | 244     | 123          |
| Tests unitarios (pasan / fallan) | 743 / 0 | 519 / 0      |
| Tests E2E (Playwright, en CI)    | 4       | 0            |

## Estado por área

| Área                            | Estado                  | Evidencia y reservas                                                                                                                                                                                          |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Acceso y multi-subcuenta**    | **STABLE**              | RLS en las 108 tablas (todas); tests de aislamiento, no-enumeración de subcuentas, aciclicidad de políticas e invariante de `tenant_id`. Reserva: protección de contraseñas filtradas **desactivada** (Alex). |
| **Panel de integraciones**      | **STABLE**              | 13 integraciones con guía paso a paso y prueba de conexión (`tests/integraciones-guia.test.mjs`). Baseline completo en `docs/S0-7-INTEGRACIONES.md`.                                                          |
| **Cobros (Stripe)**             | **STABLE**              | Espejo idempotente por `payment_id`; cron diario + webhook firmado. Stripe y la app cuadran **al céntimo** (27.029,46 €) tras registrar los 12 pagos pendientes. Única integración sin errores en 30 días.    |
| **Agenda (Calendly + GHL)**     | **WORKING_WITH_ISSUES** | 593 citas, sin duplicados entre fuentes. Reservas: **249 asistencias son provisionales** (marcado del 22-sep, pendiente de que los closers revisen) y **ninguna cita de GHL trae setter** (faltan UTMs).      |
| **CRM y contactos**             | **WORKING_WITH_ISSUES** | 968 contactos de GHL, identidad única por correo normalizado. Reserva: **362 sin correo ni teléfono** — no se pueden deduplicar ni enlazar con pagos; 26 nombres repetidos entre ellos.                       |
| **Ventas y facturación**        | **WORKING_WITH_ISSUES** | Una venta por cliente con sus cobros; el registro desde Stripe exige producto y plan (decisión humana, correcta). Reserva: el registro va **a mano y por lotes** (mediana histórica: 33 días).                |
| **Comisiones**                  | **WORKING_WITH_ISSUES** | Motor con base neta de fee real, tramos por rep y reparación por venta o por subcuenta. Reserva: **el porcentaje vive en el código**, no en configuración (va a F3).                                          |
| **Devoluciones**                | **PARTIAL**             | `refunds` con **0 filas** y un cobro de 50 € contra un pago que Stripe devolvió. El camino de devolución no está cerrado (va a F5).                                                                           |
| **Marketing — Meta Ads**        | **WORKING_WITH_ISSUES** | 171 campañas y 1.840 días de gasto. Reserva: **22 de 52 ejecuciones fallan** ("cuenta publicitaria no reconocida") — depende de que Alex reconecte.                                                           |
| **Marketing — Instagram**       | **BROKEN**              | **Token caducado el 14-sep**; 26 ejecuciones en error. Los datos que hay (40 publicaciones) son de antes.                                                                                                     |
| **Llamadas (Fathom)**           | **WORKING_WITH_ISSUES** | 107 llamadas con grabación y transcripción; la grabación ya marca la asistencia. Reserva: **177 reuniones en cola de revisión** sin resolver desde el 14-sep.                                                 |
| **Atribución y tracking**       | **PARTIAL**             | Endpoint vivo e idempotente, pero **3 sesiones y 5 eventos** en total: está montado, no está en uso. GHL no manda UTMs.                                                                                       |
| **Correo (Resend)**             | **PARTIAL**             | Los envíos salen (contratos, invitaciones, recuperación). El webhook de estados **nunca ha recibido nada**: no se sabe qué correos se abren o rebotan.                                                        |
| **VSL**                         | **PARTIAL**             | Alojamiento en Bunny Stream con subida directa firmada (22-sep). Sin vídeos subidos todavía: sin uso real que confirme el flujo entero.                                                                       |
| **IA: agente y RAG**            | **WORKING_WITH_ISSUES** | Búsqueda híbrida con puerta por subcuenta (P0 corregido el 21-sep). Reserva: el conocimiento se ingesta a mano desde las skills; sin medición de calidad de respuesta.                                        |
| **Privacidad (`erase_person`)** | **PARTIAL**             | Plan y ejecutor implementados y probados. **No gradúa**: la política de retención no está decidida y `raw_events` no permite localizar a una persona.                                                         |
| **Colaboradores**               | **UNKNOWN**             | Área desarrollada por la otra hebra (21–22 sep) con sus propios tests de aislamiento y cadena de contrato. **No la he auditado**: no afirmo nada sobre ella.                                                  |
| **Portales públicos**           | **UNKNOWN**             | Contratos y onboarding por enlace firmado. Sin auditar en S0.                                                                                                                                                 |

## Qué se puede tocar con seguridad, y qué no

**Seguro de evolucionar** (comportamiento fijado por tests y baseline medido): panel de
integraciones, cobros de Stripe, aislamiento por subcuenta, métricas agregadas (`lib/metrics`,
golden dataset), privacidad.

**Tocar solo con una decisión previa**:

- **Políticas RLS** — 348 políticas; cambiarlas afecta a quién ve qué. Hay una mejora medida y
  pendiente (×30 en cada lectura, `docs/S0-6-RENDIMIENTO-FRONTEND.md` §2).
- **Comisiones** — el porcentaje en código; cambiarlo mueve dinero ya calculado.
- **Ingesta de GHL** — se rehace en F1; parchearla ahora es trabajo que se tira.
- **Vocabulario de `canonical_events`** — el mapeo lo elige el usuario, no el código.

**No tocar sin reconectar antes**: Meta e Instagram (credenciales caducadas o sin permiso).
