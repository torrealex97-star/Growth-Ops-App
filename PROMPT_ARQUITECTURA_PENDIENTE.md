> **ACTUALIZACIÓN 2026-09-12 (Claude, sin acceso a Supabase/navegador en esta sesión):** en paralelo,
> Codex (con acceso real a Supabase/Vercel/GitHub) trabajó sobre esta misma rama y reporta que ya
> **aplicó y verificó en producción** la migración `20260912120000_carruseles_tenant_isolation.sql`
> (tuvo que crear primero las tablas `carrusel_projects/templates/brand`, que no existían) más los
> índices (`100000`) y constraints (`130000_amount_range_constraints`), y confirma ambos brandings
> (Evergreen/WDC) — 6/6 índices, 4/4 constraints, 6 políticas RLS, 12 permisos. **No puedo verificar
> esto yo mismo** (mi sesión sigue sin OAuth del MCP de Supabase) — antes de seguir, confirma con una
> query directa que sigue así (punto 1 más abajo, ahora como verificación, no como aplicación).
> Codex también abrió `PR #4` (`codex/qa-fixes`, sobre `main`, NO sobre esta rama) con un hallazgo
> **CRÍTICO real** que aquí NO se había detectado: la tabla `users` no tenía RLS por tenant — cualquier
> miembro podía leer usuarios de OTRAS subcuentas y, peor, auto-actualizar su propia fila (incluido
> el rol) sin ser admin. He portado esa migración a esta rama como
> `supabase/migrations/20260912140000_tenant_scope_users_rls.sql` (INSPECTED: coherente con el
> esquema de `tenant_members.role` ya existente; NOT VERIFIED contra la base real). Añádela al punto 1.
> El resto del contenido de `PR #4` (61 archivos: navegación de Alumnos, reconciliación Stripe/seQura,
> ESLint, etc.) NO se ha traído aquí — decide con Codex/el usuario si se fusiona por separado; su
> propio Quality Gate lo marcó `BLOCKED` (RLS sin validar en staging, sin E2E autenticado, 96 alertas
> de Dependabot sin revisar — 4 críticas, 44 altas). Trátalo como trabajo real pero no comprobado.

# Prompt: cierre de arquitectura/seguridad pendiente (Claude con control del ordenador)

Contexto: vengo de una sesión larga de Claude Code (sin acceso a Supabase/navegador) trabajando en
el repo Growth-Ops-App (Next.js + Supabase, multi-tenant: "evergreen" y "women-digital-closer").
Todo el código está en la rama `claude/app-continuation-lpbupf`, ya pusheada, con `npm run quality`
+ `npm run test:metrics` + `npx next build` en verde en cada commit. Tú SÍ tienes lo que esa sesión
no tenía: acceso real a Supabase (CLI/dashboard), un navegador para probar la app en vivo, y acceso
a GitHub/Vercel. Tu trabajo es cerrar exactamente lo que quedó pendiente por esa carencia — no
repitas el trabajo ya hecho, verifícalo y continúa desde ahí.

Antes de nada: haz `git log --oneline -15` y lee los últimos ~6 commits de esa rama para entender
qué se hizo. Lee también docs/METRICS.md y docs/PRODUCTION_READINESS.md.

## 1. Aplicar/verificar las migraciones pendientes (URGENTE)

Hay migraciones en `supabase/migrations/` con fecha 2026-09-12:
- `20260912100000_composite_perf_indexes.sql`
- `20260912110000_tenant_branding.sql`
- `20260912120000_carruseles_tenant_isolation.sql` ← sin esto, cualquier usuario autenticado de un
  tenant puede leer/editar/borrar los carruseles de Instagram del OTRO tenant cambiando un id en la
  URL. Código ya corregido (`lib/carruseles/store.ts` + ~15 rutas). Codex reporta haberla aplicado ya
  (tuvo que crear antes `carrusel_projects/templates/brand`, que no existían) — **VERIFICA, no
  reapliques a ciegas**: si ya existe, `supabase db push` debe ser un no-op idempotente.
- `20260912130000_amount_range_constraints.sql`
- `20260912140000_tenant_scope_users_rls.sql` ← **nueva, portada desde `PR #4` de Codex** (rama
  `codex/qa-fixes`, no aplicada aquí todavía por nadie según mi información): sin esto, cualquier
  miembro autenticado puede leer usuarios de OTRAS subcuentas y auto-modificar su propia fila
  (incluido el rol) sin ser admin. Verifica antes de aplicar que `tenant_members.role` tiene los
  valores que la función `auth_can_manage_user` espera (`'admin'`, `'super_admin'`).

Antes de aplicar la `120000`: verifica que las tablas `carrusel_projects`, `carrusel_templates` y
`carrusel_brand` existen de verdad en el proyecto real (no tienen ningún `CREATE TABLE` en el
repo — se crearon a mano en algún momento). Si no existen en algún entorno, esa migración fallará
ahí; créalas primero con el shape que usa `lib/carruseles/store.ts` antes de aplicarla.

Aplica con el flujo normal del proyecto (`supabase db push` o el pipeline que usen). Después,
verifica con una query directa que `carrusel_projects.tenant_id` existe y tiene la política RLS
`carrusel_projects_tenant_isolation`.

## 2. Verificar en vivo el fix de seguridad de Carruseles

Con dos usuarios de prueba (uno de cada tenant), confirma que:
- Un usuario de "women-digital-closer" ya NO puede ver/editar/borrar un carrusel de "evergreen"
  cambiando el id en la URL o llamando al endpoint directamente.
- El listado `GET /api/<tenant>/evergreen/carruseles` solo devuelve proyectos de ESE tenant.
Si algo falla, el código está en `lib/carruseles/store.ts` (commit `fdfbc66`).

## 3. Verificar visualmente el branding de WDC

Tras aplicar la migración `20260912110000`, abre la app como usuario de "women-digital-closer" y
confirma que: el sidebar muestra "WDC" con acento rosa (no "Scalix Systems" en azul), y que el
login/recover/carga también lo muestran. El mecanismo es `data-accent="pink"` en `<html>` +
variables CSS en `app/globals.css` — si el color no se ve bien, ajusta la rampa de 11 pasos ahí
(está calculada matemáticamente desde los tokens `pink-primary`/`pink-light` existentes, nunca se
vio renderizada).

## 4. Bucket `contratos` público con PII (P1 sin resolver — necesita tu decisión, no solo tu acceso)

El bucket `contratos` es público y sirve URLs permanentes de contratos firmados (con DNI, dirección,
firma) sin expiración. El fix técnico es el mismo patrón ya aplicado a `pagos`
(`sales/payment-proof-url/route.ts`, commit anterior a esta rama): bucket privado + signed URL
fresca por request, en vez de una URL horneada en la DB.

El obstáculo real: el campo `contracts.url` se usa a la vez como (a) enlace externo que un admin
escribe a mano en `contratos/page.tsx` para contratos "kind=venta", y (b) el mismo campo que
rellena nuestro propio flujo de firma (`contracts/sign/[token]/route.ts` y `sign-student/[token]`)
con la URL pública del PDF que genera el sistema. Antes de tocar el storage, decide: ¿separamos
esos dos usos en columnas distintas (ej. `contracts.external_url` vs `contracts.signed_pdf_path`),
o hay otra forma más simple? Una vez decidido:

- Bucket `contratos` → privado (`UPDATE storage.buckets SET public = false WHERE name = 'contratos'`
  o desde el dashboard).
- El path de cada PDF ya firmado es siempre determinista: `${contract.id}.pdf` (ver
  `uploadSignedPdf` en `sign/[token]/route.ts`) — no hace falta backfill de ningún path nuevo.
- Nuevo endpoint `contracts/pdf-url` (mismo patrón que `payment-proof-url`): recibe `contractId`,
  verifica tenant, devuelve `createSignedUrl` de 1h.
- Actualiza los 4 sitios que hoy usan `signed_pdf_url` como href directo: `firmar/[token]/page.tsx`,
  `firmar-alumno/[token]/page.tsx`, `contratos/equipo/page.tsx`, `students/page.tsx` — cámbialos al
  patrón botón+fetch+`window.open` que ya usa `ventas/registro/[id]/page.tsx` para "Ver
  justificante" (línea ~782-800).
- Prueba en vivo el flujo completo de firma (equipo Y alumno) antes de desplegar — es exactamente
  lo que la sesión anterior no pudo hacer y por lo que no lo tocó.

## 5. Rate limiting real en login

El login llama a `supabase.auth.signInWithPassword` directamente desde el navegador
(`app/[tenant]/login/page.tsx`), nunca pasa por nuestro servidor. Dos caminos, elige el más
barato:
(a) Confirmar en el dashboard de Supabase qué rate limiting aplica ya la plataforma a nivel de
    proyecto (Auth → Rate Limits) y si es suficiente — puede que no haga falta tocar código.
(b) Si no es suficiente, mover el sign-in a un endpoint propio (`POST /api/<tenant>/evergreen/auth/login`)
    que llame a `signInWithPassword` desde el servidor con `createServerClient` (gestionando
    cookies correctamente) y aplique throttling por IP/email usando una tabla nueva en Postgres
    (no hace falta Redis/Upstash para el volumen de este proyecto). Esto es un cambio de
    arquitectura del flujo de auth — pruébalo a fondo (login normal, "recordarme", multi-tenant)
    antes de mergear.

## 6. Observabilidad: Sentry (o equivalente)

Cero error tracking hoy. Instala Sentry (o el que prefieras) para frontend + backend. Cada error
debe llevar como mínimo `tenant_id`, `route`, `request_id` — y NUNCA `password`/`token`/
`service_role`/PII de contacto. El patrón `requireTenant()` ya resuelve `tenantId` en casi todos
los endpoints, así que añadir el tag es barato.

## 7. Branch protection en GitHub

En Settings → Branches de `main`: exigir que el job `quality` de `.github/workflows/ci.yml` pase
antes de poder mergear un PR. Hoy `ci.yml` corre pero no bloquea nada.

## 8. Restore drill de Supabase

Confirma qué plan de Supabase está contratado y si PITR (point-in-time recovery) está activo.
Haz una restauración de prueba una vez (a un proyecto de staging, no al de producción) y documenta
cuánto tarda — eso define el RTO real, no uno inventado.

## 9. Split de las vistas restantes de Agendas y del formulario de Ventas (riesgo medio — con QA en
navegador ya es seguro)

Ya se dividieron las vistas "análisis" y "métricas" de `app/[tenant]/crm/agendas/page.tsx` (2398→2185
líneas, commit `9766687`). Quedan "tabla" y "calendario" (las dos con estado interactivo complejo:
TanStack Table, conflictos de closer, grid de calendario) sin dividir — bajo tu criterio, y solo si
pruebas cada interacción en el navegador después (crear/editar/reprogramar cita, detectar
duplicados, arrastrar en el calendario). Mismo criterio para el sub-formulario setter/closer/
producto/plan entre `ventas/registro/nueva` y `ventas/registro/[id]` si decides fusionarlo en un
componente compartido.

## 10. Paridad funcional Evergreen/WDC

Nunca se auditó qué funcionalidad tiene un tenant y no el otro (más allá del branding, ya resuelto
en el punto 3). Es una decisión de producto: haz un inventario de qué usa cada tenant hoy y decide
con el usuario qué se homogeneiza.

## 11. `?secret=` por query en el webhook de onboarding (opcional, bajo impacto)

`app/api/[tenant]/evergreen/webhooks/onboarding/route.ts` acepta el secreto también por query
string (además del header), lo que puede quedar logueado en logs de acceso. Antes de quitarlo,
confirma con quien tenga acceso a la configuración de GHL si el workflow actual lo envía por query
— si es así, coordina el cambio de configuración en GHL a la vez que quitas el fallback aquí.

## 12. Cerrar lo que el propio Quality Gate de Codex marcó como bloqueante en `PR #4`

No lo repitas desde cero — decide primero si se fusiona `codex/qa-fixes` (61 archivos: reorganización
de Alumnos, reconciliación Stripe/seQura, ESLint, fixes de build) o si se rehace ese trabajo sobre
esta rama. Independientemente de esa decisión, quedan sin cerrar y son reales:
- Matriz de RLS `ORG_A / ORG_B / ADMIN / ANONYMOUS` probada contra Supabase de verdad (no solo
  revisión estática) — cubre también la migración `140000_tenant_scope_users_rls.sql` del punto 1.
- 96 alertas de Dependabot (4 críticas, 44 altas) sin revisar — `github.com/torrealex97-star/
  Growth-Ops-App/security/dependabot`.
- Suite E2E autenticada (la Preview de Vercel está protegida por auth, por eso no se pudo antes).
- Paginación/histórico largo en la conciliación de Stripe (Codex solo cotejó el lote disponible).

## Reglas para todo lo anterior

- Sigue las convenciones ya establecidas en `CLAUDE.md`/`AGENTS.md` del repo (cambio mínimo,
  nunca destructivo sin confirmación, todo cambio de esquema por migración versionada, distinguir
  INSPECTED/TESTED/VERIFIED).
- Antes de cada commit: `npm run quality && npm run test:metrics && npx next build`.
- Trabaja sobre `claude/app-continuation-lpbupf` (o mergéala a main primero si el usuario lo pide).
- Para cada punto, cierra con un resumen IMPLEMENTED/VALIDATION/REMAINING RISKS como en los
  commits anteriores de esta rama.
