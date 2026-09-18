# Source of Truth & Nomenclatura canónica — Dashboard global

> **Regla viva del proyecto:** si una métrica recibe dos nombres distintos (p. ej. "Facturación bruta" y
> "Revenue Closed", o "Asistencias" y "Shows"), son LA MISMA métrica con etiquetas diferentes. El estándar
> es UN nombre canónico por métrica (ver glosario). Si una pantalla o el usuario usa otro nombre, hay que
> **preguntar antes de fusionar** — nunca asumir. Esta regla aplica también al agente de IA de la app.

## 1. Principio

Cada métrica declara en `lib/sources/registry.ts`:

| Campo | Significado |
|---|---|
| `primary` | Fuente con autoridad. Si tiene dato, ES el número. |
| `fallbacks` | Orden de respaldo cuando la primaria no tiene dato. |
| `dedupKey` | Claves que identifican EL MISMO evento entre fuentes (no se suman nunca). |
| `manualOverride` | Si un humano puede corregirla (con auditoría de actor/timestamp/old/new/reason). |
| `what` / `formula` | Texto del tooltip de fuente en la UI (§37). |

**Nunca se suman dos fuentes que pueden representar el mismo evento.** Si la primaria no tiene dato,
entra el fallback en orden; si dos fuentes discrepan, gana la prioridad y el conflicto se registra
(`resolveByPriority` → `conflicted: true`), nunca se resuelve en silencio.

## 2. Registro por métrica (resumen; la fuente de verdad ejecutable es el registro TS)

| Métrica (nombre canónico) | Primary | Fallbacks | Dedup key |
|---|---|---|---|
| **Cash Collected** | Stripe | Banco › Pagos internos › Manual | payment_id / transaction_id / cliente+importe+timestamp |
| **Revenue Closed** | Ventas internas | CRM Closed Won › Producto×precio › Manual | sale_id / opportunity_id / lead+fecha+importe |
| **New Unique Leads** | CRM | Typeform › Native Forms › Calendly › G. Calendar | email › teléfono › external_contact_id |
| **Form Submissions** | Typeform | Native Forms | form_submission_id |
| **Booked Appointments** | Calendly | G. Calendar › CRM | calendly_event_id / calendar_event_id / contacto+fecha |
| **Shows** | CRM | Confirmación manual | appointment_id |
| **Sales** | Ventas internas | CRM › Manual | sale_id / opportunity_id |
| **Tráfico (Meta)** | Meta Ads | — | campaign_id+date |
| **Comportamiento onsite** | First-party | GA4 | session_id / anonymous_id |
| **Colaboradores** | CRM collaborator_id | Módulo afiliados (relacionado, no duplicado) | collaborator_id / affiliate_id |

### Equivalencias de nomenclatura VIGENTES en la app (mismos conceptos, etiquetas históricas)

- **Revenue Closed ≡ Facturación ≡ Facturación cerrada** — SUM(actual_sale_price) de ventas activas.
- **Shows ≡ Asistencias** — `appointments.status IN ('show','completed')`, o (KPI operativo) citas vivas ya pasadas.
- **New Unique Leads ≡ Leads** — contactos canónicos únicos.
- **Booked Appointments ≡ Agendas ≡ Citas agendadas**.

## 3. Entidades canónicas (§17)

`lib/canonical/dedup.ts` — funciones puras, testeables:

- `canonicalizeLeads` — email › teléfono › external_id. Sin evidencia NO se fusiona nadie.
- `canonicalizeAppointments` — mismo evento en Calendly+Google+CRM = UNA cita.
- `dedupeSales` — misma venta en dos sistemas = UNA (opportunity_id o contacto+fecha+importe).
- `canonicalizePayments` — solo `collected` es cash; mismo pago en Stripe y banco cuenta UNA vez.
- `coveragePct` — atribución cubierta / total (leads, ventas, revenue).

## 4. Confianza (§20)

- **HIGH**: match por ID exacto o email; Stripe payment confirmed; Calendly casado con lead conocido.
- **MEDIUM**: match por teléfono o ID externo.
- **LOW**: origen inferido (UTM sin contacto que casar).

## 5. Data Quality (§38) — panel en Métricas y KPIs

Contadores vivos: leads/agendas/ventas/pagos duplicados, ventas sin producto, agendas sin lead,
pagos sin venta, leads y ventas sin atribuir, cobertura de atribución (leads/ventas/revenue).

## 6. Reglas del agente de IA (deterministas, en lib/ai/insights/detectors.ts)

1. **Asistencias sin marcar**: si hay ≥5 agendas pasadas aún en scheduled/confirmed/rescheduled,
   el agente lo PREGUNTA (insight `asistencias_sin_marcar`): probable subconteo de shows.
2. **Métricas anómalas** (ya existente): CAC +25%, ROAS −20%, show rate −15%, close rate −15%,
   ROAS +30% (oportunidad). Umbral primero, LLM solo para redactar.
3. **Nomenclatura**: si el usuario pregunta por una métrica con un nombre no canónico, el agente
   confirma la equivalencia con el glosario antes de responder (getMetricDefinition).

## 7. 0 ≠ "—" (§39)

`0` = confirmado cero. `—` = sin dato (fuente no conectada o métrica no medible). Stripe no conectado
→ Cash: `—`, nunca `0 €`.
