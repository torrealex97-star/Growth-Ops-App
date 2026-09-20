# S0.2 — Journeys críticos

Fase activa: **S0 tramo 1**. Ver `docs/00-CONSTITUCION.md` §5 y `docs/S0-1-INVENTARIO-CAPACIDADES.md`.
Código auditado: `origin/main` en `06d1b5b` (PR #95). Fecha: 2026-09-20. Método: `INSPECTED`.

Un journey es crítico si al romperse se pierde dinero, se pierde un dato irreconstruible, o se rompe
el aislamiento entre tenants. Estos cuatro concentran el volumen real de producción y son los que
S0.3 debe congelar con tests antes de que F1 toque el event core.

---

## J1 — Webhook GHL → contacto → cita

**Crítico porque** es la única entrada automática de personas. Si se rompe, se pierden leads y
agendas sin rastro: no hay capa raw que permita reprocesar.

**Volumen**: 972 contactos, 559 citas.
**Traza**: `POST /api/[tenant]/evergreen/webhooks/ghl` — 482 líneas.

| Paso | Qué hace                                                                                        | Tabla                                 |
| ---- | ----------------------------------------------------------------------------------------------- | ------------------------------------- |
| 0    | Valida `x-ghl-secret` contra `GHL_WEBHOOK_SECRET`, fail-closed                                  | —                                     |
| 1    | Normaliza el payload: aplana `contact`, `appointment`, `full_contact`; `customData` sobrescribe | —                                     |
| 2    | Resuelve tenant por slug de la ruta, exigiendo `status = 'active'`                              | `tenants`                             |
| 3    | Resuelve contacto: `ghl_contact_id` → `email` → `phone`; si no existe, lo crea                  | `contacts`                            |
| 4    | Vuelca la cualificación del formulario                                                          | `qualification_questions`, `contacts` |
| 5    | Escribe atribución **solo si llegan UTMs o `source`**                                           | `contact_attributions`                |
| 6    | Upsert de la cita por `onConflict: 'tenant_id,external_id'`                                     | `appointments`                        |
| 7    | Marca `lead_status` y registra auditoría                                                        | `contacts`, `audit_logs`              |

**Aislamiento**: service role, sin sesión. El tenant sale del slug, nunca del body. Todas las
queries del cuerpo filtran por `tenant_id`.

**Idempotencia**: de efecto, sí. De datos, no — **el payload original no se conserva** (§4.1 de
S0.1). Es el núcleo de F1.

**Estado de la cualificación**: el `upsert` de `qualification_questions` es correcto en este código
(`{ tenant_id, slug }` con `onConflict: 'tenant_id,slug'` y el error registrado). Un bug anterior
que lo hacía fallar en silencio ya está corregido.

**Hueco de cobertura**: no existe ningún test que ejerza este webhook.

### Qué debe fijar el test golden (S0.3)

- Los tres formatos de payload (plano, `customData`, anidado) → el mismo contacto.
- Mismo `appointmentId` dos veces → **una** cita.
- Cambio de `status` → actualiza, no duplica.
- Sin `email`, `phone` ni `contactId` → 400.
- Secret ausente o incorrecto → 401. Tenant inexistente o inactivo → 404.
- Mismo email en dos tenants → **no** se cruzan.

---

## J2 — Cobro → comisión

**Crítico porque** es el journey del dinero: un error paga de más o de menos a una persona real.

**Volumen**: 28 ventas, 49 cobros, 49 comisiones.
**Traza**: `POST /api/[tenant]/evergreen/collections/record` (177 líneas) →
`lib/commissions/generate.ts` → `calculator.ts`, `attribution.ts`, `tramos.ts`.

Lo que hace bien, y conviene no romper en F5:

- `requireTenant()` en la primera línea útil, y comprobación de rol (403 si no procede).
- Valida que `commissionableAmount` sea coherente y no supere el importe cobrado.
- Referencia de pago **única por subcuenta**, con mensaje de error que distingue "mismo pago ya
  registrado" de "pago distinto con la misma referencia".
- Ruta de revisión aparte (`approve-review`) para el plan `custom`, donde solo el primer cobro
  comisiona al instante.
- Auditoría explícita al cerrar.

### Hallazgo (P2) — no hay frontera transaccional

El cobro se inserta (línea 99) y las comisiones se generan después (línea 139), como sentencias
independientes. Si la generación falla, **el cobro ya está insertado** y queda sin comisión. El
error sube como 500, así que no es silencioso, pero el estado parcial persiste y nada lo reconcilia.

Es menos grave de lo que parece porque todo ocurre dentro de una petición de servidor y hay
auditoría, pero para F5 (commands con idempotencia y estados) hace falta o una RPC transaccional o
una marca de estado en `collections` que permita reintentar.

### Hallazgo (P1) — el porcentaje vive en el código

`generate.ts:103`: `const percent = rule?.percent ?? (role === 'setter' ? 5 : 10)`.
Con `commission_rules` = 0, las 49 comisiones salieron de ese respaldo. Detalle completo en §4.2 de
S0.1. **Va a F3 y `MONEY.md`, no se parchea ahora.**

### Qué debe fijar el test golden

`tests/metrics/` ya cubre la aritmética (base neta de pasarela, PnL, unit economics, tramos). Falta:

- Fallo en la generación de comisiones → el cobro no debe quedar huérfano y sin señal.
- `commission_rules` vacío → documentar que aplica el 5/10 de respaldo (fijar el comportamiento
  actual **antes** de que F3 lo sustituya).

---

## J3 — Sync Meta → `campaign_daily` → dashboard

**Crítico porque** es el único dato de coste publicitario: sin él no hay CAC, ni unit economics, ni
cuello de botella con impacto en €.

**Volumen**: 1793 filas en `campaign_daily`, 350 anuncios, 171 campañas. La tabla de más volumen.
**Traza**: `cron/meta-daily`, `cron/meta`, `cron/meta-ads`, con `Bearer CRON_SECRET` fail-closed.

- No usan `requireTenant` (correcto: no hay sesión). Iteran los tenants activos explícitamente,
  porque Vercel Cron pega a una URL estática y el segmento de tenant es un relleno.
- Estos tres se programan por **pg_cron**, no por `vercel.json`.
- Upsert diario por campaña. No conserva la respuesta cruda de Meta: mismo hueco de replay que J1,
  y es lo que F2 debe resolver con el contrato de conector.

**Bloqueo operativo abierto**: el token de Meta de WDC devuelve `(#10) Application does not have
permission for this action`. Es reconexión de credenciales, no código.

### Qué debe fijar el test golden

- Sin `CRON_SECRET` o con Bearer incorrecto → 401.
- Dos pasadas el mismo día → una fila por campaña y día.
- Un tenant sin credenciales no aborta la pasada de los demás.
- El gasto de un tenant nunca aparece en el `campaign_daily` de otro.

---

## J4 — Login y resolución de tenant

**Crítico porque** es la frontera del sistema.

**Traza**: `middleware.ts` → `lib/supabase/middleware.ts` (`updateSession`) → `app/[tenant]/layout.tsx`
(cliente) → `lib/auth/requireTenant.ts` (API).

| Capa                      | Qué comprueba                                                                            | ¿Frontera de seguridad? |
| ------------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| `middleware.ts`           | Que la ruta no sea pública                                                               | No                      |
| `updateSession`           | Que **exista sesión**. No comprueba pertenencia al tenant — su propio comentario lo dice | **No**                  |
| `app/[tenant]/layout.tsx` | Pertenencia, rol y contrato firmado, pero es `'use client'`                              | No: es UX               |
| RLS                       | Política restrictiva `*_tenant_isolation` sobre el cliente del navegador                 | **Sí**                  |
| `requireTenant()`         | Sesión + `tenant_members` o `is_super_admin`, en **149 de 168** rutas                    | **Sí**                  |

**Consecuencia, dicha con precisión**: un usuario del tenant A que escriba `/tenantB/dashboard` pasa
el middleware y renderiza el shell. **No ve datos de B**: las consultas del navegador van con su JWT
y RLS las corta; las de API mueren en `requireTenant` con 403. El gate del layout se lo dirá después,
ya en cliente.

La defensa es real, pero **no hay defensa en profundidad en el borde**. `updateSession` sí mejoró en
un punto relacionado: las rutas de API sin sesión devuelven 401 JSON en vez de redirigir al HTML del
login, que confundía a los clientes.

Hay cobertura relevante ya escrita: `tenant-isolation`, `tenant-no-enumeration`, `rol-por-tenant`,
`tenant-archivado`, `tenant-root-redirect`, `fase3-tenant-queries`.

### Deuda relacionada (P3)

Las 168 rutas viven bajo `/api/[tenant]/evergreen/...`. El segmento `evergreen` es literal y fijo
para todos los tenants: el nombre del primer cliente incrustado en toda la API. Choca con "Config,
not code". Conviene renombrarlo antes de F8 (segundo tenant real), no ahora.

---

## Resumen

| #   | Hallazgo                                                               | Prioridad | Journey | Destino                             |
| --- | ---------------------------------------------------------------------- | --------- | ------- | ----------------------------------- |
| 1   | El webhook de GHL no escribe capa raw: no hay replay                   | P1        | J1      | **F1**                              |
| 2   | Ningún test ejerce el webhook de GHL                                   | P2        | J1      | **S0.3**                            |
| 3   | El porcentaje de comisión está en el código, no en configuración       | P1        | J2      | **F3 / MONEY.md**                   |
| 4   | Cobro y comisión sin frontera transaccional                            | P2        | J2      | **F5**                              |
| 5   | `contact_attributions` vacía: GHL no envía UTMs                        | P1        | J1      | **Bloqueo de Alex** (config de GHL) |
| 6   | Token de Meta de WDC sin permisos                                      | P2        | J3      | **Bloqueo de Alex** (reconexión)    |
| 7   | El borde no comprueba pertenencia; la defensa es RLS + `requireTenant` | P2        | J4      | **F-1**                             |
| 8   | `evergreen` incrustado en las 168 rutas                                | P3        | J4      | Antes de **F8**                     |

Ninguno se toca en S0.2. S0.3 escribe los tests que faltan; el resto va a su fase.
