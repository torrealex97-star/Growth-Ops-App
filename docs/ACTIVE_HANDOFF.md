# Relevo activo

## Cierre de consolidación — 2026-09-22

**Estado publicado:** `origin/main` está en `24a9646`, con los cambios atómicos de custom fields/hardening de la PR #172 (`269754f`) y el tablero de coordinación de la PR #171 (`24a9646`) fusionados mediante squash. Ambas ramas remotas fueron eliminadas y los workflows de `main` asociados terminaron en verde. No se aplicó manualmente ninguna migración en producción.

**Regla de verdad:** el checkout compartido `claude/constitucion-y-fases` sigue en `2af651a` y conserva WIP local de varias áreas; no se ha publicado ni mezclado automáticamente. No debe afirmarse que "todo" el trabajo de las hebras está en `main` hasta separar cada bloque, probarlo y fusionarlo como PR atómico. No hacer `git reset`, `git clean`, `git add -A` ni copiar desde `/tmp` sobre esa carpeta.

**Aprendizajes incorporados:** verificar siempre `origin/main` y el merge-base antes de editar; una sola rama/PR por unidad; pathspec explícito al commitear; diagnosticar CI por SHA final y no por runs cancelados; comprobar esquema vivo antes de escribir SQL o queries; ejecutar `BEGIN … ROLLBACK` funcional antes de aplicar migraciones; no convertir fallos de fuente en ceros; no guardar PII, tenants, clientes o credenciales en código/documentación; y distinguir inspeccionado, probado y verificado en producción.

**Bloqueo conocido:** sigue pendiente el dry-run SQL en QA de `cleanup_custom_field_values()` tras revocar `EXECUTE` público: comprobar trigger, limpieza JSONB y rechazo de RPC directa. La migración no se ha aplicado manualmente en producción.

**Trabajo de las hebras referenciadas que NO se puede declarar publicado sin un PR/SHA verificable:** integraciones Hotmart/TikTok/Instagram DM, VSL V1/V2, callback OAuth de YouTube, trazabilidad IA de facturas, comisiones por lote, adjuntos de contratos, custom fields del WIP compartido y cualquier migración creada localmente. Revisar cada bloque contra `git log origin/main`, no confiar en mensajes de sesiones anteriores.

**Siguiente relevo:** trabajar únicamente desde un checkout limpio de `origin/main`; reclamar el área en el tablero; separar primero seguridad/migraciones, después integraciones con credenciales reales y por último UX; cada bloque debe incluir regresión, quality/build proporcional, CI por SHA y evidencia de deploy si aplica.

## Candidato aislado de custom fields — 2026-09-22

Checkout creado desde `origin/main` (`2ec86f5`), sin commit ni push. El diff intencionado contiene únicamente: aislamiento de cuotas/cobros/comisiones por `sale_id` y `tenant_id` en la ficha, regresiones focales de custom fields, y la migración `20260922130000_revoke_custom_field_cleanup_execute.sql`. La migración canónica `20260921200000_contact_custom_fields.sql`, la API y los tipos ya existen en `origin/main`; no se duplican.

Quedan expresamente fuera contratos, colaboradores, RAG, facturación, IA, integraciones, dashboards, archivos generados y secretos. Validación pendiente: ejecutar tests, typecheck, formato y un dry-run QA de la revocación antes de abrir PR. No afirmar que la revocación está aplicada en producción hasta verla en la lista de migraciones y confirmar que el trigger sigue limpiando `contacts.custom_fields`.

> **Lee esto entero antes de tocar nada.** Este documento es el punto de coordinación entre los
> agentes que trabajan en el proyecto (Claude Code, Freebuff, Codex, Copilot). Debajo de la sección
> "Estado" hay un histórico por hebras que se conserva como registro; lo vigente es lo de arriba.

## Tablero de reclamaciones (en curso AHORA)

Carriles y reglas en `AGENTS.md` › "Trabajo en paralelo". **Antes de empezar, añade tu fila; al
fusionar, bórrala.** Si lo que vas a tocar está aquí a nombre de otro, no lo toques.

| Agente      | Qué                                                                                  | Rama                      | Toca                                                                                        | Desde  |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------- | ------ |
| Claude Code | S0.7 — baseline de integraciones (solo lectura + doc; arreglos pequeños con su test) | `docs/s0-7-integraciones` | `docs/S0-7-*.md`; si hay arreglo: `lib/integrations/*`, `app/api/[tenant]/evergreen/cron/*` | 22-sep |

## Reglas de trabajo (2026-09-21)

Se escribieron tras encontrar una carpeta local que llevaba días trabajando sobre un linaje de git
**sin ancestro común** con `origin/main`: todo lo hecho ahí era irrecuperable por merge. Existen
para que no vuelva a pasar.

1. **Una sola carpeta local y un solo repo.** El repo es
   `github.com/torrealex97-star/Growth-Ops-App`. La carpeta de trabajo es
   `~/GIT HUB/Growth-Ops-App`. No se crean clones paralelos "para probar".
2. **Al empezar sesión, comprueba que no has derivado**:
   ```
   git fetch --prune && git rev-list --left-right --count main...origin/main
   ```
   Cualquier cosa que no sea `0 0` (o un simple "detrás") se investiga **antes** de escribir código.
   Si `git merge-base main origin/main` no devuelve nada, la carpeta no sirve: para y avisa.
3. **Rama corta, PR, merge.** Una rama por unidad de trabajo, PR en cuanto haya algo coherente y
   merge a `main` con CI en verde. Nada de acumular días sin pushear: lo que no está en `main` es
   invisible para los demás agentes y para Alex desde el móvil.
4. **Ramas vivas, las mínimas.** Tras mergear se borra la rama. Una rama que sobrevive a su PR es
   trabajo que otro agente rehará sin saberlo.
5. **Antes de empezar algo, mira si ya está hecho.** Lee esta sección y `git log origin/main`. Si
   dos agentes pueden tocar lo mismo, decláralo aquí primero.
6. **Actualiza este documento al terminar**, aunque quede a medias: qué tocaste, qué validaste de
   verdad y qué queda. Un relevo que no se escribe no existe.
7. **Nada de PII ni credenciales en commits.** El repositorio es **público**: `docs/SECURITY_PRIVACY.md`.

## Estado (2026-09-21, tarde — hebra Freebuff 4250bf8e)

**Citas (Calendly/GHL) arregladas — #108 + #110 + #112 fusionados.** Síntoma: la semana mostraba
1 agenda con muchas más en Calendly/GHL. Causa raíz: la sync de citas solo existía como botón
manual (history-sync), la importación del 12-sep jamás tuvo planificador y ni un run de estos
proveedores en `integration_sync_runs` desde entonces. Ahora: **cron diario de Calendly**
(04:20 UTC, ventana 14 días, upsert idempotente, presupuesto 35 s) por GitHub Actions; **GHL va
SOLO por botón** — su API lista todos los contactos de la ubicación antes de tocar eventos y no
cabe en los 60 s de Vercel Hobby (dos pasadas en producción: 504 y run colgado en 'running'; el
webhook cubre el tiempo real). Implementación única en `lib/integrations/citas-sync.ts`
(botón + cron comparten código; test prohíbe duplicarla). `SYNC_DEFS` declara `calendly-citas`
y `ghl-citas` (route: null + manualReason). Resultado verificado en BD: 1 → **16 citas esta
semana** (+19 importadas, 67 actualizadas; 0 duplicados GHL↔Calendly en 30 días).

**Ops extra de la misma sesión**: migración `20260918140000` (meta_actions/meta_action_values de
`campaign_daily`) estaba SIN aplicar en producción — el cron `meta-daily` llevaba días en error
"schema cache". Aplicada, registrada en `schema_migrations` y `NOTIFY pgrst 'reload schema'`
verificado vía REST. También se cerró a mano el run de GHL que quedó colgado en 'running'.

Tests: 519 → 568 (la otra hebra añadió los suyos); `tests/cron-calendly-ghl.test.mjs` fija los
invariantes (auth CRON_SECRET, config por subcuenta, idempotencia, no-colisión de horarios,
GHL prohibido en el cron, una sola implementación).

## Estado (2026-09-21)

`main` al día, sin PRs abiertos ni ramas de trabajo vivas.
**582 tests, 579 pasan, 0 fallan** (3 se auto-saltan sin credenciales y sí corren en CI) ·
**666 de métricas, todos pasan** · `typecheck` exit 0 · 68 migraciones.

### Fases

| Fase | Entregable                                                                                                                                                            | Estado                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| S0.1 | `docs/S0-1-INVENTARIO-CAPACIDADES.md`                                                                                                                                 | cerrada                               |
| S0.2 | `docs/S0-2-JOURNEYS-CRITICOS.md`                                                                                                                                      | cerrada                               |
| S0.3 | `tests/webhook-ghl.test.mjs`                                                                                                                                          | cerrada                               |
| A0   | `docs/A0-CIERRE-AUDITORIA.md`                                                                                                                                         | cerrada                               |
| F-1  | `tests/agente-contenido-hostil.test.mjs`, `tests/invariante-tenant-negativo.test.mjs`, `lib/seguridad/invariante-tenant.ts`, fixtures A/B, 2 migraciones de seguridad | cerrada salvo lo de Alex              |
| F6   | `docs/F6-MAPA-PII.md`, `lib/privacidad/{plan-borrado,erase-person}.ts`                                                                                                | implementada y probada; **no gradúa** |
| S0.5 | `docs/S0-5-CONSISTENCIA-DATOS.md`, `scripts/consistencia-cash.sql`                                                                                                    | cerrada                               |
| S0.4 | `docs/S0-4-BARRIDO.md` — 6 resueltos (1 P0 pendiente de aplicar), resto con dueño                                                                                     | cerrada salvo aplicar el P0           |

El plan completo vive en `docs/plan/`. Empieza por su README.

### Lo siguiente, en este orden

1. **Resolver lo pendiente listado abajo.**
2. **S0 tramo 2**: S0.4 y S0.5 hechas. Siguen **S0.6** (baseline de frontend y rendimiento: incluye
   las 38 políticas RLS con `auth.uid()` por fila), **S0.7** (baseline de integraciones: Calendly
   roza los 60 s; un timeout que mata la función no deja fila en `integration_sync_runs`) y **S0.8**
   (graduación). **Antes de F1.**

### Por qué F6 no gradúa

Dos motivos, ninguno es código:

- Las tres decisiones de retención (`docs/F6-MAPA-PII.md` §7): raw, transcripciones y hechos
  financieros. Son de negocio y base legal.
- **`raw_events` no tiene `contact_id`** ni forma de localizar los payloads de una persona. No es
  una decisión pendiente: es una limitación real que decidir la retención NO desbloquea. **Requisito
  para F1**: cuando el webhook de GHL escriba en la capa raw, debe dejar los payloads localizables
  por persona.

### Migraciones escritas y NO aplicadas

El plan prohíbe que un agente toque producción por su cuenta. Espera confirmación:

- ~~P0 del RAG~~ **APLICADA el 2026-09-21** con aprobación de Alex, como
  `20260921172046_s0_4_match_knowledge_chunks_gate_subcuenta.sql` (renombrada a su versión real).
  Verificado: las 3 firmas sin EXECUTE para `anon`; la de 6 argumentos exige pertenencia.
- `20260921100000_f6_fathom_match_review_contact_id.sql` — vincula 69 de 177 filas de
  `fathom_match_review` a su contacto. Las otras 108 son correos de personas que no son contactos:
  ningún borrado por `contact_id` las alcanza, y `erase_person` las cubre borrando por correo.

`contacts.lifecycle` **ya está en producción** (PR #115, nullable TEXT sin constraint). Se eliminó
la migración duplicada `20260921110000_f6_contacts_lifecycle.sql`, que la declaraba
`NOT NULL DEFAULT 'identified'` con CHECK: habría dejado el repo con una restricción que producción
no tiene. **Deuda para F7**: `docs/plan/01-arquitectura-datos.md` §3 quiere el enum completo y
`NOT NULL`; endurecerla exige backfill de las 996 filas vivas.

### Dos fallos míos que encontró el gate de columnas fantasma (PR #115)

Se anotan porque la lección vale más que el arreglo: **escribí contra columnas que no comprobé**.

- El audit de `erase_person` usaba `entity` y `metadata`; las columnas reales son `entity_type` y
  `new_values`. El insert habría fallado en el primer borrado real.
- `contacts.lifecycle` no existía cuando el ejecutor ya la escribía.

La regla de `CLAUDE.md` —"BD antes que código: consulta el MCP de Supabase, no infieras el esquema
leyendo código"— existe exactamente para esto, y no la seguí. El auditor de columnas fantasma lo
cazó; conviene no gastar esa red dos veces.

### Incidencias abiertas

- **12 pagos de Stripe sin cobro registrado: 5.095,41 €** — **CAUSA ENCONTRADA (S0.4, 2026-09-21)**.
  No es el sync (funciona: 69 pagos leídos a diario por GitHub Actions). El cobro de Stripe se
  registra A MANO y por lotes (mediana: 33 días de retraso; último lote 14-sep), y el único aviso
  existente (`pago_stripe_sin_venta`) mira CLIENTES, no pagos: se le escapaban las **cuotas de
  quien ya tiene venta** (748,50 y 332,83 repetidos) y los **pagos sin cliente en Stripe** (los
  cinco de 50 €). Arreglo: controles `pago_stripe_sin_cobro` y `cobro_de_pago_devuelto` en Ajustes ›
  Salud de datos, que dicen a dónde ir en cada caso. Además el sync guardaba el correo solo de
  `receipt_email` (vacío en los 59): ahora cae al de facturación (resincronizado: ya tienen correo).

  **Registro de los 12 — HECHO el 2026-09-21** con aprobación de Alex (incluido el de julio). Una
  transacción; cada fila lleva la nota `S0.4 2026-09-21`. Resultado verificado: **0 pagos sin cobro;
  Stripe 27.029,46 € = cobros de esos pagos 27.029,46 €**. 8 ventas nuevas, 2 cobros añadidos a
  ventas existentes (2.ª cuota de un 1997/6; julio a la venta 1497/4 de la misma clienta), 4
  contactos nuevos, plan nuevo `WDC — Reserva (50 €)` (método `reserva`) para las 3 reservas sueltas.
  Precio por fecha: 1497 € hasta julio, 1997 € desde agosto.

  **Comisiones**: las genera el motor en código (`reconcileSaleCommissions`), no la base.
  `sales/reconcile-all` acepta ahora `{ saleIds }` y hay un workflow manual
  (`reparar-comisiones.yml`) para lanzarlo sobre ventas concretas sin tocar el resto.
  **Lanzado el 2026-09-21** sobre las 10 ventas afectadas: 18 comisiones pendientes para los 12
  cobros (closer 12 = 480,18 €; colaborador 6 = 249,64 €), 0 duplicadas, 0 cobros sin comisión.
  Ojo: ya existían antes de lanzarlo (algo las generó tras el registro; total de la subcuenta 91
  antes y después) y la reparación las rehízo idénticas. Si alguien sabe qué proceso fue, anótelo.

- **Un cobro de 50 € contra un pago que Stripe devolvió**, con `refunds` a 0 filas: el camino de
  devolución no está cerrado.
- **GHL**: el webhook YA FUNCIONA (contacto de prueba recibido el 21-sep a las 13:56). Falta
  confirmar que entran CITAS: el workflow de prueba era de contacto y no traía datos de agenda.

### Cambios de identidad aplicados en producción (2026-09-21)

- La app se llama **GrowthOps**, en una palabra.
- La subcuenta de Scalix: slug `evergreen` → **`scalix`**, nombre → **Scalix Systems**.
  Su URL es `https://app.scalixsystems.com/scalix/login`. No tiene ni debe tener credenciales
  propias: es la plataforma. Todas las integraciones (23 claves) viven en `women-digital-closer`.
- `RESEND_FROM` a nivel de plataforma: `GrowthOps <soporte@scalixsystems.com>`. WDC conserva el suyo.
- **No se ha renombrado** el segmento literal `evergreen` de las 168 rutas de API: está dentro de la
  URL del webhook de WDC. Va antes de F8, con las rutas nuevas conviviendo con las viejas.

### Lo que NO hay que volver a auditar

Verificado y cerrado. Repetirlo es trabajo perdido:

- Cash: cuando un cobro se registra, se registra bien — 0 desvíos de importe en los 47 pares
  conciliados, 0 referencias duplicadas, 0 comisiones huérfanas (`docs/S0-5-CONSISTENCIA-DATOS.md`).
- Aislamiento: `requireTenant()` en 149 de 168 rutas; las 19 restantes son legítimamente sin sesión.
- El esquema vivo cumple el invariante entero: 107 tablas, todas con RLS y al menos una política.
  Las únicas 5 sin `tenant_id` están declaradas en `lib/seguridad/invariante-tenant.ts`.
- El RAG contiene **solo** skills de plataforma, no PII. La línea roja de F6 no se ha cruzado.
- Los crons no se solapan: 2 en Vercel, 8 en GitHub Actions.
- El linaje huérfano de `~/GIT HUB/Growth-Ops-App` se repuntó y sus 20 ramas se borraron tras
  verificar por `patch-id` y por contenido que todo estaba en `main`. Queda
  `rescate/linaje-viejo-20260913` como red de seguridad; se puede borrar.

### Bloqueos que dependen de Alex

Solo lo que ningún agente puede hacer:

| Bloqueo                                                                                          | Bloquea                 |
| ------------------------------------------------------------------------------------------------ | ----------------------- |
| Rotar `RESEND_API_KEY` (guardada como valor legible en Vercel) y confirmar Google, GHL y staging | Graduación de F-1       |
| Activar leaked-password protection en Supabase Auth                                              | Graduación de F-1       |
| Decidir retención de raw, transcripciones y hechos financieros                                   | Graduación de F6        |
| Configurar UTMs y `source` en el webhook de GHL (`contact_attributions` a 0)                     | F7 y F4 de raíz         |
| Reconectar el token de Meta de WDC (`#10 Application does not have permission`)                  | Sync de Meta            |
| Rellenar los `[definir]` de la etapa A (`docs/plan/00-constitucion.md` §2)                       | Arranque de F1          |
| Comprobar que `https://app.scalixsystems.com` está en Supabase → Auth → URL Configuration        | Enlaces de recuperación |
| Commitear el WIP del checkout de `~/Documents` y retirarlo                                       | Carpeta única           |
| Configurar Bunny en Integraciones › Bunny Stream (guía en la propia pantalla)                    | Subida de VSL           |

Puedo hacer, con su visto bueno: poner el repo privado, borrar el proyecto `go-prod` de Vercel
(vacío), crear `CRON_SECRET` en Preview, borrar la rama de rescate.

---

## Histórico

Las entradas por hebra anteriores al 2026-09-21 se han compactado. El detalle está en el historial
de git (`git log --follow docs/ACTIVE_HANDOFF.md`) y, sobre todo, en los documentos y tests que
produjeron, que son la memoria durable.

Resumen de lo que cubrían: barrido data-viz con tokens de diseño en Recharts (19-sep) · base neta
de comisión de pasarela (19-sep) · copy del embudo de analítica (16-sep) · filtros de fecha
unificados, embudo de ventas e Instagram (15-sep) · endurecimiento multi-tenant e invitaciones
(15-sep) · observabilidad de navegador y cascada de sesión (15-sep) · brief de
Integraciones/Stripe/Métricas/Funnels (14-sep) · barridos de bugs (13 y 14-sep).

Dos lecciones operativas de esas hebras que siguen vigentes:

- **CI usa `cancel-in-progress`**: un run "cancelled" no es un fallo. Valida el ÚLTIMO commit con
  `gh run list --commit <sha>`, no el precedente.
- **No afirmes lo que no has verificado.** Se construyó un panel manual de crons sobre la creencia
  falsa de que Vercel Hobby solo permitía 3, y se recortó CI sobre la creencia falsa de que el repo
  era privado. Las dos premisas eran inventadas.
