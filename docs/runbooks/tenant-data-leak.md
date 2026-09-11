# Runbook: posible fuga de datos Evergreen ↔ WDC

Trátalo como SEV0 hasta que se demuestre lo contrario. No borres nada mientras investigas — la evidencia de cómo
ocurrió es más valiosa que limpiar rápido.

## 1. Contener el acceso
- Si el vector es una sesión de usuario concreta con acceso indebido: revocar su sesión (Supabase Auth → invalidar
  refresh tokens del usuario) y desactivarlo (`users.is_active = false`) mientras se investiga.
- Si el vector es un endpoint concreto (no una sesión): el equivalente a un kill-switch hoy es desplegar un revert
  rápido de esa ruta (no hay feature flag genérico — ver `docs/PRODUCTION_READINESS.md`, sección Deployment Safety).

## 2. Preservar evidencia
- NO borres las filas afectadas todavía. Copia (no muevas) los IDs/registros implicados a un sitio aparte si hace
  falta liberar el estado "sucio", pero conserva el original para la investigación.
- Guarda los logs de Vercel del momento del incidente (se rotan) antes de que expiren.

## 3. Identificar el alcance
- ¿Qué tenant vio datos de qué otro tenant? ¿Qué tablas? ¿Cuántas filas, durante cuánto tiempo?
- Revisa si el vector fue: (a) una política RLS mal aplicada — ver el array `DO $$ FOREACH` de
  `supabase/migrations/20260911150000_multi_tenant_domain_tables.sql`, ¿la tabla afectada está en esa lista? (b) un
  endpoint service-role sin `requireTenant()`; (c) un bug de filtrado client-side que confiaba en el servidor para
  aislar y no lo hacía.

## 4. Corregir RLS/auth
- Si es (a): añadir la tabla a la política RESTRICTIVE con una migración nueva (mismo patrón que
  `20260911170000_tenant_scope_singleton_constraints.sql`), no editar la migración histórica.
- Si es (b): añadir `requireTenant()` + filtro `.eq('tenant_id', ...)` explícito, siguiendo el patrón ya usado en
  el resto de `app/api/[tenant]/evergreen/**` (ver `lib/auth/requireTenant.ts`).

## 5. Invalidar caché si aplica
Hoy no hay caché de datos entre tenants (todo es query directa) — este paso es NOT APPLICABLE mientras siga siendo
así. Si en el futuro se añade caché compartida, esta sección debe ampliarse ANTES de desplegarla.

## 6. Verificar otros recursos
No asumas que el vector encontrado es el único. Revisa Storage (¿algún bucket sin `tenant_id` en el path?) y
cualquier endpoint hermano al afectado que siga el mismo patrón de código.

## 7. Ejecutar tests cross-tenant
Antes de cerrar el incidente, confirma explícitamente (con una query real, no solo "ya no debería pasar"):
```
EVERGREEN_USER + WDC_RESOURCE_ID → DENIED
WDC_USER + EVERGREEN_RESOURCE_ID → DENIED
```
para el recurso concreto afectado. Si no existe ya un test automatizado para esto (hoy no existe — ver `Testing:
22/100` en `docs/PRODUCTION_READINESS.md`), añádelo como parte del cierre del incidente, no lo dejes para "después".

## Postmortem obligatorio
Este runbook siempre termina en postmortem (es SEV0 por definición) — qué se filtró, a quién, cuánto tiempo estuvo
expuesto, y qué constraint/test lo habría evitado desde el principio.
