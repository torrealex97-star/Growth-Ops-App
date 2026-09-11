# Auditoría Growth-Ops-App — Fase 1 (Read-only)

Fecha: 2026-09-11
Alcance: producto, arquitectura, datos, permisos, seguridad, duplicación, código muerto.
Método: 5 agentes de exploración en paralelo, solo lectura, sin modificar código ni base de datos.

---

## 1. Mapa del producto

La app es un **ERP/CRM interno para un negocio de educación online** ("Growth Ops" / iawinners-os), con dos sistemas coexistiendo:

### Sistema actual: "Evergreen" (`app/evergreen/*`, ~50 módulos)
Supabase Auth + RBAC real. Módulos: dashboard, leads, contactos, citas, ventas, reservas, pagos, pipeline, comisiones, targets, KPI, contratos, campañas, atribución, data-health, contenido, carruseles, Instagram/YouTube/Meta analytics, alumnos, CSM, bajas, finanzas, proyección, gastos, facturas, gestoría, afiliados, morosidad (incl. Sequra), reembolsos, auditoría, ajustes admin.

Roles: `admin, director, manager` (liderazgo sin restricción), `setter, closer, triager, cold_caller, affiliate, marketing, adscripcion, editor, csm, cobros, gestoria`.

Bug menor encontrado: el nav incluye un enlace a `/evergreen/retention` que **no existe** (404 para csm/liderazgo).

### Sistema legacy: "Lanzamiento / Cold Calling / Closer Club" (~1.450 líneas)
`app/dashboard`, `app/lanzamiento`, `app/coldcalling`, `app/admin/coldcalling`, `app/sorteo` + sus APIs. Corre sobre **Google Sheets** y **Postgres crudo** (no Supabase), con su propio modelo de datos (`Lead` en español: `nombre`, `telefono`, `q0Edad`...) totalmente desconectado del modelo evergreen. Sigue activo (importado y con rutas vivas), no es código muerto, pero es una segunda arquitectura completa mantenida en paralelo.

`/sorteo` sí parece un experimento aislado sin ningún enlace de navegación.

### Worker externo
`worker/index.mjs` — proceso Node standalone (fuera de Vercel) que transcribe llamadas (Drive → ffmpeg → Groq Whisper → Claude → Supabase). **Nunca desplegado a producción** según `ESTADO-ACTUAL.md` — la generación automática de tareas está desactivada.

---

## 2. Mapa de arquitectura

```
Browser
 ├─ 58/74 páginas evergreen → Supabase DIRECTO desde cliente (anon key, RLS como única barrera)
 └─ 34/74 páginas → fetch a /api/evergreen/* (para escrituras con service role)

app/api/**/route.ts (capa de mutación)
 └─ cada ruta re-instancia su propio cliente service-role (~90 veces copiado, sin helper compartido)

middleware.ts
 ├─ /evergreen* → refresco de sesión Supabase (solo comprueba "hay sesión", NO rol)
 ├─ /coldcalling* → cookie HMAC propia
 └─ resto → cookie booleana simple (tcc-auth), sin firma ni expiración

lib/ (~30 carpetas) — capa de servicio real y bien factorizada (no hay wrappers vacíos)

worker/ — proceso aparte, mismo Supabase, nunca desplegado

Vercel Cron — solo 3 de 8 rutas cron están registradas en vercel.json
```

**Hallazgo clave:** no existe ni un solo Server Action (`'use server'` → 0 resultados). La autorización real de "quién ve qué" vive en las políticas RLS de PostgreSQL, no en el código TypeScript — cualquier revisión de permisos tiene que leer SQL, no la app.

---

## 3. Fuentes de verdad

- `contacts` sirve correctamente como única tabla para leads y alumnos (buen diseño).
- Rol/identidad: correcto en `public.users` + `public.roles`, aunque 6 rutas también tocan `auth.admin`/`user_metadata` (solo para invitar/resetear password, no para autorizar — verificado, no es un problema real).
- Estado de pago/cobro vive en 3 tablas que deben mantenerse sincronizadas a mano (`sales.status`, `sale_expected_installments.status`, `collections.status`) sin ningún trigger de consistencia.
- Hay **dos modelos de "Lead" completamente distintos**: el legacy (español, Sheets) y el evergreen (`contacts` en Supabase) — no se pisan, pero duplican el concepto.
- Tres implementaciones independientes de normalización de teléfono (`lib/phone.ts`, `lib/db-lanzamiento.ts`, `lib/sync-sales-sheet.ts`) con lógica distinta — riesgo real de contactos duplicados.
- Lógica de "buscar o crear contacto" reimplementada 3 veces (webhook GHL, webhook Calendly, creación manual) sin helper compartido.

---

## 4. Mapa de permisos (ROLE × AREA)

| Área | Quién (intención) | Aplicado realmente por |
|---|---|---|
| `/admin`, `/dashboard` (legacy) | Cualquiera con la contraseña compartida | cookie booleana, sin identidad por usuario |
| `/coldcalling` | admin o sesión HMAC de cold-caller | middleware |
| `/lanzamiento` | público (por diseño) | ninguno |
| `/firmar[-alumno]/[token]` | quien tenga el token | lookup server-side del token |
| `/evergreen/*` | según `ROLE_ALLOWED_PREFIXES` por rol | **middleware solo verifica que exista sesión Supabase — el filtrado por rol/departamento es SOLO client-side** (`app/evergreen/layout.tsx`, `"use client"`) |

La red de seguridad real debería estar en las políticas RLS de Postgres. Y ahí es donde aparece el problema más grave (ver P0 abajo).

---

## 5. Operaciones que deberían ser transaccionales

No existe ninguna función `plpgsql`/RPC para lógica de negocio multi-tabla — todo se hace con llamadas secuenciales desde TypeScript, sin `BEGIN/COMMIT`:

- `lib/commissions/generate.ts::reconcileSaleCommissions` — borra comisiones existentes y luego inserta las nuevas en dos pasos separados. Un fallo entre medias deja la venta **sin comisiones** hasta el próximo re-run. (Mitigado parcialmente: es idempotente y hay un endpoint de reparación masiva, pero el problema de fondo sigue sin transacción real.)
- `generateCommissionsForCollection` → inserta comisiones y luego, en otra llamada, recalcula tramos — mismo patrón de riesgo.
- El flujo de marcar pago (`payments/mark/route.ts`) hace lectura→lectura→insert sin atomicidad.

**Recomendación:** mover esta lógica a una función Postgres invocada por RPC para que corra en una sola transacción.

---

## 6. Problemas de concurrencia

- Patrón correcto encontrado: `lib/sequra/syncDelinquents.ts` usa `upsert` con `onConflict` sobre una columna `UNIQUE` real.
- **Patrón de riesgo real:** `payments/mark/route.ts` documenta explícitamente un bug de doble cobro ya arreglado una vez ("Evita el doble cobro por doble clic"), pero el arreglo es un `SELECT` de comprobación antes del `INSERT`, sin `UNIQUE` constraint ni `SELECT ... FOR UPDATE` de respaldo. Dos requests casi simultáneas (doble clic, webhook reintentado) pueden volver a duplicar el cobro.
- La tabla `commissions` no tiene ninguna restricción de unicidad — solo el borrado-e-inserción de `reconcileSaleCommissions` evita duplicados; dos llamadas concurrentes para la misma venta pueden generar comisiones duplicadas.
- El pipeline nuevo de tracking (`canonical_events`, `delivery_attempts`) sí hace esto bien, con claves de idempotencia reales.

---

## 7. Duplicaciones encontradas

1. Lógica de "buscar o crear contacto": 3 implementaciones independientes (GHL webhook, Calendly webhook, creación manual).
2. Normalización de teléfono: 3 implementaciones independientes con lógica distinta.
3. Tipos `Contact`/`Contract` redeclarados localmente en un par de páginas en vez de importar el tipo canónico (bajo riesgo).
4. Dos flujos de firma de contrato paralelos (`/firmar` para equipo, `/firmar-alumno` para alumnos) sobre las mismas tablas — inconsistencia de nombres/arquitectura, no necesariamente un bug.
5. Stack legacy completo (Sheets + Postgres crudo) corriendo junto al stack evergreen (Supabase) — la duplicación arquitectónica más grande del proyecto.
6. Dos despliegues de marca (IA WINNERS y The Closer Club) mantenidos copiando archivos y re-aplicando migraciones a mano por feature — sin límite de paquete/módulo compartido, riesgo estructural de divergencia.

Formateo de fecha/moneda: **correctamente centralizado**, sin duplicación (una sola implementación cada uno).

---

## 8. Complejidad innecesaria / código potencialmente muerto

- `/evergreen/retention`: enlace roto en el nav (404).
- `/sorteo`: experimento aislado, sin enlaces de navegación — candidato a `LIKELY_DEAD`.
- `/dashboard`, `/admin/coldcalling`, `/api/data`, `/api/chat` (dashboard legacy sobre Sheets): huérfanos desde que `/` redirige directo a `/evergreen/dashboard` — solo alcanzables si alguien conoce la URL antigua. Clasificación: `UNKNOWN` (no confirmado si el negocio aún los usa).
- 66 scripts SQL sueltos en `scripts/` (`migration-v3` a `v66+`), aplicados a mano sin tabla de tracking — ya están siendo reemplazados por `supabase/migrations/` (3 archivos recientes, 2026-09-10/11), pero los 66 antiguos siguen presentes sin marcar como históricos.
- Existen **dos carpetas de "migrations"** (`migrations/` en la raíz y `supabase/migrations/`) con contenido solapado — sin una única línea histórica.
- `supabase-schema.sql` (raíz) es un **snapshot obsoleto y peligroso**: solo cubre 18 de las 68 tablas reales, y conserva un bloque `DROP TABLE ... CASCADE` — si alguien lo ejecuta contra producción por error, borra datos.
- 5-6 rutas cron existen en código pero no están en `vercel.json` — activas vía `pg_cron` según comentarios, pero invisibles para cualquiera que solo audite `vercel.json`.
- Sin TODOs/FIXMEs reales en el código (los 14 hits eran falsos positivos del español "todo") — el backlog vive solo en los `.md`, con riesgo de que se desactualicen.
- 66 usos de `any` bajo `strict: true` — deliberados pero sin clasificar cuáles son justificables (payloads externos) vs cuáles son atajos evitables.

**No hay CI/CD real**: el único workflow de GitHub Actions es manual (`workflow_dispatch`), sin lint/typecheck/test/build automático antes de desplegar. No existe ningún test en el repo.

---

## 9. Problemas de rendimiento

- Las tablas transaccionales centrales (`sales`, `collections`, `commissions`, `appointments`, `sale_expected_installments`, `contact_attributions`, `refunds`) **no tienen ningún índice más allá de la primary key**, pese a filtrarse constantemente por esas FKs en el código. Las tablas añadidas más tarde sí tienen índices — el equipo aprendió la lección a mitad de camino pero nunca hizo backfill en las tablas originales.
- Patrón dominante de "cliente pide directo a Supabase" en 58/74 páginas — sin capa de agregación server-side, cada página dispara sus propias queries (no cuantificado en detalle en esta fase, pero es el patrón típico de N+1/waterfalls en el navegador).

---

## 10. Problemas de seguridad — el hallazgo más importante de la auditoría

### P0 — Fuga de datos de toda la empresa a cualquier usuario autenticado

Las políticas RLS de `sales`, `contacts`, `collections` y `contact_attributions` dicen `USING (get_my_role() IS NOT NULL)` — es decir, **cualquier usuario autenticado, incluido el rol más bajo (afiliado, cold caller, csm, gestoría)**, puede abrir la consola del navegador y ejecutar `supabase.from('sales').select('*')` para descargar **todas** las ventas, todos los contactos (PII: nombre, email, teléfono) y todos los cobros de la empresa — saltándose por completo el filtrado de rol que la UI aplica solo visualmente. `app/evergreen/afiliados/page.tsx` es un ejemplo concreto: pide todos los datos y filtra solo en el cliente.

Por contraste, `commissions` sí está bien scoped (`user_id = auth.uid()`).

### P0 — Fuga de PII sin autenticación
`app/api/evergreen/documents/state/route.ts` — con solo un `saleId` en la URL, devuelve el **número de documento de identidad** y estado de verificación, sin ningún chequeo de sesión, usando el cliente service-role (bypassa RLS).

### P0 — Tablas sin RLS consultadas directo desde el cliente
`fb_media`, `ig_competitors`, `ig_competitor_media`, `positive_notes` — RLS nunca activado, y las tres primeras se consultan directamente desde componentes cliente con la anon key. Es un olvido de copiar/pegar: la migración que activó RLS en 5 tablas de Instagram similares se olvidó de estas 4.

### P1
- `app/api/evergreen/documents/verify/route.ts` — sin auth, permite subir/insertar "documentos verificados" en cualquier venta.
- `app/api/evergreen/vsl/videos/route.ts` — sin auth, permite crear/editar/**borrar** cualquier vídeo VSL.
- `supabase-schema.sql` es un snapshot peligroso y desactualizado (ver arriba).
- Comisiones/reconciliación sin transacción real (ver §5).

### P2
- Secretos con fallback hardcodeado: `DASHBOARD_PASSWORD` cae a `'closerclub2026'` si la env var no está seteada; `CC_SESSION_SECRET` cae a `'cc-secret-fallback-2026'` — ambos fallan "abierto" en vez de fallar cerrado.
- Minting de tokens de subida a Vercel Blob sin auth (`vsl/upload/route.ts`) — riesgo de abuso/coste, no de datos.
- Falta índice único de respaldo en `collections` para el guard anti-doble-cobro (TOCTOU).
- Secretos (Anthropic, Groq, token de gestión de Supabase, secreto de webhook GHL) fueron compartidos por chat según `PENDIENTES.md` y nunca rotados.
- `vsl_sessions` permite recolectar emails de leads vía anon key sin restricción de lectura.

### P3
- Tokens de firma de contrato sin expiración ni revocación (aunque tienen 192 bits de entropía, no son adivinables).
- Sin rate limiting en ningún endpoint del repo.

---

## 11. Priorización P0–P3 (consolidada)

**P0 — riesgo de fuga de datos / seguridad, arreglar primero**
1. RLS de `sales`/`contacts`/`collections`/`contact_attributions` — cualquier empleado autenticado puede volcar toda la empresa.
2. `documents/state` sin auth — filtra números de documento de identidad.
3. RLS ausente en `fb_media`, `ig_competitors`, `ig_competitor_media`, `positive_notes`.

**P1 — funcionalidad rota / arquitectura crítica**
4. `documents/verify` sin auth (bypass service-role).
5. `vsl/videos` sin auth (permite borrar vídeos).
6. `supabase-schema.sql` obsoleto y peligroso (contiene DROP CASCADE).
7. Comisiones/reconciliación sin transacción atómica.
8. Enlace roto `/evergreen/retention` en el nav.

**P2 — rendimiento / fiabilidad / mantenibilidad**
9. Falta de índices en tablas transaccionales core.
10. Guard anti-doble-cobro sin UNIQUE constraint de respaldo.
11. Secretos con fallback hardcodeado (fail-open).
12. Secretos compartidos por chat sin rotar.
13. Sin CI (lint/typecheck/build/test) antes de desplegar.
14. `vsl/upload` sin auth (abuso de coste).
15. Bug de doble conteo de cash de Sequra (parcialmente arreglado, según CHANGELOG/PENDIENTES).

**P3 — simplificación**
16. Unificar las 3 implementaciones de normalización de teléfono y de "buscar o crear contacto".
17. Consolidar las dos carpetas de migraciones y retirar los 66 scripts SQL sueltos ya superados.
18. Decisión de producto: archivar o mantener el stack legacy (lanzamiento/coldcalling/sorteo/dashboard).
19. Tokens de firma sin expiración.
20. Limpieza de tipos duplicados (`Contact`, `Contract` redeclarados localmente).

---

## 12. Plan de reparación propuesto

Dado que esto es una app en producción con datos reales de un negocio, **antes de tocar nada** propongo este orden, con tu confirmación explícita antes de cada lote porque incluye cambios de RLS/seguridad en la base de datos de producción:

1. **Lote P0 (seguridad crítica, esta semana):** corregir las 4 políticas RLS de sales/contacts/collections/contact_attributions para que scopeen por rol/ownership real; activar RLS en las 4 tablas sin protección; añadir auth check a `documents/state`. Esto se hace con una migración SQL nueva en `supabase/migrations/`, revisable antes de aplicar.
2. **Lote P1:** añadir auth a `documents/verify` y `vsl/videos`; marcar/eliminar `supabase-schema.sql` obsoleto; arreglar el enlace `/evergreen/retention`.
3. **Lote P2:** índices en tablas core; UNIQUE constraint de respaldo en `collections`; quitar fallbacks de secretos hardcodeados (fail-closed); pipeline de CI mínimo (lint+typecheck+build en cada PR).
4. **Lote P3:** unificar duplicaciones, decisión sobre el stack legacy, limpieza de migraciones sueltas.

Cada lote se valida con `next lint`, `tsc --noEmit` y `next build` antes de darlo por cerrado (no hay tests automatizados que correr todavía).

**Necesito tu confirmación antes de aplicar cualquier cambio de RLS o migración sobre la base de datos de producción.** ¿Empiezo por el Lote P0?
