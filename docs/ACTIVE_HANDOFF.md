# Relevo activo

## Contexto estratégico editable — 2026-09-15

Rama única: `codex/growth-context-ui`, iniciada después de fusionar y desplegar la PR #54.

- Configuración → Datos de empresa monta el contexto estructurado que ya consumían el Growth Brief
  y el agente: tipo de negocio, oferta/precio, ciclo, objetivos de facturación/Cash ROAS/LTGP:CAC,
  capacidad y notas.
- No se inventan valores: vacío se envía como `null`. La UI usa el cliente `pedir` con timeout,
  cancelación, error visible y reintento; lectura para el equipo y campos desactivados para quien no
  dirige.
- Se corrigió `puedeEditar` para que el `super_admin` de plataforma no reciba una interfaz de solo
  lectura pese a que el PUT sí lo autorizaba.
- `cargarContextoNegocio` dejó de usar `select('*')`: pide solo las diez columnas que consume.
- El antiguo texto libre se conserva sin migrar ni duplicar datos, renombrado en UI como voz,
  público y funnel para distinguirlo del contexto estratégico.

Validación local ejecutada: **format PASS; lint PASS con warnings heredados; typecheck PASS; suite
general 343/343 PASS; métricas 647/647 PASS; dead-code informativo PASS; build limpio de producción
PASS**. Pendiente al escribir este relevo: push, CI/Preview, comprobación visual, merge y smoke.

## Endurecimiento operativo e invitaciones multi-tenant — 2026-09-15

Fusionado en `main` mediante la PR #54 (`f36c6fe`) y desplegado correctamente en Vercel. La rama
remota fue eliminada; el smoke de producción cargó Usuarios con datos reales y sin errores de consola.

- La pantalla Usuarios dejó de llamar a `admin/migrate-page-overrides` en cada montaje. Abrir una
  vista ya no dispara DDL administrativo ni consume una función/consulta innecesaria.
- La invitación valida el rol antes de crear la identidad, asigna techo `admin` en
  `tenant_members` a admin/director, conserva un techo administrativo existente y comprueba cada
  escritura. Si una invitación nueva queda a medias, elimina la identidad recién creada para no
  dejar usuarios huérfanos.
- CI y deploy usan Node 24 y `actions/checkout`/`actions/setup-node` v7. Next fija
  `outputFileTracingRoot` al repositorio para no inferir `/Documents` por el lockfile ajeno.
- Pruebas de regresión: `tests/invite-consistency.test.mjs` y `tests/ci-runtime.test.mjs`.

Validación: **local PASS; PR CI PASS; Preview Vercel PASS; main CI PASS; deploy Vercel PASS; smoke
Usuarios PASS**. La escritura de una invitación no se ejecutó contra datos reales para evitar crear
un usuario de prueba adicional; ese recorrido sigue cubierto por regresión estática y revisión de RLS.

## Métricas reales restantes + alertas en Notificaciones — 2026-09-15

Se cerraron tres métricas que el registro ya declaraba pero que `calcularAgregados` devolvía siempre
como hueco pese a existir las señales necesarias:

- **Speed to Lead**: mediana de `contacts.first_contact_at - contacts.created_at`, paginada, acotada
  por `tenant_id` y periodo. Fechas inválidas o negativas se excluyen y la tarjeta declara cuántos
  contactos tienen ambas horas.
- **BAMFAM**: llamadas asistidas sin venta que tienen `needs_followup = true` sobre todas las elegibles.
- **Acuerdo marketing ↔ ventas**: reutiliza el motor canónico de cualificación del formulario y el
  juicio del closer; el denominador contiene solo agendas comparables y se declara la cobertura.

`LTGP:CAC` sigue correctamente como **hueco**: no existe beneficio/margen bruto de por vida por
cliente. Sustituirlo por facturación o cash sería convertir ingresos en beneficio e inventar la
métrica que decide si se escala.

El desplegable global de Notificaciones ahora incorpora las prioridades del Growth Brief. La carga
es perezosa al abrir la campana, usa el cliente de peticiones con timeout/cancelación, informa del
fallo y permite reintentar. No añade la lectura paginada del brief a cada navegación, protegiendo CPU
y consultas del tier gratuito.

Validación local ejecutada: **format PASS; lint PASS con warnings heredados; typecheck PASS; suite
general 330/330 PASS; métricas 647/647 PASS; build limpio de producción PASS**. Falta aún confirmar
CI, Preview y smoke real antes de fusionar.

## Observabilidad de navegador + cierre de cascada de sesión — 2026-09-15

La sesión que resuelve `app/[tenant]/layout.tsx` ya es la única lectura de `auth.getUser()` en las
pantallas protegidas. Se retiraron las relecturas de 17 superficies que aún las hacían al cargar o
escribir (Ventas, Reservas, Embudo, Contacto, Gastos, Campañas, Instagram, Contenido, Tareas,
Perfil, contratos/recursos y sus componentes compartidos). No cambió la autorización: RLS y las
rutas de servidor siguen decidiendo qué puede leer o escribir cada rol; solo se eliminó red
duplicada y se reutiliza `useSesion()`.

La caída de navegador queda diagnosticable:

- `app/[tenant]/error.tsx` envía la excepción a Sentry con la ruta agrupada y no muestra el mensaje
  técnico al usuario;
- `app/global-error.tsx` cubre también errores del layout raíz que el límite del tenant no alcanza;
- el fallback dejó de montar el shader WebGL, para que un fallo de GPU/render no se agrave al mostrar
  el propio error;
- `WebVitalsReporter` registra LCP, INP y CLS reales por ruta en Sentry cuando
  `NEXT_PUBLIC_SENTRY_DSN` está configurado, sin slug de subcuenta, ids ni PII.

Validación local ejecutada: **format PASS; lint PASS con warnings heredados; typecheck PASS; suite
general 322/322 PASS; métricas 643/643 PASS; regresión focal 46/46 PASS; Next production build PASS;
dead-code informativo PASS (51 exports y 15 tipos heredados)**. Pendiente tras fusionar: confirmar el
deploy de Vercel y comprobar que el proyecto de Sentry tiene DSN en Production/Preview; sin DSN los
fallos siguen teniendo fallback y reintento, pero no salen del navegador.

## Incidencia de carga intermitente — corregida y validada (2026-09-15)

Se reprodujo una pestaña del navegador en estado `This page crashed`, mientras una pestaña limpia
contra producción cargó correctamente Dashboard, Unit Economics, Agendas, Integraciones y Ventas
con datos reales y sin errores de consola. Producción también respondió por HTTP durante la
comprobación; no hay evidencia de una caída permanente de Vercel.

Sí se encontró una carrera real en `app/[tenant]/layout.tsx`: el timeout de 12 segundos abortaba la
petición de contrato, pero no las consultas de sesión, tenant, rol, perfil ni branding. Al pulsar
Reintentar, esas operaciones antiguas podían seguir vivas y competir con el intento nuevo. Ahora:

- `auth.getUser()` se espera con cancelación lógica y su resultado tardío se descarta;
- las consultas PostgREST/RPC reciben `AbortSignal` y se cancelan al vencer, reintentar o desmontar;
- ninguna operación cancelada puede escribir estado antiguo;
- el observador que recupera `pointer-events` mantiene un solo timer y lo limpia al desmontar;
- el fetch de branding captura fallos y conserva el fallback local.

Pruebas de regresión añadidas a `tests/loader-sin-cuelgue.test.mjs`. Validación ejecutada sobre el
árbol combinado de Claude + Codex: **format PASS; lint PASS con warnings heredados; typecheck PASS;
general 322/322 PASS; métricas 643/643 PASS; regresión focal 74/74 PASS; Next production build PASS**.
El build solo emitió warnings ya existentes de hooks, `<img>`, trazado de raíz local y la
instrumentación dinámica de Sentry.

## Estado consolidado Codex + Claude Code — 2026-09-15

Fuente revisada: `origin/main` en `e25bf43`. Al iniciar no había PR ni rama remota de trabajo activa;
se continuó en la única rama `codex/stability-observability`.

### Mapa de las 24 tareas

| #   | Tarea                                       | Estado comprobado en Git                                                                                         |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Causa raíz y sistema de carga               | **HECHO EN MAIN** (`78602a8`)                                                                                    |
| 2   | Rol acotado a la subcuenta                  | **HECHO EN MAIN** (`5d7577b`, `91dd890`)                                                                         |
| 3   | Cascada de red: primeras 12 pantallas       | **HECHO EN MAIN** (`5d7577b`, `4679909`)                                                                         |
| 4   | `request_id` en rutas                       | **HECHO EN MAIN** (`1303b6f`)                                                                                    |
| 5   | Limpieza con evidencia                      | **HECHO EN MAIN** (`1303b6f`, `2045026`)                                                                         |
| 6   | Capa de consulta con datos reales           | **HECHO EN MAIN** (`8efb0d2`)                                                                                    |
| 7   | Montar KPI cards, brief y alertas           | **HECHO EN RAMA ACTIVA** (`2cae4e2`)                                                                             |
| 8   | Agendas: respuestas del formulario          | **HECHO EN RAMA ACTIVA** (`eddd936`)                                                                             |
| 9   | Atribución: propagar campaign/UTM           | **HECHO EN RAMA ACTIVA** (`4cf441a`)                                                                             |
| 10  | Cascada de sesión en pantallas restantes    | **HECHO**; solo el layout resuelve `auth.getUser()`                                                              |
| 11  | `any` restantes                             | **PENDIENTE DE AUDITORÍA/CIERRE**; no sustituir por casts inseguros                                              |
| 12  | Medir LCP / INP / CLS reales                | **HECHO EN CÓDIGO**; envío a Sentry condicionado al DSN                                                          |
| 13  | Decidir sobre el 89% de `use client`        | **PENDIENTE DE DECISIÓN ARQUITECTÓNICA**; medir antes de migrar en masa                                          |
| 14  | Rellenar contexto de negocio                | **CÓDIGO HECHO / DATOS PENDIENTES**; tabla/API existen, falta contenido real y confirmar migración en producción |
| 15  | Webhook Stripe y Google Client Secret       | **WEBHOOK HECHO** (`7b15aab`); **ROTACIÓN DE SECRET PENDIENTE DEL USUARIO**                                      |
| 16  | 49.1 agregados puros                        | **HECHO EN MAIN**                                                                                                |
| 17  | 49.2 lectura paginada/tenant                | **HECHO EN MAIN**                                                                                                |
| 18  | 49.3 puente a niveles/dimensiones/objetivos | **HECHO EN MAIN**                                                                                                |
| 19  | 49.4 ruta `/metricas/brief`                 | **HECHO EN MAIN**                                                                                                |
| 20  | 49.5 cuatro huecos declarados               | **3 CERRADOS**: Speed to Lead, BAMFAM y concordancia; LTGP:CAC espera margen bruto real                          |
| 21  | 50.1 cuello de botella + Business Health    | **HECHO EN MAIN Y MONTADO EN RAMA** (`0ee2be7`, `2cae4e2`)                                                       |
| 22  | 50.2 objetivos, previsión y capacidad       | **HECHO EN MAIN Y MONTADO EN RAMA** (`ec3b61f`, `2cae4e2`)                                                       |
| 23  | 50.3 alertas/notificaciones/anotaciones     | **PARCIAL**: motor, panel y Notificaciones cerrados; faltan anotaciones con fecha en los gráficos                |
| 24  | 50.4 Growth Brief inicial del agente        | **HECHO EN RAMA ACTIVA** (`8248749`)                                                                             |

Claude Code puede retomar los puntos 11, 13–15, 20 y 23 cuando se restablezcan sus límites. Antes debe
comprobar si esta rama ya se fusionó y continuar desde `main` si así fuera.

### Bloque Free Tier de Codex

La auditoría y las decisiones completas están en `docs/FREE_TIER_OPERATIONS.md`. Los cambios de
código se mantienen acotados a límites, timeouts, caché segura, pooling documentado y prevención de
builds prescindibles. No se consolidaron crons ni se añadió retención destructiva.

Validación completada antes de publicar este bloque: format PASS; lint PASS con warnings heredados;
typecheck PASS; suite general 322/322 PASS; métricas 643/643 PASS; guardarraíles focales 74/74 PASS;
build de producción PASS.

Última actualización: 2026-09-14 (Claude Code)

## SESIÓN 2026-09-14 (brief de Integraciones/Stripe/Métricas/Funnels) — los 6 bloques cerrados

Rama: `claude/app-continuation-lpbupf`, empujada, árbol limpio. 151 + 198 tests en verde, typecheck,
lint, format y `next build` completo.

El brief tiene 58 secciones agrupables en 6 bloques. **Los seis están cerrados** en todo lo que no
depende de red a proveedores. No hay nada a medias en el árbol.

### Bloque 6 — Data Health cross-source y golden dataset (§48, §53) CERRADO

Data Health ya miraba duplicados y estado por fuente. Lo que faltaba era lo CRUZADO: no "¿la fuente
responde?" sino "¿lo que trajo encaja con el resto?". Cada integración puede estar verde y el
recorrido completo estar roto por la mitad.

`lib/data-health/cross-source.ts` — ocho controles, todos funciones PURAS (reciben los conjuntos ya
leídos), por eso se pueden verificar con un dataset determinista:
cuenta de Meta seleccionada sin datos · cliente de Stripe sin venta registrada · venta sin contacto
válido · cliente sin emparejar · campaña sin nada atribuido · agenda sin contacto · llamada grabada
sin agenda · fuente sin sincronizar.

DOS REGLAS que gobiernan el módulo y que fija el test:

- **Un hueco no es un cero.** Un conjunto que no se pudo leer llega como `null` y el control devuelve
  `desconocido`, nunca "0 problemas". Y el resumen tiene estado `incompleto`, que gana a `ok`: no es
  lo mismo no tener problemas que no haber podido mirar.
- **Nada se arregla solo.** Los controles nombran el problema y dan hasta cinco ejemplos concretos
  para ir a mirarlos. Emparejar un cliente o atribuir una venta es una decisión sobre datos del
  usuario; hay test que impide que un detalle prometa arreglos automáticos.

`tests/metrics/golden-dataset.test.mjs` (§53): universo pequeño y determinista —dos cuentas de Meta,
tres campañas, cuatro contactos, tres clientes de Stripe, tres ventas, tres agendas, dos llamadas—
con los fallos puestos a mano y **cada total contado a mano** en la aserción. Incluye el caso sano
(todo a cero), el caso con conjuntos ilegibles (desconocido, no cero), el umbral de obsolescencia
justo por dentro y justo por fuera, y la fecha ilegible como obsoleta.

Cableado en `/api/[tenant]/evergreen/settings/data-health`. Las consultas extra NO abortan la
respuesta: si una falla, su control dice "no se pudo comprobar" y el resto sigue informando — colapsar
todo a un error dejaría la pantalla en blanco por una tabla.

### Bloque 5 — Stripe (§13-§25) CERRADO en lo que se podía cerrar

DIAGNÓSTICO, que NO era el que parecía. "VENTAS = vacío" y "ALUMNAS = vacío" con Stripe lleno de
clientes no son dos bugs: son un síntoma con UNA causa, y la causa no es el importador.

Alumnas lee `sales`. `sales` no se llena sola desde Stripe porque `product_id` y `payment_plan_id`
son NOT NULL y un pago de Stripe no dice a qué producto interno corresponde ni con qué plan. Crear la
venta automáticamente exigiría elegirlos, y con ellos el importe comisionable y el plazo de
devolución: inventar datos financieros (tercera regla de AGENTS.md). Por eso el flujo es un INFORME
que una persona resuelve, en Integraciones › Stripe.

El fallo real era de producto, no de datos: la pantalla decía "No hay ventas" y "Sin alumnos" a
secas. Quien mira Ventas no tenía forma de saber que hay N clientes de Stripe esperando una decisión
suya, ni a dónde ir. Un hueco sin explicar se lee como "esto está roto" — y así se leyó.

`components/os/StripePendientesAviso.tsx`: cuenta los clientes de Stripe sincronizados (consulta
local, `head: true`, sin llamar a Stripe desde la pantalla), explica por qué no se convierten en
ventas solos y enlaza al buscador de pagos sin registrar. No escribe nada ni adivina ningún producto.
Si la consulta falla no muestra un 0: no muestra el aviso.

LO QUE YA ESTABA BIEN Y NO SE TOCÓ (se verificó, con test que lo fija):

- §18 doble conteo: el clasificador trabaja sobre `PaymentIntent` —un intent es UN flujo económico— y
  `knownReferences` lleva intent id Y charge id, así que un pago no entra como intent, cargo y
  factura. Los estados que no son ingreso están separados por veredicto (`no_es_venta`,
  `reembolsado`, `sin_contacto`), no colapsados.
- §25 paginación: las tres lecturas usan `stripeList`, que pagina con `starting_after`/`has_more` y
  marca `truncated`. El `limit: '100'` es tamaño de página, no tope.
- §14 matching: por relación de proveedor → stripe customer id → email normalizado, nunca por nombre.

LO QUE NO SE PUDO HACER, y es del entorno, no del código: §16, §17, §24, §26, §27 y §54 piden cargar
el histórico real, contar filas y reconciliar con IDs reales. `api.stripe.com` es inalcanzable desde
el entorno del agente y el MCP de Supabase pide reautenticación. **El backfill lo tiene que lanzar el
usuario** desde Integraciones › Stripe › "Buscar pagos sin registrar", eligiendo producto y plan.
Hasta que eso ocurra, Ventas y Alumnas seguirán vacías — ahora diciendo por qué.

### Bloque 4 — funnels visuales (§28-§39, §43-§45) CERRADO

CAUSA RAÍZ de "los funnels acordados siguen sin verse": la capa de datos (`lib/funnels/compute.ts`,
con estado por métrica) y la API (`/api/[tenant]/evergreen/funnels`) ya existían y son buenas. Lo que
no existía era la REPRESENTACIÓN: la pantalla `/funnels` pintaba una tabla, y el embudo de Ads era
`FunnelList`, siete filas de texto. Literalmente "otra lista de KPIs haciendo de funnel".

- `components/os/FunnelChart.tsx` (nuevo): embudo donde el ANCHO de cada barra codifica el volumen,
  centrado, así que la reducción entre etapas se ve. Por etapa: nombre, volumen, % desde la anterior,
  cuántos se caen, y al enfocar también % del total y coste unitario. Distingue loading /
  not_connected / error / partial / sin datos. Tabla equivalente opcional.
- `FunnelList` (embudo de Ads) pasa a llevar barra proporcional por fila, con el MISMO CSS. Para eso
  cada etapa pasa ahora su número crudo además del formateado.
- La pantalla `/funnels` pinta el embudo visual ENCIMA de la tabla; la tabla se queda como detalle
  (coste unitario, fuente, motivo de cada hueco).

UN HUECO NO ES UN CERO: si la fuente de una etapa falló o no está configurada, la barra sale rayada
con el motivo, nunca a 0. Pintar 0 convierte "la integración está caída" en "esta campaña no
convierte".

DECISIONES de las que conviene no volver atrás:

- El color sale de `--primary`, el token que `app/[tenant]/layout.tsx` reescribe según `data-accent`.
  El mismo componente sale rosa en Women Digital Closer y azul en Evergreen sin una línea de color
  por subcuenta. Un solo tono: el ancho ya codifica la magnitud, el color no la duplica.
- NO se instaló `framer-motion` ni `@paper-design/shaders-react` (el ejemplo que mandó el usuario los
  pedía). La animación es CSS: entrada escalonada por fila, 60 ms entre etapas, desactivada con
  `prefers-reduced-motion`. Razón: §43 del propio brief prohíbe glows y gradientes de infografía —un
  fondo animado detrás de datos es ruido— y AGENTS.md prohíbe dependencias sin necesidad real. Hay
  test que impide que esas dependencias entren.
- El bloque propio de `prefers-reduced-motion` es necesario aunque haya una regla global: esa pone la
  duración a 0.001ms pero NO anula `animation-delay`.
- La pantalla `/funnels` tenía su propia copia de los tipos (`StageRow` con `source: string`): ahora
  usa `FunnelResult` del módulo canónico.

### Bloque 3 — filtros de periodo y estado en URL (§4-§6, §51) CERRADO

`lib/filters/period.ts` ya existía y era sano: se EXTENDIÓ, no se reescribió. Presets nuevos `7d`,
`30d`, `90d`, `ytd` y `launch`, con dos distinciones que importan y que fija el test:

- Las ventanas móviles duran exactamente lo que dicen (7d = hoy y los seis anteriores; contar siete
  hacia atrás Y hoy daría ocho días bajo una etiqueta que dice siete).
- `ytd` va del 1 de enero a HOY, mientras `year` llega al 31 de diciembre: con `year`, el rango
  incluye meses que no han pasado y el periodo anterior comparativo se calcula sobre 365 días.
- `launch` acepta la fecha real de arranque; sin ella se queda sin límite inferior (todo lo
  disponible) en vez de inventarse una.

`PeriodFilterBar` recorre `PERIOD_LABELS`, así que los presets nuevos aparecen a la vez en todas las
pantallas que la usan, sin tocarlas una por una.

Estado en URL: `lib/filters/url-state.ts` (PURO, testeable) + `lib/filters/use-url-filters.ts` (el
hook). Cableado en Campañas para `period`, `from`/`to`, `account` y `campaign`. Un filtro en su valor
por defecto no se escribe (la URL limpia sigue limpia), el orden del query es estable (dos pantallas
con los mismos filtros dan el mismo enlace) y un valor inventado a mano cae al predeterminado.
Campañas deriva KPIs, gráficas, funnel y tabla de UN solo `range` — hay test que lo fija contando
las llamadas a `getPeriodRange`.

OUT_OF_SCOPE_FINDING: `app/[tenant]/comisiones/page.tsx` y `app/[tenant]/ventas/registro/page.tsx`
tienen su PROPIA copia de `PeriodPreset`, `PERIOD_LABELS` y cálculo de rango, en vez de usar
`lib/filters/period.ts`. Es el mismo patrón que §5/§39 atacan (mismo filtro, número distinto según la
pantalla). No se tocó: está fuera de lo que pide el brief y merece su propio cambio acotado.

### Bloque 1 — Meta multi-cuenta (§1-§3) CERRADO

Dos bugs reales, reproducidos en test antes de arreglar:

- La selección de cuenta era `<input type="radio">` con `name` compartido, así que solo se podía
  sincronizar UNA cuenta, aunque `resolveMetaConfigs` soportaba varias desde siempre.
- "¿Está seleccionada?" se resolvía con `.includes()` sobre el texto crudo, o sea por substring: con
  `act_12` guardado, `act_123` salía marcada también.

La lista de cuentas vive ahora en `lib/meta/accounts.ts` (sin `node:crypto`, así que la importan
tanto la UI como el servidor; `lib/meta/client.ts` reexporta `parseAccountIds`). Una sola definición
de qué cuentas están seleccionadas para pantalla, sync, crons y filtros.

Ya existía y NO se reescribió: `campaigns.account_id` + índice, el filtro por cuenta en Campañas y
`AdsTable`, y la capa `lib/funnels/`.

### Bloque 2 — estados canónicos y estabilidad Meta/IG (§7-§12) CERRADO

Causa raíz del "a veces CONNECTED y otras ERROR sin cambio real": Meta tiene TRES sincronizaciones y
`assessIntegration` pintaba toda la integración en rojo en cuanto una fallaba. Un límite de
peticiones de la Graph API —reintentable, se arregla solo— mandaba a revisar un token perfecto.

Estado canónico nuevo `parcial` (ámbar), con reglas fijadas por test: todos los fallos reintentables
y alguna sync sana → parcial; cualquier fallo no reintentable → error; todas fallando → error; sin
credenciales → sin configurar. El estado lo sigue calculando UN módulo (`lib/integrations/health.ts`
sobre `lib/ops/sync-health.ts`); §8 ya estaba resuelto y no se tocó. Meta e Instagram ya eran grupos
separados del catálogo, que es el modelado que pide §11.

### BLOQUEO DURO del entorno — afecta a medio brief

Medido, no supuesto: `graph.facebook.com`, `api.stripe.com` y `api.calendly.com` son inalcanzables
desde el entorno del agente, y el MCP de Supabase pide reautenticación. Por tanto es **imposible
desde aquí**: cargar histórico de Stripe (§16, §17, §24), contar filas reales (§26), reconciliar con
IDs reales (§27), medir cobertura por fuente (§46, §47) y la verificación con datos reales de §54 y
§58. El código de esos bloques se puede escribir y probar contra un Stripe simulado; **ejecutarlo
contra el Stripe real lo tiene que lanzar el usuario**, o hace falta un entorno con red.

### Siguiente acción exacta

Bloques pendientes, en este orden (el brief prohíbe abrir varios a la vez): 3. Filtros de periodo globales + estado en URL (§4-§6, §51). 4. Funnels visuales + capa canónica `getFunnel` (§28-§39). Reutilizar `lib/funnels/`, no rehacerla. 5. Stripe canónico: modelo económico, backfill paginado/idempotente/resumible, estados de pago,
alumnas (§13-§25). Código + tests aquí; ejecución real, el usuario. 6. Data Health cross-source (§48) y golden dataset (§53).

### Lo que TE toca a ti

1. **Aplicar las migraciones pendientes, y esto es urgente**: `20260914130000_contacts_identity_uniques.sql`
   y `20260914150000_contacts_get_or_create.sql`. El código ya está en `main` y los webhooks de
   Calendly y GHL llaman a `contacts_get_or_create`; hasta que existan en producción, esos webhooks
   fallan al resolver el contacto y no entran agendas nuevas. Después:
   `20260914120000_tenant_scope_provider_uniques.sql` (puede fallar listando referencias de pago
   duplicadas) y `20260914160000_contacts_email_unique.sql` (puede fallar listando emails a fusionar;
   que falle no deja ningún bug abierto).
2. **Rotar el Google Client Secret** que se pegó en el chat.
3. Borrar la rama remota ya fusionada del PR #40 (el proxy del agente no deja hacer `push --delete`).

---

## SESIÓN 2026-09-14 (cierre) — los tres pendientes de la ultra review + consolidación con Codex

Rama: `claude/app-continuation-lpbupf`, empujada. 336 tests en verde (151 + 185), typecheck, lint,
format, knip y `next build` completo.

### Qué se cerró

1. **Fecha del negocio, no de UTC.** `lib/dates/business.ts` (`businessToday` / `businessYm`,
   Europe/Madrid) aplicado en los crons de recordatorios y reels, la ruta de reels y la creación de
   devoluciones. Entre las 22:00/23:00 y medianoche el servidor seguía en el día anterior: una cuota
   vencía o un borrador contaba en el día que no toca, y el tramo del rep se medía con el mes
   equivocado dos horas al mes (en Nochevieja, con el año equivocado).
2. **`admin/backfill-stripe-sales` acotado a su subcuenta.** Aplica un precio FIJO (1497/1997 según
   la fecha) y busca el producto por nombre: se escribió para la migración puntual de
   `women-digital-closer`. Cualquier admin o director de otra subcuenta podía ejecutarlo y llenarse
   las ventas de importes inventados que encima parecen reales. Ahora hay puerta por slug antes de
   tocar Stripe, con un 400 que apunta al importador correcto, y la respuesta declara la política de
   precio para que quien mire el dryRun no tenga que leer el código.
3. **Carrera de contactos duplicados cerrada.** Ver abajo: había dos soluciones al mismo bug y se
   unificaron.

### Consolidación con el trabajo de Codex (commit `3f0c87c`)

Codex y esta sesión atacaron la misma carrera (los webhooks de Calendly y GHL hacían check-then-insert,
así que dos entregas concurrentes del mismo lead creaban dos contactos y partían su historial). No se
descartó nada: se unificaron en una sola solución.

- **Se conserva de Codex**: las columnas generadas `email_normalized` / `phone_normalized` (una sola
  definición de "mismo email"/"mismo teléfono", en la base de datos) y el UNIQUE parcial sobre
  `(tenant_id, email_normalized)` con su guardián, que lista los duplicados históricos en vez de
  fusionar por su cuenta.
- **Cambia**: el UNIQUE del email pasa a su propia migración y la última
  (`20260914160000_contacts_email_unique.sql`), porque puede no poder crearse todavía; separado, su
  fallo dice exactamente qué fusionar y no bloquea al resto. Se retira el UNIQUE sobre el teléfono
  —un número compartido es legítimo (una pareja, una familia, el fijo de una empresa)— y queda un
  índice no único para el encaje.
- **La atomicidad se resuelve en la base de datos**, no reaccionando al 23505:
  `contacts_get_or_create` (`20260914150000`) serializa la ventana con un advisory lock de
  transacción por clave de identidad (subcuenta + email / teléfono / id de GHL). No necesita datos
  limpios, y cubre también el encaje por teléfono y por id de GHL, que no tienen UNIQUE. Reproducido
  en Postgres 16 local con dos sesiones solapadas: la lógica antigua deja 2 filas, la función 1.
- De paso, una coincidencia ya fusionada sigue el puntero `merged_into` hasta el primario: antes una
  cita nueva de un lead fusionado aterrizaba en el duplicado muerto y volvía a partir el historial
  recién unificado.

### Lo que TE toca a ti (además de lo de la sesión anterior, más abajo)

1. **Aplicar, en este orden**: `20260914120000_tenant_scope_provider_uniques.sql`,
   `20260914130000_contacts_identity_uniques.sql`, `20260914150000_contacts_get_or_create.sql`,
   `20260914160000_contacts_email_unique.sql`.
   - La de `20260914120000` puede fallar listando referencias de pago duplicadas (dinero): hay que
     resolverlas a mano.
   - La de `20260914160000` puede fallar listando contactos que comparten email: se fusionan en
     Configuración → Data Health → "Fusionar duplicados" y se vuelve a aplicar. **Que falle no deja
     el bug abierto**: la carrera ya la cierra `20260914150000`.
2. **Rotar el Google Client Secret** que se pegó en el chat.

### Límite conocido

La normalización del teléfono quita símbolos, no reescribe prefijos: `+34612345678` y `0034612345678`
siguen siendo dos identidades distintas para el encaje. No se toca sin ver datos reales — reescribir
prefijos a ciegas fusiona contactos que no son la misma persona.

---

## SESIÓN 2026-09-14 — barrido de bugs por toda la app

Rama: `claude/app-continuation-lpbupf`. Árbol limpio, todo empujado. 314 tests en verde (138 + 176),
typecheck, lint, format y `next build` completo.

### Lo que se arregló (todo verificado con tests; la BBDD, con dry-run en Postgres 16 local)

| Qué                                  | El fallo real                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Comisiones sin `tenant_id`**       | `lib/commissions/` se quedó fuera de la migración multi-tenant. El insert fallaba SIEMPRE (columna NOT NULL) con el error descartado, y se devolvía el nº de comisiones CALCULADAS: la pantalla decía "3 generadas" con 0 filas escritas. Además las reglas de comisión se leían de TODAS las subcuentas.                       |
| **Escalada de privilegios**          | La RLS de `tenant_members` dejaba a un admin de subcuenta insertar una fila `role='super_admin'` en su propia subcuenta, e `is_super_admin()` no filtra por subcuenta → acceso a todas. Reproducido y cerrado (migración `20260914090000`).                                                                                     |
| **Dos pantallas escribiendo dinero** | "Registrar cobro" y "Registrar devolución" escribían desde el navegador en paralelo a sus rutas, sin tramos, sin atribución por UTM, sin recalcular el nivel del rep y —la de devoluciones— **sin comprobar la ventana de 15 días**. Ahora pasan por la ruta canónica.                                                          |
| **Sumas sobre 1.000 filas**          | PostgREST corta a 1.000 filas sin avisar. El gasto/impresiones del embudo, el cruce de la sync de Meta y el gasto de "sueldo + comisión" del cron mensual se calculaban sobre un trozo. Nuevo `lib/supabase/paginate.ts`.                                                                                                       |
| **Credenciales entre subcuentas**    | `ensureConfig()` volcaba las credenciales en `process.env` (global al proceso, nunca se limpia): en los crons que recorren subcuentas, la segunda heredaba las de la primera. **Eliminado.** Meta, Instagram, YouTube, Calendly, SeQura, Resend, Groq, creatuagente, GHL y la IA reciben ahora su configuración como argumento. |
| **Lo configurado no se usaba**       | Media docena de librerías leían su clave de `process.env`, así que el token guardado en el panel no se usaba nunca (y la tarjeta salía verde igual). Ya no queda ninguna clave del catálogo leyéndose del entorno.                                                                                                              |
| **Transcripción duplicada ×3**       | `transcribeGroq` copiada en tres archivos con tres variantes (una con timeout, dos sin él). Ahora `lib/ai/groq.ts`.                                                                                                                                                                                                             |
| **Llamadas salientes sin timeout**   | Instagram Graph API (paginando en bucle), webhooks de creatuagente y GHL, Groq y descargas de vídeo.                                                                                                                                                                                                                            |
| **Atribución entre subcuentas**      | `users` es global: resolver un utm_term, un email de Calendly o un affiliate_code sin comprobar `tenant_members` atribuía la agenda —y su comisión— a alguien de otra subcuenta.                                                                                                                                                |
| **PII a la IA**                      | `ai/invoice` y `tasks/from-transcript` mandaban al modelo los nombres de TODOS los usuarios de la plataforma.                                                                                                                                                                                                                   |

### Lo que TE toca a ti

1. **Aplicar dos migraciones**: `20260913190000_integration_sync_runs.sql` (historial de ejecuciones) y
   `20260914090000_block_super_admin_self_grant.sql` (cierra la escalada de privilegios). La segunda
   es de seguridad: hasta que se aplique, el agujero sigue abierto en producción.
2. Meta e Instagram: **Comprobar** y **Cargar histórico** en Integraciones, y mirar el historial de
   ejecuciones (ahora sí guarda el motivo de cada fallo).

### Lo que queda pendiente, a propósito y documentado

- **Sin verificar contra proveedores reales**: `graph.facebook.com` está bloqueado desde el entorno
  del agente y el MCP de Supabase pide reautenticación. Todo lo de arriba está `inspeccionado` y
  `probado` (tests + dry-run de SQL en Postgres local), **no `verificado` en producción**.
- `CALENDLY_WEBHOOK_SECRET` y `GHL_WEBHOOK_SECRET` (verificación de webhooks ENTRANTES) siguen
  leyéndose del entorno del despliegue: cambiarlo mal deja de aceptar webhooks y para las agendas, así
  que no se ha tocado sin poder probarlo contra los proveedores.
- `GOOGLE_API_KEY`, `IG_BUSINESS_CONTEXT`, `IG_BRAND_ASSETS`, `ONBOARDING_*` y `TRACKING_INGEST_KEY`
  siguen igual (mismo motivo: nadie las ha reportado como rotas y no se pueden probar aquí).
- Stripe no tiene cron: la sync de clientes se lanza a mano desde Integraciones. Programarla es una
  decisión tuya (ocupa un slot de cron de Vercel Hobby).
- Quedan 67 avisos de `react-hooks/exhaustive-deps`. Se revisaron: son `tenant`/`tenantId`, que vienen
  del contexto y no cambian mientras la página vive. Tocarlos es churn con riesgo y sin beneficio.
- Algunas proyecciones (`commissions/future`, algunas pantallas de Analítica) siguen sin paginar. No
  escriben nada y su volumen hoy está lejos de 1.000 filas; quedan anotadas, no arregladas.

---

## CIERRE DE SESIÓN 2026-09-13 — estado real y qué decide quién

Rama: `claude/financial-constraints-handoff` (PR #30). Árbol limpio, todo empujado, CI verde en cada
commit. Nada quedó a medias: la fase J no se empezó **a propósito**, porque va en PR aparte.

### Fases del brief

| Fase | Qué                                    | Estado                                       |
| ---- | -------------------------------------- | -------------------------------------------- |
| A    | Desbloquear #30                        | ✅ migraciones aplicadas, historial reparado |
| B    | UX de Configuración                    | ✅                                           |
| C    | Capa canónica de funnels               | ✅                                           |
| D    | GA4 (OAuth + sync)                     | ✅ código; **sin ejecutar contra Google**    |
| E    | Sección Funnels                        | ✅                                           |
| F    | CRM → Agenda, ficha, Fathom            | ✅                                           |
| G    | Grabaciones (testimonios ya existía)   | ✅                                           |
| H    | Facturas por Gmail                     | ✅ código; **sin ejecutar contra Gmail**     |
| I    | Stripe (informe) y diagnóstico de Meta | ✅                                           |
| J    | Aprovisionador de subcuentas           | ✅ MVP, en rama aparte (ver abajo)           |

### Dos ramas, no una

- `claude/financial-constraints-handoff` → **PR #30** (abierto, CI verde, sin conflictos). Fases A-I,
  más dos cosas añadidas después de cerrarlo la primera vez: la pantalla que resuelve la cola de
  Fathom (CRM › Llamadas sin atribuir) y el mapeo de eventos de landing/VSL (`/funnels/eventos`), que
  era el único bloqueo que quedaba en Funnels y no necesitaba ninguna decisión tuya.
- `claude/app-continuation-lpbupf` → **fase J**, sin PR abierto todavía. Sale de la punta de #30
  porque depende de los únicos por subcuenta sobre `slug` que van ahí: sin ellos, cada subcuenta nueva
  chocaría en los slugs naturales. Fusionar #30 primero.

### Lo que NO está verificado, y hay que saberlo antes de fusionar

Ninguna pantalla nueva se ha abierto con una sesión real y datos, y ninguna integración se ha
ejecutado contra su API. En este entorno no hay credenciales de la app (solo acceso administrativo
por MCP a Supabase). Lo que sí está probado: la lógica pura con tests, y el comportamiento de cada
tabla contra Postgres real vía dry-run.

En concreto siguen sin probar de punta a punta: el flujo OAuth de Google, el sync de GA4, el buzón de
Gmail, el informe de Stripe, la subida de grabaciones (usa `crypto.subtle`) y la pantalla de Funnels.

### Decisiones que son del usuario, no mías

1. **Rotar el Client Secret de Google.** Se pegó en un chat, así que ya no es secreto. Generar uno
   nuevo y pegarlo en Configuración → Integraciones → Google (ahí se cifra). No lo guardé yo porque
   `CONFIG_ENC_KEY` es un placeholder en este entorno y habría quedado ilegible para la app.
2. **Frecuencia de Meta.** Los crons ya están programados en `vercel.json`, pero a diario. Para
   recuperar los 30 minutos del diseño original: habilitar `pg_cron` + `pg_net` en producción, o
   pagar Vercel Pro. Ninguna la decido yo. Ver `DIAGNOSTICO_SINCRONIZACIONES.md`.
3. **`reels` y `youtube-backfill`** siguen sin programar a propósito: una genera borradores que hay
   que revisar, la otra consume cupo de la API de YouTube.
4. **Registrar en lote los pagos `registrable`** del informe de Stripe. Requiere asignar producto y
   plan de pago, y eso escribe en la tabla de la que salen facturación y comisiones.
5. **Pantalla para resolver `fathom_match_review`.** Los casos dudosos se anotan bien; resolverlos hoy
   requiere tocar la tabla a mano. Deliberadamente no construí una pantalla vacía.
6. **Mapeo de eventos de landing/VSL.** `canonical_events.event_name` es texto libre. Hay que listar
   los nombres que llegan de verdad y que el usuario diga cuál es cada etapa. **No inventar un
   vocabulario**: esas etapas de Funnels salen hoy como "fuente sin configurar", que es la verdad.

### Disciplina que conviene mantener

Once migraciones aplicadas hoy, **cada una con dry-run previo** (`BEGIN`/`ROLLBACK` probando el
COMPORTAMIENTO, no solo que la DDL compile) y verificación posterior. Varias cazaron fallos reales
antes de tocar producción: un mensaje de error mal formado, un id de destino nulo, un unique que
habría sido global. No aplicar migraciones sin ese paso.

Y la regla que atraviesa todo lo de hoy: **un hueco no es un cero**. Un fallo de fuente, una fuente
sin configurar y un cero medido son tres cosas distintas, y la UI tiene que distinguirlas.

## Qué se está haciendo ahora y qué sigue (2026-09-13)

**La hoja de ruta viva está en `docs/ROADMAP_MVP.md`.** Ahí está el estado de cada fase, las
decisiones ya tomadas por el usuario y lo que sigue bloqueado esperándole. Criterio acordado:
**MVP funcional de todo antes que una sola cosa perfecta**, con el avance reportado en cada PR.

Avance de esta sesión, todo sobre `claude/financial-constraints-handoff` (PR #30):

| Commit    | Qué                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `8e20a44` | P0: `cron/monthly` dejaba a una sesión escribir gastos en TODAS las subcuentas + tests de aislamiento |
| `f4f028a` | Fase B de UX: Configuración a un solo nivel, negocio fuera de Integraciones, Auditoría dentro         |
| (este)    | Fase C: capa canónica `lib/funnels/` con tests, sin UI todavía                                        |

**Próximo paso para quien recoja el relevo (Codex incluido):** fase J — el aprovisionador de
subcuentas, **en PR aparte** como pidió el usuario. Ojo con un fallo que ya bloqueaba esto y se
corrigió hoy: tres tablas tenían un único GLOBAL sobre `slug`, así que cada subcuenta nueva chocaba
con los slugs de las demás. Ver `ROADMAP_MVP.md` §3.3.

Pendiente que NO es código y necesita decisión del usuario: pantalla para registrar en lote los pagos
`registrable` del informe de Stripe (asignando producto y plan), habilitar `pg_cron` + `pg_net` si se
quiere la frecuencia original de Meta, y rotar el Client Secret de Google.

Lo aplicado hoy en producción son **once migraciones**, cada una con dry-run previo
(`BEGIN`/`ROLLBACK` probando el COMPORTAMIENTO, no solo que la DDL compile) y verificación posterior.
Mantén esa disciplina: varias cazaron fallos reales antes de tocar nada.

Antes de eso, si hay tiempo: la **pantalla para resolver la cola `fathom_match_review`**. El sync ya
anota los casos dudosos correctamente, pero resolverlos hoy requiere tocar la tabla a mano.

Si tocas el sync de Fathom: la decisión de emparejamiento NO va ahí, va en `lib/fathom/match.ts`
(función pura, 10 tests). **Nunca escribas una transcripción en más de una cita**: eso es lo que
hacía antes y duplicaba llamadas. Ver `ROADMAP_MVP.md` §3.2.

Si vas a tocar Funnels: lee antes `ROADMAP_MVP.md` §3.1, que dice exactamente qué etapas tienen
datos reales y cuáles salen como "fuente sin configurar" y por qué. **No inventes nombres de evento
para `canonical_events`**: es texto libre y el mapeo tiene que elegirlo el usuario.

Regla que no se negocia en nada de esto: una métrica **nunca** colapsa a 0 por un fallo de fuente.
`lib/funnels/types.ts` distingue `ok` / `sin_datos` / `error_fuente`, y la UI tiene que distinguir
los tres. Los tests de `tests/metrics/funnels.test.mjs` lo fijan.

## Estado canónico (2026-09-13)

- **PR #30 ABIERTO y NO fusionable todavía.** Rama activa: `claude/financial-constraints-handoff`.
- **PR #29 ya fusionado** en `main` (`b6809b5`).
- Trabajo en curso sobre los P0/P1 de la revisión de #30. Ver "Pendientes bloqueantes" al final.

### Corrección de una afirmación errónea que estaba en este documento

Se afirmó aquí y en varios commits que **el plan Hobby de Vercel "solo permite 3 crons"** y que por
eso no se registraban los dos jobs de IA. **Eso era falso** y llevó a construir un panel manual como
sustituto de algo que sí se podía programar. Los dos jobs ya están en `vercel.json` con horarios
separados (04:00 y 05:00 UTC).

Lo que sí está verificado del proyecto real, y lo que no:

| Dato                                  | Estado                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| Plan del equipo                       | VERIFICADO: `hobby` (vía `list_teams`)                              |
| Logs de runtime (24h)                 | VERIFICADO: 99× 200 y 1× 502. **Ningún 504** entre los principales  |
| Nº máximo de crons del plan           | NO VERIFICADO — las herramientas de doc no devuelven esa tabla      |
| Fluid Compute activo/inactivo         | NO VERIFICADO — no expuesto por las herramientas disponibles        |
| Límite efectivo de `maxDuration`      | NO VERIFICADO — 60s es un valor conservador, no un techo medido     |
| `CRON_SECRET` en Production y Preview | NO VERIFICADO — no hay herramienta para listar variables de entorno |

`maxDuration` se deja en 60s por prudencia: el bucle se autolimita por presupuesto de tiempo y
reporta cuántas llamadas quedan, así que un techo mayor solo haría que cada pasada avance más,
nunca que se corte a medias.

## Estado canónico (2026-09-13)

- **PR #30 ABIERTO y NO fusionable todavía.** Rama activa: `claude/financial-constraints-handoff`.
- **PR #29 ya fusionado** en `main` (`b6809b5`).
- Trabajo en curso sobre los P0/P1 de la revisión de #30. Ver "Pendientes bloqueantes" al final.

### Corrección de una afirmación errónea que estaba en este documento

Se afirmó aquí y en varios commits que **el plan Hobby de Vercel "solo permite 3 crons"** y que por
eso no se registraban los dos jobs de IA. **Eso era falso** y llevó a construir un panel manual como
sustituto de algo que sí se podía programar. Los dos jobs ya están en `vercel.json` con horarios
separados (04:00 y 05:00 UTC).

Lo que sí está verificado del proyecto real, y lo que no:

| Dato                                  | Estado                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| Plan del equipo                       | VERIFICADO: `hobby` (vía `list_teams`)                              |
| Logs de runtime (24h)                 | VERIFICADO: 99× 200 y 1× 502. **Ningún 504** entre los principales  |
| Nº máximo de crons del plan           | NO VERIFICADO — las herramientas de doc no devuelven esa tabla      |
| Fluid Compute activo/inactivo         | NO VERIFICADO — no expuesto por las herramientas disponibles        |
| Límite efectivo de `maxDuration`      | NO VERIFICADO — 60s es un valor conservador, no un techo medido     |
| `CRON_SECRET` en Production y Preview | NO VERIFICADO — no hay herramienta para listar variables de entorno |

`maxDuration` se deja en 60s por prudencia: el bucle se autolimita por presupuesto de tiempo y
reporta cuántas llamadas quedan, así que un techo mayor solo haría que cada pasada avance más,
nunca que se corte a medias.

## Estado canónico

- Rama fuente de verdad: `main`
- Último commit en `main`: `b6809b5` — relevo + consistencia visual en Anuncios + agente de IA MVP y fase 2 (#29, mergeada).
- CI de `main`: verde.
- Despliegue de Vercel: `https://growth-ops-weld.vercel.app` (proyecto `growth-ops`, team `app-b1af`).
- PR abiertos al redactar este relevo: ninguno. Después de mergear #29 se aplicó además, directamente sobre Supabase (sin PR de código porque la migración ya estaba en el repo desde antes, solo no aplicada): `financial_integrity_constraints`.

## Hecho en esta sesión (Claude Code, con acceso real a Supabase MCP)

1. **Corregido el bloqueo de migraciones** que dejó el relevo anterior: las 4 migraciones señaladas (`stripe_customers`, `contact_merge`, `fathom_meeting_id`, `campaign_targets`) fueron VERIFICADAS ausentes en el proyecto Supabase real (`rgcbveflosqgxrcqlqzv`) y APLICADAS ahí mismo (son aditivas: `CREATE TABLE`/`ADD COLUMN IF NOT EXISTS`, sin riesgo de pérdida de datos; dependían solo de funciones/tablas ya presentes — `is_admin_or_director`, `get_my_role`, `auth_tenant_ids`, `is_super_admin`, `handle_updated_at`, `tenants` — verificadas antes de aplicar). VERIFICADO tras aplicar: las 3 tablas y la columna existen; `get_advisors` (security) no muestra hallazgos nuevos atribuibles a este cambio (solo warnings preexistentes: `merge_contacts` con search_path mutable — mismo patrón que otras funciones ya en el proyecto, no se corrigió, `OUT_OF_SCOPE_FINDING`).
2. **Ampliado el diagnóstico de drift real**: `list_migrations` de Supabase solo registra 7 migraciones aplicadas de las 20 que hay en `supabase/migrations/`. Las 14 restantes están en dos categorías distintas — no asumir que "no está en el historial" = "no está en el esquema":
   - **DRIFT (probablemente ya aplicadas fuera de tracking)**: `fix_rls_p0`, `fix_rls_p0_round2`, `multi_tenant_foundation`, `multi_tenant_domain_tables`, `fix_cron_unique_constraints`, `tenant_scope_singleton_constraints`, `tenant_scope_users_rls`. Verificado parcialmente: `contacts.tenant_id` existe, `auth_tenant_ids()`/`is_admin_or_director()` existen, `contacts` tiene 3 políticas RLS. **NO se verificó exhaustivamente cada una** — sigue siendo `NOT_VERIFIED` a nivel de detalle (constraints exactos, políticas INSERT/UPDATE/DELETE completas por tabla).
   - **`financial_integrity_constraints` — APLICADA y VALIDADA** (tras el hallazgo de arriba): es 100% aditiva (índices + `ADD CONSTRAINT ... NOT VALID`), verificado antes de aplicar que `expenses.status`/`campaigns.status` no tenían ningún valor fuera de lista (`SELECT DISTINCT ... WHERE status NOT IN (...)` → 0 filas en ambas), así que los dos CHECK se validaron (`VALIDATE CONSTRAINT`) en el mismo paso, no se dejaron `NOT VALID` indefinidamente. `get_advisors` (security) sin hallazgos nuevos.
   - **`drop_partners` — EJECUTADA con confirmación explícita del usuario ("Si bórrala...")**: `DROP TABLE IF EXISTS public.partners;` aplicado en Supabase real. Las 3 filas que tenía (Adrián Martínez 55%, Alex 30%, Jesús Peña 15%) se perdieron de forma irreversible, tal y como se advirtió antes de ejecutar. El mismo mensaje del usuario pidió explícitamente **recrear** un lugar para gestionar socios y su % de beneficios — ver punto 7 más abajo.
3. **Backfill de ventas de Stripe (women-digital-closer)** — se resolvió el motivo por el que nunca pudo ejecutarse:
   - **Tenant correcto identificado**: es `women-digital-closer`, no `evergreen` — Claudia Martínez (`claudia.martinezf.03@gmail.com`) es miembro de `women-digital-closer`, y ese tenant no tenía NINGÚN producto.
   - **Producto creado**: `products` (`id=abbf35fa-586f-4053-a8b5-4e54f2469510`, `name='Women Digital Closer'`, `tenant_id='74c7fab3-7ea6-47ed-a8d3-97f839bab3b2'`) — nombre dado explícitamente por el usuario en esta misma sesión, no inventado.
   - **Stripe ya está configurado** para ese tenant (`integration_settings` tiene `STRIPE_SECRET_KEY` con valor, cifrado — no se leyó ni se puede leer el valor real desde SQL).
   - **`stripe_customers` sigue vacía (0 filas)** para ese tenant: el sync "Sincronizar clientes" (Integraciones → Stripe) nunca se ha ejecutado — ahora que la tabla existe, ya puede correr.
4. **PR #26, #27, #28 mergeadas** (seguridad Dependabot/Next 15, objetivos ROAS/CAC/CPL, rediseño visual de Campañas). Ver detalle en los commits de `main`.
5. **MVP del agente de IA empresarial (chat flotante)** — en PR #29, sin fusionar todavía:
   - Auditoría previa (read-only) confirmó: no existía vector store/pgvector, no había proveedor de IA abstraído (solo `@anthropic-ai/sdk` directo en `lib/ai/claude.ts` y `lib/setting-ai/core.ts`, modelos hardcodeados), no había registry de tools MCP, `canonical_events`/`analytics_*` ya existían (vacías), cron/jobs vía Vercel Cron + `pg_cron` ya existían.
   - Migración `ai_agent` (aplicada ya en Supabase real): `ai_conversations`, `ai_messages`, `ai_tool_calls`. RLS: conversación privada del usuario (`user_id = auth.uid()`) + aislamiento por tenant.
   - `lib/ai/agent/tools.ts`: 7 tools de solo lectura reutilizando cálculos canónicos existentes (`lib/ads/funnel.ts`, `lib/contact-timeline.ts`, `isActiveSale`) — nada de SQL libre ni cálculo manual de métricas por el LLM.
   - `lib/ai/agent/gateway.ts`: bucle de tool-use de Claude (máx. 4 rondas), reglas explícitas anti-alucinación/anti-injection/anti-fuga-entre-tenants en el system prompt.
   - `app/api/[tenant]/evergreen/ai/agent/route.ts`: usa el cliente AUTENTICADO del usuario (no service role) — el aislamiento lo aplican las RLS ya existentes de cada tabla de negocio, no una capa nueva.
   - `components/ai/AgentLauncher.tsx`: launcher + panel flotante (desktop) / sheet a pantalla completa (mobile), montado en `app/[tenant]/layout.tsx`.
   - **NOT_VERIFIED**: no se ha probado en navegador real (login, preguntar algo, comprobar aislamiento cruzado WDC↔Evergreen con dos usuarios reales) — sin entorno de browser en esta sesión. Antes de dar el agente por "funcionando", alguien con acceso real debe: (a) abrir el chat en cada tenant y confirmar que responde con datos de ESE tenant, (b) intentar explícitamente pedir datos del otro tenant y confirmar que se deniega, (c) revisar `ai_tool_calls` para confirmar que el log de auditoría se está poblando.
   - **Deliberadamente fuera de este MVP** (fase 3 explícita del propio brief, no descuido): RAG/pgvector + Knowledge Base de documentos, integración Google Drive, routing multi-proveedor (Gemini/DeepSeek — hoy solo hay credenciales de Anthropic), streaming de respuesta, acciones de escritura, cost dashboard/budgets, evals de seguridad (prompt injection, cross-tenant) automatizados.
6. **Fase 2 del agente de IA** (misma PR #29) — arquitectura híbrida RAG+Data+Memory+Proactive pedida por el usuario, implementada en la parte de mayor apalancamiento que no depende de RAG:
   - Descubierto al auditar: `analyzeCall()` (`lib/ai/claude.ts`) existía como código pero nunca se ejecutaba — 0 de 555 citas tenían `ai_analysis` pese a que 62 tienen transcripción. Nuevo cron `cron/analyze-calls` lo rellena en lotes de 15.
   - `lib/ai/metrics/registry.ts`: capa semántica de negocio (definición/fórmula/fuente de cada métrica canónica), consultable por tool `getMetricDefinition`.
   - Root Cause Analysis determinista: `analyzeFunnelChange`/`comparePeriods` descomponen el funnel entre dos periodos y señalan la etapa con mayor cambio — el system prompt obliga a usarlas antes de explicar por qué cambió una métrica agregada.
   - Voice of Customer / Sales Intelligence agregados: `getTopObjections`/`compareClosers`, sobre `ai_analysis` ya poblado — sin nueva llamada al LLM por consulta.
   - Memoria de negocio explícita: tabla `ai_business_facts` (hechos/hipótesis/decisiones/resultados, `outcome_of` enlaza DECISION→OUTCOME) — solo se escribe cuando el usuario confirma el hecho en su propio mensaje (regla de system prompt, no automática).
   - Insights proactivos deterministas: tabla `ai_insights` + `lib/ai/insights/detectors.ts` + cron `cron/ai-insights` — compara 7 días vs 7 anteriores con umbrales fijos (CAC +25%, ROAS -20%, show/close rate -15%). El LLM NUNCA corre en bucle vigilando el negocio; el resumen se redacta con plantilla de datos exactos. Dedup por fingerprint (tenant+tipo+semana).
   - **`cron/analyze-calls` y `cron/ai-insights` NO están en `vercel.json`** — el plan de Vercel es Hobby y ya hay 3 crons registrados; añadir más podría romper el despliegue. Hay que dispararlos manualmente con `CRON_SECRET` o configurarlos vía `pg_cron` de Supabase (mismo patrón que "Auto 30 min" de Meta) — **decisión pendiente de alguien con acceso a Vercel para confirmar el límite real del plan**.
   - **Fuera de esta fase 2** (fase 3 explícita): RAG/pgvector, Google Drive/Notion, Business Graph como grafo explícito, Creative Intelligence, Experiment Engine, Model Router multi-proveedor, Daily Executive Brief, Insight Feed completo (solo hay un indicador ligero en el chat), Business Health Score.
7. **Recreada la gestión de socios y % de beneficios** (tras ejecutar `drop_partners`, a petición explícita del usuario en el mismo mensaje de confirmación): migración `partners` (aplicada ya en Supabase real, tabla limpia — sin el `user_id` opcional sin uso que tenía la original), RLS estándar (`partners_admin_write` con `is_admin_or_director()`, `partners_select_team` con `get_my_role() IS NOT NULL`, aislamiento `RESTRICTIVE` multi-tenant). Página `app/[tenant]/settings/socios/page.tsx` (añadir/activar/desactivar/eliminar socio con nombre + % + notas, con aviso visual si el total de % activos supera 100%), con entrada nueva en el índice de settings. `get_advisors` (security) sin hallazgos nuevos atribuibles a este cambio. `typecheck`/`lint`/`next build` en limpio. Commit `016c8e5` en `claude/financial-constraints-handoff` (mismo PR #30, sin abrir rama nueva).

8. **Verificación integral post-implementación del agente de IA + cierre de huecos** (PR #30). Lo que se VERIFICÓ de verdad (código + Supabase real + Vercel): aislamiento por tenant correcto (RLS `own-user` + `RESTRICTIVE` por tenant en las 5 tablas `ai_*` y en `partners`; `ai_messages.tenant_id` nunca difiere del de su conversación — 0 filas); las tools reciben el `tenant_id` resuelto en servidor, nunca del modelo; sin SQL libre; métricas reutilizando `lib/ads/funnel.ts`/`lib/analytics.ts` (cero fórmulas propias); sin duplicados reales en `contacts`/`sales`/`appointments` (el único "duplicado" de agenda era un reschedule legítimo: dos `external_id` distintos de Calendly, uno cancelado); `appointments_tenant_external_id_key` activo (existe como UNIQUE INDEX, no como constraint — `pg_constraint` no lo ve, `pg_indexes` sí); SHA de producción de Vercel = HEAD de `main`.
   - **Bug real encontrado y corregido**: ni `cron/analyze-calls` ni `cron/ai-insights` tenían forma de ejecutarse en producción (no están en `vercel.json`, no hay `pg_cron` — el esquema `cron` no existe en el proyecto — y solo aceptaban `CRON_SECRET`). Resultado medido: 0 de 62 transcripciones analizadas y `ai_insights` vacía, así que `getTopObjections`/`compareClosers`/`getRecentInsights` no tenían nada que devolver. Ahora ambas rutas aceptan sesión de admin/director y hay un panel **Motor de IA** en `settings/data-health` para lanzarlos y ver cuántas llamadas quedan.
   - **Plan de Vercel confirmado `hobby`** (vía `list_teams`): por eso NO se añaden crons a `vercel.json` (ya tiene 3) y por eso `analyze-calls` baja de `maxDuration` 120s → 60s, con el bucle autolimitado por presupuesto de tiempo (45s) — antes pedía una ventana que el plan no concede y el lote de 15 llamadas se cortaba a medias.
   - **Bug real corregido**: el badge de insights del launcher contaba los de `status='new'` y nada los marcaba nunca como vistos → el aviso se quedaba clavado para siempre. Nuevo `PATCH` en la ruta del agente + marcado al abrir el panel.
   - **Tracking de coste, que no existía**: migración `ai_usage_tracking` (aplicada en Supabase real) añade modelo, tokens de entrada/salida/caché, `cost_usd` y `latency_ms` a `ai_messages`, y ahora sí se rellena `ai_tool_calls.latency_ms`. Tarifas centralizadas en `lib/ai/pricing.ts` (Sonnet 5 $2/$10, Haiku 4.5 $1/$5 por millón, verificadas en la doc oficial); `cost_usd` queda NULL si el modelo no está tarifado, en vez de falsear un 0.
   - **NO verificado** (sin navegador ni credenciales reales en la sesión): respuestas del agente end-to-end, aislamiento cruzado WDC↔Evergreen con dos sesiones reales, UI en móvil, accesibilidad, y fallback de proveedor. `.env.local` del repo son **placeholders** (`placeholder.supabase.co`), no credenciales: el acceso real a producción desde la sesión es solo SQL vía MCP.
   - **Bloqueado por credenciales, no por código**: RAG/Knowledge Base necesita un proveedor de _embeddings_ (Anthropic no ofrece embeddings API; no hay claves de Voyage/OpenAI en el proyecto) y el Model Router multi-proveedor necesita más de un proveedor configurado. Mientras eso no exista, media fase 3 no se puede construir de forma honesta.

## Bloqueo actual (lo único que impide terminar el backfill de Stripe)

Los dos endpoints que faltan ejecutar (`POST .../settings/integraciones/stripe-customers` y `POST .../admin/backfill-stripe-sales`) exigen una sesión de Supabase Auth real de un usuario admin/director de `women-digital-closer` (`requireTenant` lee la cookie de sesión). Claude Code no tiene esas credenciales ni debe tenerlas — es una decisión de acceso, no técnica.

## Próxima acción exacta

1. Un admin/director de `women-digital-closer`, logueado en `https://growth-ops-weld.vercel.app/women-digital-closer/...`, abre la consola del navegador y ejecuta, en este orden:
   ```js
   // 1) Sincroniza clientes de Stripe (rellena stripe_customers)
   await fetch('/api/women-digital-closer/evergreen/settings/integraciones/stripe-customers', { method: 'POST' }).then(
     (r) => r.json()
   )

   // 2) Preview del backfill (dryRun por defecto — no escribe nada)
   await fetch('/api/women-digital-closer/evergreen/admin/backfill-stripe-sales', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ ownerEmail: 'claudia.martinezf.03@gmail.com', dryRun: true }),
   }).then((r) => r.json())

   // 3) Solo si el preview del paso 2 es correcto: ejecuta de verdad
   await fetch('/api/women-digital-closer/evergreen/admin/backfill-stripe-sales', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ ownerEmail: 'claudia.martinezf.03@gmail.com', dryRun: false }),
   }).then((r) => r.json())
   ```
2. ~~Confirmar `drop_partners`~~ — hecho: ejecutado y la funcionalidad de socios recreada (punto 7 arriba). Falta: confirmar CI de PR #30 en verde y mergear cuando el usuario lo indique.
3. ~~Verificar en detalle el resto del drift de RLS~~ — **HECHO y PASS**. Verificado por SQL contra la base real, no por nombre de migración: de TODAS las tablas con `tenant_id`, ninguna tiene RLS desactivada y ninguna carece de política de aislamiento por tenant salvo `tenant_members`, que es correcta por diseño (no puede usar `auth_tenant_ids()` porque esa función lee de ella misma — recursión infinita; su escritura exige `is_tenant_admin(tenant_id)` en `USING` **y** `WITH CHECK`, así que no hay camino de auto-escalada a otro tenant, y el `SELECT` es `user_id = auth.uid() OR is_tenant_admin(tenant_id)`). Además: 0 filas con `tenant_id` NULL en las 8 tablas de negocio core (`contacts`, `sales`, `appointments`, `campaigns`, `collections`, `commissions`, `expenses`, `contact_attributions`). El multi-tenant se puede declarar cerrado a nivel de RLS.
4. ~~Auditoría de atribución a nivel de `campaign_ads`~~ — **no hay nada que auditar todavía**: `campaign_ads` tiene 0 filas. Ver el punto siguiente.
   4b. **BLOQUEANTE DE PRODUCTO (no de código): media base de datos está vacía.** Recuento real: `contacts` 943, `appointments` 555 (62 con transcripción) — pero `sales` 0, `collections` 0, `campaigns` 0, `contact_attributions` 0, `campaign_ads` 0, `campaign_daily` 0. Consecuencias medidas, no teóricas:
   - Todas las preguntas de dinero al agente (ingresos, ROAS, CAC, CPL, rendimiento por campaña, close rate) no tienen datos detrás. Mitigado en código para que no mienta (tool `getDataCoverage` + `aviso_datos` + regla de system prompt: un 0 de fuente vacía nunca se presenta como resultado del negocio), pero el dato sigue sin existir.
   - `detectAnomalies` NO puede generar ningún insight: cada umbral necesita CAC/ROAS/show rate/close rate, y todos derivan de `campaigns` y `sales`. Con ambas vacías, siempre devuelve 0 anomalías. Por eso `ai_insights` está vacía — no es un fallo del detector.
   - Lo que desbloquea esto es exactamente el backfill de Stripe (puebla `sales`/`collections`) y la sincronización de Meta Ads (puebla `campaigns`). Hasta entonces, el agente solo puede responder de verdad sobre contactos, citas y transcripciones.
5. Smoke test real del agente de IA (ver punto 5 de "Hecho en esta sesión") antes de anunciarlo a los usuarios finales — sigue `NOT_VERIFIED`.
6. Decidir cómo disparar `cron/analyze-calls` y `cron/ai-insights` (no están en `vercel.json` por el límite del plan Hobby de Vercel) — probablemente vía `pg_cron` de Supabase, igual que "Auto 30 min" de Meta.
7. Fase 3 del agente de IA (si las fases 1-2 se validan bien): RAG/pgvector para Knowledge Base de documentos, Google Drive/Notion, Model Router multi-proveedor — todo con su propia auditoría antes de implementar, igual que se hizo para las fases anteriores.

## Regla de continuidad

Si existe un único PR o rama activa, continuar allí. No crear una segunda rama. Si el trabajo está validado, fusionarlo a `main`, verificar CI/despliegue y eliminar la rama antes de cerrar la sesión. Al cierre de esta sesión no queda ninguna rama `claude/*` activa sin fusionar.

## Pendientes bloqueantes de PR #30 (2026-09-13)

Requieren acción tuya, no son cosas que pueda cerrar solo:

1. **Aplicar dos migraciones nuevas** (el MCP de Supabase pide reautenticación, no he podido):
   - `20260913100000_storage_tenant_policies.sql` — buckets privados + políticas por `tenant_id/`.
   - `20260913110000_partners_profit_guard.sql` — trigger del 100% + `WITH CHECK` explícito.
2. **Reparar el historial de migraciones** — plan completo y verificado en
   `docs/MIGRATION_RECONCILIATION.md`. No ejecutado: espera confirmación explícita.
3. **Decidir sobre el shader WebGL**: separarlo a su propio PR, o mantenerlo aquí añadiendo
   fallback sin WebGL, control real de reduced-motion y pruebas en iOS/Safari/móvil.

Pendiente de trabajo mío, no bloqueado: el aprovisionador de subcuentas en un clic
(`/platform/tenants` + `POST /api/platform/tenants` + blueprint versionado), que va en **PR aparte**
una vez cerrados los P0 de #30.
