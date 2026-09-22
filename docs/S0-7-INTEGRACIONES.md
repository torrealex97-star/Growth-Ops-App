# S0.7 — Baseline de integraciones

Fase: **S0 tramo 2**, ítem S0.7 (`docs/plan/08-fases-s0-f4.md`). Fecha: 2026-09-22.

El plan pide, por integración: conexión, uso real, última sincronización, si va por webhook o por
sync, reintentos, duplicados, alcance por subcuenta, errores y quién consume los datos. F2 abstraerá
este comportamiento **sin cambiarlo en silencio**, así que esto es la foto contra la que comparar.

Método: solo lectura de producción (`integration_settings`, `integration_sync_runs`, tablas de
datos, índices), los workflows de GitHub y el código de las rutas. Sin datos personales: recuentos,
fechas y nombres de clave.

## 1. Estado por integración

Configuradas hoy, todas en la subcuenta del cliente (la subcuenta propia y la de pruebas no tienen
credenciales): Apify, Bunny, Calendly, DeepSeek, Fathom, GHL, Groq, Instagram, Meta, Resend, Stripe,
YouTube — 28 claves.

| Integración    | Cómo entra                            | Última sync                   | Datos hoy                | Duplicados los evita           | Estado                                                      |
| -------------- | ------------------------------------- | ----------------------------- | ------------------------ | ------------------------------ | ----------------------------------------------------------- |
| **Stripe**     | Cron 04:40 + webhook                  | 22-sep                        | 71 pagos, 28 clientes    | `(tenant, payment_id)`         | **OK** — la única sin errores en 30 días                    |
| **Calendly**   | Cron 04:20 + webhook                  | 22-sep                        | 498 citas                | `(tenant, external_id)`        | OK, pero **46 s de media** (límite: 60)                     |
| **GHL**        | Botón + webhook                       | 22-sep                        | 95 citas, 968 contactos  | `(tenant, external_id)`        | 14 OK / **5 errores**: un contacto sin nombre rompe el lote |
| **Meta Ads**   | Cron 03:00 (campañas) y 03:30 (gasto) | 21-sep campañas, 22-sep gasto | 171 campañas, 1.840 días | `(tenant, provider, external)` | 30 OK / **22 errores**: cuenta publicitaria no reconocida   |
| **Instagram**  | Cron 02:30                            | 22-sep                        | 40 publicaciones         | `(tenant, external_id)`        | **26 errores**: el token caducó el 14-sep                   |
| **Fathom**     | Sync con las citas                    | 22-sep                        | 107 con grabación        | `(tenant, meeting_id)`         | OK; 177 en cola de revisión (última, 14-sep)                |
| **Apify**      | Webhook de plataforma                 | 21-sep                        | 3 payloads               | **nada**                       | Ver §3.2 (acepta sin secreto si no hay secreto)             |
| **Tracking**   | Endpoint de ingesta                   | 21-sep                        | 3 sesiones, 5 eventos    | `(tenant, source, event_id)`   | Vivo pero casi sin uso                                      |
| **Resend**     | Envío + webhook de estados            | —                             | **0 eventos**            | `(provider, event_id)`         | El webhook nunca ha recibido nada                           |
| **YouTube**    | Manual (backfill)                     | —                             | —                        | —                              | Recién configurada (OAuth de 2 pasos, #131)                 |
| **Bunny**      | Subida desde la app                   | —                             | —                        | —                              | Configurada el 22-sep; sin vídeos todavía                   |
| **seQura**     | Cron lunes 08:00                      | —                             | —                        | —                              | Falta `SEQURA_MERCHANT_REFERENCE` (PENDIENTES)              |
| **Google/GA4** | Manual                                | —                             | —                        | —                              | Credenciales sí, uso no                                     |

Consumidores (quién se rompe si una fuente falla): Meta e Instagram → Marketing, embudo, CAC y unit
economics. Calendly y GHL → CRM, agenda, métricas de setter y closer. Stripe → cash collected,
comisiones, P&L. Fathom → análisis de llamadas y la IA. Tracking → atribución. Resend → estados de
envío de contratos e invitaciones.

## 2. Lo que funciona y conviene no tocar

- **Idempotencia real** en las fuentes que importan: Stripe por `payment_id`, citas por
  `(tenant, external_id)`, campañas por `(tenant, provider, external_id)`, eventos canónicos por tres
  claves distintas. Reejecutar una sincronización no duplica.
- **Presupuesto de tiempo** en las sincronizaciones largas: paginan hasta agotar su margen y declaran
  que quedó cortado (`truncated`) en vez de vender media lista como completa.
- **Registro de ejecuciones** (`integration_sync_runs`) con estado y mensaje de error por subcuenta:
  es lo que ha permitido escribir este documento sin adivinar.
- **Webhooks firmados**: Stripe verifica la firma sobre los bytes crudos, GHL compara el secreto en
  tiempo constante y con secreto por subcuenta, Resend valida Svix y rechaza si no hay secreto.

## 3. Hallazgos

### 3.1 El secreto del webhook de Calendly no es el de la subcuenta (P2)

Integraciones pide "Webhook Signing Key" **por subcuenta** y la guarda cifrada, pero
`app/api/[tenant]/evergreen/webhooks/calendly/route.ts` valida contra
`process.env.CALENDLY_WEBHOOK_SECRET`. La clave que guarde un cliente **se ignora**, y todas las
subcuentas comparten un secreto global: con él, el webhook de un cliente podría escribir en los datos
de otro. Es exactamente el fallo que GHL tuvo y que se corrigió el 21-sep (#127).

### 3.2 El webhook de Apify acepta sin secreto si no hay secreto (P2)

`if (secret) { …comprobar… }`: sin `APIFY_WEBHOOK_SECRET` configurado, cualquiera puede publicar
contenido social en la base. Hoy la variable existe en producción, así que no está expuesto — pero el
comportamiento por defecto es abrir, y los demás webhooks cierran (fail-closed).

### 3.3 Dos índices únicos ignoran la subcuenta (P2, aislamiento)

`campaigns_provider_external_idx (provider, external_id)` e `ig_media_external_idx (external_id)` son
**globales**. Existen además sus gemelos correctos con `tenant_id`. Consecuencia: si dos subcuentas
comparten una cuenta publicitaria o una cuenta de Instagram —lo normal en una agencia—, la segunda no
puede sincronizar: su fila choca con la de la primera. Con un solo cliente activo no se nota.

### 3.4 Un contacto sin nombre rompe el lote entero de GHL (P2)

Cinco ejecuciones fallaron con `23502` (`contacts.full_name` es obligatorio) al subir un lote de
contactos de GHL. No se pierde solo ese contacto: **se cae el lote completo**, y con él la sincronización.

### 3.5 Las subcuentas sin credenciales ensucian el registro de errores (P3)

La subcuenta propia y la de pruebas no tienen Meta ni Instagram, y cada cron deja una fila `error`
"Falta el token…": 19 filas en 14 días. Un error de configuración esperado no debería parecer una
avería; el estado honesto es "omitida". Esconde los errores de verdad.

### 3.6 Una función que muere por timeout deja la ejecución mal medida (P3)

Las filas `timeout` registran duraciones absurdas (hasta 24 h) porque la fila se cierra mucho después,
cuando otra pasada la marca. Y un timeout que mata la función sin que nadie la cierre **no deja fila**
(el de ayer a las 13:57 no consta). El panel puede decir "nunca ha fallado" sobre algo que se corta.

### 3.7 El historial de migraciones ha vuelto a desalinearse (P3)

29 ficheros de `supabase/migrations/` no constan con su versión en producción, y 14 registros de
producción no tienen fichero con esa versión (se aplicaron con `apply_migration`, que sella la hora
de aplicación). Ya pasó y se reparó el 13-sep (`docs/MIGRATION_RECONCILIATION.md`), con respaldo y
emparejando por nombre. **Las 6 migraciones del 21 y 22-sep sí se registraron** al detectarlo.
Mientras el desfase siga, `supabase db push` intentaría reaplicar 29 migraciones.

### 3.8 Calendly roza su límite de tiempo (P3)

46 s de media y 53 s de máximo por pasada, con 60 s de tope en Vercel. Hoy termina; el día que el
volumen suba, se corta a media sincronización.

## 4. Qué se lleva cada fase

| Hallazgo                                     | Prio | Destino                                      |
| -------------------------------------------- | ---- | -------------------------------------------- |
| Secreto de Calendly no por subcuenta         | P2   | Arreglado en este mismo tramo (ver §5)       |
| Webhook de Apify abierto por defecto         | P2   | Arreglado en este mismo tramo (ver §5)       |
| Índices únicos sin `tenant_id`               | P2   | F7 (migración; hoy no afecta con 1 cliente)  |
| Un contacto sin nombre tumba el lote de GHL  | P2   | F1 (la ingesta de GHL se rehace ahí)         |
| Subcuentas sin credenciales marcadas "error" | P3   | F2 (estado `omitida`)                        |
| Timeouts mal medidos y sin fila              | P3   | F2                                           |
| Historial de migraciones desalineado         | P3   | Reparación con respaldo, como el 13-sep      |
| Calendly a 46 s de 60                        | P3   | F2 (ventana y paginación)                    |
| Token de Instagram caducado                  | P1   | **Alex** (reconectar)                        |
| Cuenta publicitaria de Meta no reconocida    | P1   | **Alex** (reconectar; ya estaba en la lista) |

## 5. Arreglos hechos en S0.7

- **Calendly usa el secreto de su subcuenta** (con respaldo a la variable global), igual que GHL.
- **Apify cierra por defecto**: sin secreto configurado, rechaza.

Ambos con test. El resto queda anotado arriba con su fase: S0.7 es un baseline, no una reforma.
