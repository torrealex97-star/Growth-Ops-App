# S0.4 — Barrido de bugs, datos y UX

Fase: **S0 tramo 2**, ítem S0.4 (`docs/plan/08-fases-s0-f4.md`). Fecha: 2026-09-21.

Clasificación del plan: **P0** seguridad o fuga · **P1** dato o dinero incorrecto · **P2** flujo roto ·
**P3** UX o rendimiento · **P4** cosmético. Regla: resolver P0–P2 y los P3 de alto impacto antes de
ampliar el área afectada.

Fuentes barridas: advisors de Supabase (seguridad y rendimiento), errores de producción de Vercel
(7 días), `integration_sync_runs` (30 h), la consistencia de cash de S0.5 y lo que dejaron abierto
S0.1, S0.2 y A0. Este documento no contiene datos personales.

## 1. Resuelto en este barrido

| #   | Prio   | Hallazgo                                                                                                                                                                                                         | Arreglo                                                                                                          |
| --- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | **P0** | Regresión de F-1: `20260920120000` recreó la RPC del RAG de 6 argumentos con la puerta vieja (rol sin subcuenta). Un admin de un cliente podía leer el conocimiento de otro. Además nació ejecutable por `anon`. | Migración `20260921172046` + `tests/rag-gate-subcuenta.test.mjs` (mira el estado FINAL). **Aplicada el 21-sep.** |
| 2   | **P1** | 12 pagos de Stripe (5.095,41 €) sin cobro y ningún aviso. El control miraba clientes, no pagos: no veía segundas cuotas ni pagos sin cliente en Stripe.                                                          | Controles `pago_stripe_sin_cobro` y `cobro_de_pago_devuelto` en Salud de datos (#132).                           |
| 3   | **P1** | El sync de Stripe solo guardaba `receipt_email`, vacío en los 59 pagos: el espejo no sabía de quién era ninguno.                                                                                                 | Cae al correo de facturación del cargo (#132).                                                                   |
| 4   | **P2** | Subir un VSL enseñaba el error técnico de Vercel Blob en inglés: no hay almacén conectado.                                                                                                                       | Mensaje claro con la alternativa (pegar el enlace) (#134). Activar la subida es decisión de Alex (§3).           |
| 5   | P3     | `deploy.yml` afirmaba que la integración de Vercel no existía y no podía ejecutarse; el runbook lo ofrecía para hacer rollback.                                                                                  | Borrado; runbook apunta a Instant Rollback (#135). Cierra A0 §2.5.                                               |
| 6   | P4     | `ci.yml` justificaba su alcance con una cuota de repo privado; el repo es público.                                                                                                                               | Comentario corregido (#135). Cierra A0 §2.3.                                                                     |

## 2. Causa de los 12 pagos sin cobro

El sync funciona: el cron diario lee los pagos (69 hoy) y no hay nada colgado. El cobro de Stripe
**se registra a mano y por lotes** — mediana de **33 días** entre el pago y su registro, último lote
el 14-sep —, porque crear la venta exige producto y plan, que un pago no trae. Es una decisión de
diseño correcta. Lo que fallaba es que **nada avisaba** de los pagos que quedaban fuera:

- **Cuotas de quien ya tiene venta.** El control "cliente sin venta" da OK en cuanto hay una venta, así
  que la segunda y la tercera cuota eran invisibles.
- **Pagos sin cliente en Stripe** (los cinco de 50 €, típicos de enlace de pago): no hay cliente que
  revisar, así que no existían para el control.

**Registrados el 21-sep** con aprobación de Alex: 0 pagos sin cobro y Stripe = cobros al céntimo
(27.029,46 €). Detalle en el handoff.

## 3. Abierto, con dueño

| Prio | Hallazgo                                                                                                 | Dueño / destino                                                |
| ---- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| P1   | Devolución de 50 €: el cobro sigue contando                                                              | **Alex / finanzas** (registrar la devolución)                  |
| P1   | `RESEND_API_KEY` guardada como valor legible                                                             | **Alex** (rotar) — A0 §2.4                                     |
| P1   | El porcentaje de comisión vive en el código                                                              | F3 / `MONEY.md`                                                |
| P1   | El webhook de GHL no escribe capa raw: sin replay                                                        | F1                                                             |
| P1   | GHL no envía UTMs: `contact_attributions` vacía                                                          | **Alex** (config de GHL)                                       |
| P1   | La devolución no entra sola: Stripe la sabe y la app no                                                  | F5 (hoy solo se avisa, §1 #2)                                  |
| P2   | Subida de VSL: ahora va a **Bunny Stream** (integración nueva, 2026-09-21). Falta configurarla           | **Alex** (Integraciones › Bunny, 5 min)                        |
| P2   | `CRON_SECRET` no existe en Preview                                                                       | **Alex** — A0 §2.1                                             |
| P2   | Cobro y comisión sin frontera transaccional                                                              | F5                                                             |
| P2   | Token de Meta de WDC sin permisos                                                                        | **Alex** (reconectar)                                          |
| P2   | Un timeout que mata la función no deja fila en `integration_sync_runs`: el de hoy a las 13:57 no consta  | S0.7 (baseline de integraciones)                               |
| P3   | Calendly tarda 42–53 s por pasada con un presupuesto de 35 s: cerca del límite de 60                     | S0.7                                                           |
| P3   | 38 políticas RLS reevalúan `auth.uid()` por fila; 307 políticas permisivas solapadas; 1 índice duplicado | S0.6 (baseline de rendimiento) — sin impacto al volumen actual |
| P3   | `vector` y `pg_trgm` instalados en `public`                                                              | F7                                                             |
| P3   | Protección de contraseñas filtradas desactivada en Supabase Auth                                         | **Alex** (un interruptor)                                      |
| P3   | Proyecto `go-prod` vacío en Vercel                                                                       | **Alex** (borrar) — A0 §2.6                                    |
| P3   | `evergreen` incrustado en 168 rutas                                                                      | Antes de F8                                                    |
| P4   | `url.parse()` obsoleto en la ruta del agente (viene de una dependencia)                                  | Cuando se actualice la dependencia                             |

## 4. Descartado tras mirarlo

- **`useTenant()` llamado desde el servidor** (484 errores en `/[tenant]`): último el 15-sep. Ya
  corregido; no se repite.
- **Tablas de `backup_20260914` con RLS y sin políticas**: RLS sin políticas deniega todo. Es lo
  correcto para una copia de seguridad.
- **`public_tenant_branding` ejecutable por `anon`**: intencionado, lo usa el login antes de haber
  sesión y solo devuelve marca pública.
