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

## 1. Aplicar las migraciones pendientes (URGENTE — es el hallazgo de seguridad más grave de toda
la sesión y hoy está sin efecto en producción)

Hay migraciones nuevas en `supabase/migrations/` con fecha 2026-09-12 que nunca se aplicaron:
- `20260912100000_composite_perf_indexes.sql`
- `20260912110000_tenant_branding.sql`
- `20260912120000_carruseles_tenant_isolation.sql` ← **la más crítica**: sin esto, cualquier
  usuario autenticado de un tenant puede leer/editar/borrar los carruseles de Instagram del OTRO
  tenant cambiando un id en la URL. El código ya está corregido (`lib/carruseles/store.ts` y ~15
  rutas en `app/api/[tenant]/evergreen/carruseles/**`), pero es inerte sin la columna/política que
  esta migración crea.
- `20260912130000_amount_range_constraints.sql`

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

## Reglas para todo lo anterior

- Sigue las convenciones ya establecidas en `CLAUDE.md`/`AGENTS.md` del repo (cambio mínimo,
  nunca destructivo sin confirmación, todo cambio de esquema por migración versionada, distinguir
  INSPECTED/TESTED/VERIFIED).
- Antes de cada commit: `npm run quality && npm run test:metrics && npx next build`.
- Trabaja sobre `claude/app-continuation-lpbupf` (o mergéala a main primero si el usuario lo pide).
- Para cada punto, cierra con un resumen IMPLEMENTED/VALIDATION/REMAINING RISKS como en los
  commits anteriores de esta rama.
