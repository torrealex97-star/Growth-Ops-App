# Hoja de ruta MVP — funnels, integraciones y aprovisionamiento

Última actualización: 2026-09-13 (Claude Code).
Sustituye a `PLAN_FUNNELS_INTEGRACIONES.md` (rama `claude/plan-funnels-integraciones`), cuyo §3.4
contenía dos recomendaciones erróneas ya corregidas aquí.

**Criterio acordado con el usuario: MVP funcional de todo antes que una sola cosa perfecta.**
Cada fase entrega algo usable de punta a punta, y se mejora después. Este documento es el sitio
donde se ve "cómo va" y "qué sigue" — parte del avance la continúa Codex, así que se mantiene al
día en cada PR.

## 1. Decisiones tomadas (usuario, 2026-09-13)

| Pregunta           | Respuesta                                                  |
| ------------------ | ---------------------------------------------------------- |
| Clarity            | Versión **limitada y honesta**: nada de simular histórico  |
| Orden              | El más eficiente — lo decide Claude Code                   |
| GA4 / Google Cloud | **No existe** proyecto OAuth todavía: hay que crearlo      |
| Buzón de facturas  | **Solo Gmail**                                             |
| Fusiones de UX     | A criterio de Claude Code                                  |
| Alcance            | **Subconjunto priorizado**, con avance visible y reportado |

## 2. Límite externo que condiciona el alcance: Microsoft Clarity

Data Export API, límites **no ampliables**: 10 peticiones por proyecto y día, solo los últimos 1–3
días de datos, 1.000 filas y 3 dimensiones por petición; métricas Traffic, Engagement Time y Scroll
Depth. Sin histórico y con 10 llamadas al día no hay sync incremental, ni backfill, ni series
temporales, ni cruce por landing con leads y ventas.

Consecuencia: **Clarity no alimenta Funnels.** Lo que sí se hará (decisión del usuario: versión
limitada y honesta):

- Instalación del script por subcuenta (grabaciones y heatmaps se ven en el panel de Clarity).
- Widget de solo lectura con los últimos 1–3 días, con su límite escrito en pantalla.
- En Funnels, Clarity aparece como **"fuente no apta para histórico"**, nunca como 0.

GA4 sí sirve: rango de fechas arbitrario, dimensiones de source/medium/campaign/landing/dispositivo
y eventos de conversión. Es la fuente correcta para Web/SEO.

## 3. Estado y orden de ejecución

Leyenda: ✅ hecho · 🚧 en curso · ⛔ bloqueado por el usuario · ⬜ pendiente

| #   | Fase                                          | Estado | Nota                                                       |
| --- | --------------------------------------------- | ------ | ---------------------------------------------------------- |
| A   | Desbloquear PR #30                            | ⛔     | Requiere acción del usuario (ver §5)                       |
| B   | Reordenación de navegación y Configuración    | ✅     | Commit `f4f028a`                                           |
| C   | Capa canónica de funnels (sin UI)             | ⬜     | Siguiente. No necesita credenciales                        |
| E   | Sección Funnels con lo que ya hay en base     | ⬜     | MVP sin GA4: VSL, Webinar y Profile ya tienen datos        |
| F   | CRM → Agenda, detalle de cita legible, Fathom | ⬜     | Mejora diaria, barata                                      |
| D   | GA4 (OAuth multi-tenant)                      | 🚧     | Flujo OAuth hecho; falta el sync de datos                  |
| G   | Banco de testimonios y de grabaciones         | ✅     | Grabaciones hechas; testimonios ya existía (§3.3)          |
| H   | Facturas por email (**solo Gmail**)           | ⬜     | También necesita el proyecto de Google Cloud               |
| I   | Backfill de Stripe y diagnóstico de Meta      | ⬜     | **Siguiente**                                              |
| J   | Aprovisionamiento                             | ⬜     | Al final: el blueprint solo puede incluir lo que ya existe |

**Por qué este orden y no el del plan original:** D (GA4) estaba antes de E (UI de Funnels), pero
GA4 está bloqueada por una acción del usuario en Google Cloud. Hacer C+E primero entrega una
sección de Funnels **funcionando con las fuentes que ya tienen datos en base** (VSL, webinar,
perfil), y GA4 entra después como una fuente más cuando exista el proyecto OAuth. Así el MVP no
depende de un bloqueo externo.

## 3.1 Qué hace y qué NO hace el MVP de Funnels

Funciona hoy, con datos reales de la base:

- Etapas de CRM: leads (contactos nuevos), agendas, llamadas realizadas (`status = 'show'`) y
  cierres (ventas activas según `isActiveSale`, así que un reembolso no cuenta como cierre).
- Etapas de Meta: impresiones, clics y alcance desde `campaign_daily`, más la inversión del periodo
  para calcular coste por etapa.
- Conversión entre etapas y desde el inicio, coste unitario, y las cuatro familias con su rango de
  fechas.

NO funciona todavía, y la pantalla lo dice con el motivo en cada fila:

- **Visitas a landing / VSL.** `canonical_events.event_name` es texto libre: no hay un vocabulario
  declarado que diga qué nombre de evento es "visita a la landing". Inventármelo habría producido
  números creíbles y falsos, así que esas etapas salen como "fuente sin configurar".
  _Siguiente paso concreto:_ listar los `event_name` que realmente llegan por subcuenta y dejar que
  el usuario mapee cuál corresponde a cada etapa.
- **Sesiones (GA4).** Bloqueado por el proyecto de Google Cloud.
- **Asistentes de webinar y conversaciones por DM.** Hoy no hay en base un criterio que separe ese
  subconjunto de contactos del resto.

Por eso el cálculo se niega a dividir personas entre eventos: daría tasas por encima del 100 % sin
que nada esté roto. Esas celdas dicen "no comparable", no un porcentaje inventado.

## 3.2 Fase F: qué queda

Hecho:

- `/crm` redirige a `/crm/agendas` **en servidor**, y el menú apunta ahí. Antes era un `useEffect`
  con `router.replace`: parpadeo en blanco y ninguna redirección HTTP real, así que el botón
  "atrás" rebotaba.
- El payload crudo del webhook en la ficha de cita queda **plegado y solo para admin**. Antes se
  volcaba abierto para cualquiera que pudiera ver la cita, justo debajo de las respuestas ya
  legibles. Las respuestas del formulario **ya existían** y se siguen viendo para todos: esa parte
  del brief estaba resuelta de antes, solo faltaba quitar el ruido técnico de encima.

**Matching de Fathom — hecho, y arregla una corrupción de datos que no estaba en el brief.**

Lo que hacía antes: cuando había varias citas candidatas en una ventana de ±12 h, escribía la
transcripción en **todas**, con un comentario que lo presentaba como lo prudente. No lo era:
duplicaba la misma llamada en N citas (el análisis de IA y Voice of Customer la contaban N veces),
estampaba el mismo `fathom_meeting_id` en N filas, y en el re-sync siguiente la comprobación de "ya
importada" encontraba una y saltaba — **parecía idempotente habiendo dejado N-1 filas con una
llamada que no ocurrió ahí**.

Lo que hace ahora:

- La decisión vive en `lib/fathom/match.ts`, función pura con 10 tests. El sync solo obedece.
- Identificador de Fathom primero (determinista). Si no, email + proximidad, con ventana de
  **90 minutos** en vez de 12 horas.
- Si dos candidatas están a menos de 15 minutos de diferencia entre sí, **no se elige**: elegir
  sería tirar una moneda. Va a `fathom_match_review` para que una persona decida.
- Escritura a **una sola** cita, con `.select()` para no dar por escrito lo que RLS dejó en 0 filas.
- `dryRun: true` recorre y clasifica sin escribir, y devuelve una muestra legible de lo que haría.
- La cola es idempotente por `(tenant_id, fathom_meeting_id)`: un re-sync no duplica casos, y si la
  persona ya resolvió uno, no se reabre.

Queda por hacer, y es pequeño: la **pantalla** para resolver la cola. Hoy los casos se anotan
correctamente y se pueden consultar, pero resolverlos requiere tocar la tabla. Es lo primero que
debería añadirse cuando haya casos reales que resolver.

## 3.3 Fase G: replanteada, y por qué

Al abrirla me encontré con que **el banco de testimonios ya existe** (`/recursos/testimonios`, tabla
`testimonios`), pero es otra cosa que lo que pedía el brief: un banco de **copy** de venta (hook,
punto A → punto B, vehículo, cifra ancla, consentimiento de imagen), no un banco de archivos con
subida masiva. Así que "banco de testimonios" no era trabajo nuevo: es una tabla que ya está y que
nadie ha llenado.

Y buscando ahí aparecieron **tres fallos reales** que valían más que construir otra pantalla:

1. **Unique global sobre `slug`** en `testimonios`, `qualification_questions` y `vsl_videos`, que
   tienen `tenant_id`. La segunda subcuenta que usara el slug "xavi" (o "principal" en un vídeo VSL)
   recibía un error de clave duplicada por una fila de **otra subcuenta que no puede ni ver**. Y
   bloqueaba de raíz la fase J: cada subcuenta nueva chocaría en los slugs naturales. Misma clase de
   fallo ya corregida en `integration_settings`, que se quedó sin revisar aquí. **Arreglado.**
2. **El auto-registro de preguntas de cualificación no ha funcionado nunca** desde la migración
   multi-tenant. Los webhooks de GHL y Calendly hacían `upsert` sin `tenant_id`, que es `NOT NULL`,
   así que cada llamada moría con `not_null_violation`. **Arreglado.**
3. **El error se tragaba.** Nadie miraba el resultado de ese `upsert`, y eso es lo que escondió el
   fallo: la tabla estaba vacía habiendo pasado cientos de formularios. Ahora se registra en consola
   sin abortar el webhook — perder la cita entera por un efecto secundario sería peor.

Verificado en producción, no deducido: reproduje el `not_null_violation` y comprobé que las tres
tablas estaban vacías antes de tocar los índices.

Lo que **sigue pendiente** de la fase G, y ahora sí es trabajo nuevo:

- Banco de **grabaciones** (archivos) con subida masiva, progreso y reintento, categoría por MIME
  (no por IA), dedupe por hash, Storage privado bajo `tenant_id/` y aprobación manual.
- Clasificación de llamadas ganada/perdida/pendiente **derivada de datos canónicos**, nunca de la IA
  por sí sola.

## 4. Regla que aplica a todas las fases

Una métrica nunca colapsa a 0 por un fallo de fuente. El tipo canónico es
`{ value, status: 'ok' | 'sin_datos' | 'error_fuente', source, lastSync }`, y la UI distingue los
tres casos. Es la misma lección que ya costó un falso "0 filas" en la cobertura de datos del agente.

Y: ninguna integración se marca como lista si solo existe la interfaz; ningún dato simulado se
presenta como real; ningún DDL fuera de migraciones versionadas; aislamiento por `tenant_id` y RLS
en todo lo nuevo.

## 5. Estado de los bloqueos

**Resueltos el 2026-09-13**, con autorización explícita del usuario y verificación en producción:

1. ✅ `storage_tenant_policies` aplicada. Antes: comprobado que solo existía el bucket `contratos`,
   ya privado y con 0 objetos, y que ninguna ruta quedaría inaccesible por el prefijo `tenant_id/`.
   Después: los dos buckets privados y las cuatro políticas presentes.
2. ✅ `partners_profit_guard` aplicada. Antes: comprobado que `partners` está vacía, así que el
   trigger no podía romper ningún reparto existente. Después: **probado funcionalmente** — 60 + 60
   y 70 + 40 se rechazan con `check_violation`, sin dejar filas escritas.
   De paso se corrigió un fallo del propio mensaje de error (`%%%` en `RAISE` se parsea como
   literal + marcador, y salía "quedaría en %120.00").
3. ✅ Historial de migraciones reparado: 28 locales = 28 remotas, sin sobras ni faltas. Con respaldo
   previo en `schema_migrations_backup_20260913`. Ver `MIGRATION_RECONCILIATION.md`.
4. ✅ Aviso del linter causado por el punto 2 y cerrado en el mismo día: la función del trigger era
   invocable como RPC por `anon`. Revocado en `20260913120000_partners_guard_revoke_rpc.sql`, y
   verificado que el guard sigue bloqueando después de revocar.

**Sigue bloqueado, y es lo único que necesito de ti:**

- ~~Crear el proyecto de Google Cloud~~ ✅ **hecho por el usuario el 2026-09-13.** Client ID y
  Secret creados para el cliente `growth-ops-web`.

  Dos cosas que aprendimos al hacerlo y conviene no repetir:
  - `vercel.app` **no vale** como dominio autorizado: está en la Public Suffix List, así que Google
    lo rechaza igual que rechazaría `.com`. Hay que poner el subdominio real
    (`growth-ops-weld.vercel.app`), y cada preview o proyecto nuevo se añade uno a uno.
  - El URI de redirección registrado es `/api/oauth/google/callback`, **sin subcuenta en la ruta**.
    Google compara la cadena literal y exige registrar cada URI, así que no puede haber un callback
    por subcuenta. De ahí que la subcuenta viaje **firmada** en el parámetro `state`.

- **Pendiente del usuario: rotar el Client Secret.** Se pegó en un chat, así que queda en un
  historial almacenado y ya no es secreto. Generar uno nuevo en Clientes → `growth-ops-web` →
  Secretos del cliente y pegarlo en Configuración → Integraciones → Google, que es donde se cifra.

### Hallazgos fuera de alcance detectados al pasar el linter

- `public.merge_contacts` tiene `search_path` mutable (preexistente, no lo he tocado).
- Diez funciones `SECURITY DEFINER` son invocables por `authenticated`. Las de RLS
  (`auth_tenant_ids`, `is_admin_or_director`, `get_my_role`…) **tienen que serlo** para que las
  políticas funcionen: no es un fallo. Conviene revisar una a una si alguna sobra.
- Protección de contraseñas filtradas (HaveIBeenPwned) desactivada en Auth. Es un interruptor del
  panel, gratis de activar.

## 6. Revisión de UX: qué se hizo y qué se descartó

Hecho en la fase B (commit `f4f028a`):

- El bloque "Negocio" sale de Integraciones y se fusiona en **Datos de empresa**. No es una
  integración: no hay credencial ni conexión que probar. La persistencia no cambió.
- **Fuera la barra de pestañas** de Configuración: Integraciones y Data Health son dos tarjetas más
  de la rejilla. Un solo nivel de navegación.
- **Auditoría** baja del primer nivel a Configuración. No se borra: es la única trazabilidad de
  quién tocó una venta, un cobro, una cita o una comisión.

Descartado, y por qué — dos de estas eran errores míos, por haber leído el listado de directorios
en vez del mapa de navegación real:

| Propuesta original                      | Veredicto                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Mover `pnl` dentro de Finanzas          | **Ya estaba hecho.** `/pnl` es un stub que redirige a Finanzas                                                                  |
| Fusionar `cohorts`                      | **Ya estaba hecho.** `/cohorts` redirige a Finanzas › Analítica                                                                 |
| Fusionar `analitica` + `unit-economics` | **No.** Embudo/ranking de ventas y unit economics no son la misma pregunta                                                      |
| Fusionar `kpi` con `dashboard`          | **No hay nada que fusionar.** `kpi` no es una sección: su única pantalla es el editor de plantillas, ya dentro de Configuración |

No se toca `drops`, `csm-events`, `students`, `recursos`, `tasks`, `instagram` ni `setting-ai`:
fusionarlas sin datos de uso sería peor que dejarlas.
