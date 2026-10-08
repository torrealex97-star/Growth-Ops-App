# Google Calendar por closer — auditoría y plan de conciliación

Fecha: 8-oct-2026. Estado: Fases 0–1 cerradas; Fase 2 implementada y migrada, pendiente de OAuth
real de un closer para verificar la ingesta contra Google. No confundir **INSPECTED/TESTED** con
**VERIFIED**.

## Impact map

**Directo:** OAuth Google, `google_oauth_connections`, selección de calendarios, CRM › Agendas.

**Indirecto:** usuarios y memberships, RLS multi-tenant, contactos, `appointments`, disponibilidad,
Data Health, `integration_sync_runs` y métricas de asistencia/venta. La Fase 1 no escribe en estas
últimas entidades.

Riesgo: **HIGH** (OAuth, credenciales, RLS, multi-tenant e identidad de citas).

## Estado real antes del cambio

| Componente | Estado | Evidencia |
| --- | --- | --- |
| Agenda comercial canónica | STABLE | `appointments`, aislada por `tenant_id` |
| Contacto/closer | STABLE | `contacts`, `users`, `tenant_members`, `appointments.closer_id` |
| Calendly/GHL | STABLE/PARTIAL | pull + webhooks sobre `appointments`; mapeo de dueño por email/calendario |
| OAuth Google | PARTIAL | state HMAC, refresh token cifrado; solo `ga4`/`gmail`, conexión de tenant |
| Google Calendar operativo | MISSING | sin scopes, CalendarList, events.list, syncToken ni watch |
| Dedupe de agendas | PARTIAL | `(tenant_id, external_id)` + helper por ID/contacto+minuto; sin iCal UID/recurrencia |
| Conciliación Calendar↔CRM | MISSING | no existía inventario externo ni estados de reconciliación |
| Logs de sync | STABLE | `integration_sync_runs`, todavía sin job Calendar |

## Decisiones de arquitectura

1. `appointments` sigue siendo la única agenda comercial y la única fuente de KPIs.
2. La conexión Calendar pertenece a `(tenant_id, owner_user_id, provider)`. GA4/Gmail conservan
   una conexión por tenant.
3. El MVP es solo lectura. Escribir eventos requerirá autorización incremental y un interruptor
   explícito posterior.
4. Un calendario de conflicto bloquea disponibilidad, pero jamás crea contacto, agenda o KPI.
5. Un evento externo solo podrá enlazarse automáticamente con evidencia fuerte. Los candidatos
   ambiguos irán a conciliación manual.
6. El callback está ligado a la sesión y al `user_id` firmado; un closer nunca gestiona otra cuenta.

## Referencias oficiales y patrón adoptado

- Google: [autorización y scopes](https://developers.google.com/workspace/calendar/api/auth),
  [sincronización incremental](https://developers.google.com/workspace/calendar/api/guides/sync) y
  [notificaciones push](https://developers.google.com/workspace/calendar/api/guides/push). Patrón:
  scopes mínimos, `nextSyncToken` solo al terminar la paginación, full resync ante token inválido y
  renovación solapada de canales porque las notificaciones no son garantía de entrega.
- HubSpot: [conexión de calendario](https://knowledge.hubspot.com/meetings-tool/use-meetings) y
  [calendar sync](https://knowledge.hubspot.com/integrations/use-hubspots-integration-with-google-calendar-or-outlook-calendar).
  Patrón adoptado: conexión individual y asociación con contactos existentes; no importar lo que no
  es actividad comercial demostrable.
- HighLevel: [linked/conflict calendars](https://help.gohighlevel.com/support/solutions/articles/155000002374).
  Patrón adoptado: un principal y varios calendarios de conflicto; el conflicto no crea contactos ni
  citas; write-back a un único destino.
- Close: [Meetings](https://help.close.com/feature-guide/meetings). Patrón adoptado: relacionar por
  email de invitado con contactos existentes, excluir dominios internos y mantener privacidad de
  eventos sin contacto comercial.

## Fases

1. **Conexión individual (implementada en código):** scopes read-only, state ligado a usuario,
   calendario principal/conflicto/read-only, reconexión y desconexión.
2. **Ingesta (implementada):** tabla de eventos externos no comerciales, initial sync paginado,
   `syncToken`, cancelaciones, recurrencia y job idempotente con `integration_sync_runs`. Rango
   inicial: 90 días atrás y 180 hacia delante. Los emails de asistentes solo se persisten como HMAC.
3. **Matching:** ID explícito > iCal UID > contacto invitado + franja/closer; reglas puras y
   explicables, sin match silencioso ambiguo.
4. **Conciliación:** GOOGLE_ONLY, CRM_ONLY, MATCHED, POSSIBLE_DUPLICATE, TIME/CLOSER/STATUS_MISMATCH,
   CONTACT_MISSING, IGNORED_PRIVATE y SYNC_ERROR.
5. **Producto/Health:** bandeja en Agendas, resumen de equipo para liderazgo, Action Center y Data
   Health; ningún evento externo cuenta hasta quedar enlazado a `appointments`.
6. **Write-back opcional:** autorización incremental, un solo calendario destino, IDs propios e
   idempotencia para evitar bucles con Calendly/GHL.
7. **Hardening:** renovación push, retry/backoff, rate limit, E2E, RLS ORG_A/ORG_B y runbook.

## Acción humana pendiente

1. En Google Cloud, activar Google Calendar API y registrar exactamente
   `https://app.scalixsystems.com/api/oauth/google/callback` en el cliente usado por
   `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
2. Cada closer autoriza su propia cuenta desde CRM › Agendas › Mi Google Calendar, selecciona al
   menos un calendario y pulsa **Sincronizar ahora**.

Las migraciones `20261008122259` y `20261008130000` están aplicadas, registradas y verificadas en
producción. A 8-oct todavía hay 0 cuentas Calendar autorizadas; por ello la ingesta real sigue
**INSPECTED + TESTED**, no **VERIFIED** contra datos de Google.
