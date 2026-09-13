# Diagnóstico: por qué Meta nunca ha sincronizado

Fecha: 2026-09-13. Todo lo de aquí está **verificado contra el proyecto real**, no deducido.

## El síntoma

`campaigns` = 0 filas. `campaign_daily` = 0 filas. Y sin embargo hay **4 claves de Meta
configuradas** en `integration_settings`. Así que no era falta de credenciales.

## La causa raíz

Las rutas de sincronización de Meta existen y están escritas
(`cron/meta`, `cron/meta-daily`, `cron/meta-ads`), pero **nadie las ejecutaba**:

| Comprobación               | Resultado                                             |
| -------------------------- | ----------------------------------------------------- |
| ¿Están en `vercel.json`?   | **No.** Solo había 5 crons y ninguno era de Meta      |
| ¿Está `pg_cron` instalada? | **No.** Disponible en el catálogo, pero sin habilitar |
| ¿Está `pg_net` instalada?  | **No.** Sin ella, pg_cron no puede llamar por HTTP    |
| ¿Existe el esquema `cron`? | **No**                                                |

Los comentarios del código explican el origen del malentendido: se diseñaron para dispararse desde
Supabase `pg_cron` ("Vercel es Hobby = solo crons diarios"), y esa mitad del trabajo nunca se hizo.

**No fallaban. Simplemente nunca se ejecutaban** — la forma más silenciosa posible de romperse. Un
panel que mirara solo las credenciales habría dicho "Meta: conectado" durante meses.

Y no era solo Meta. Seis rutas de cron con `GET` no tenían ningún planificador: `meta`, `meta-daily`,
`meta-ads`, `instagram`, `reels` y `youtube-backfill`.

## Qué se ha hecho

1. **Programadas en `vercel.json`** las cuatro que deben correr solas: `meta` (03:00),
   `meta-daily` (03:30), `meta-ads` (02:00) e `instagram` (02:30), en horas separadas para no
   solaparse entre ellas ni con los crons de IA.

   Sinceridad sobre el coste de esta decisión: el diseño original quería `meta` **cada 30 minutos**,
   y en Vercel Hobby los crons corren **una vez al día** y a una hora aproximada. Diario es peor que
   cada media hora — pero infinitamente mejor que no ejecutarse nunca, que es lo que pasaba.

2. **`lib/ops/sync-health.ts`**: cada sincronización declara su tabla, sus claves y **quién la
   dispara**. El estado `sin_planificador` existe precisamente para este fallo, y es distinto de
   `sin_credenciales` y de `sin_datos`. Lo manual tiene que justificar por qué lo es, o "manual" se
   convierte en el cajón de lo que nadie programó por olvido.

3. **Un test que impide la reincidencia**: recorre las rutas de cron con `GET` y falla si alguna no
   está declarada en el catálogo. Añadir una sincronización nueva obliga a decir quién la ejecuta.

## Decisión que te queda a ti

`reels` y `youtube-backfill` siguen **sin programar, a propósito y documentado**: la primera genera
borradores de contenido que alguien tiene que revisar, y la segunda consume cupo diario de la API de
YouTube. Programarlas es gastar dinero o cuota sin que lo hayas pedido.

Y si quieres la frecuencia original de Meta (cada 30 min en vez de diaria) hay dos caminos:

- **Habilitar `pg_cron` + `pg_net`** en Supabase y programarlas ahí. Es el diseño original y permite
  frecuencia sub-diaria. Implica habilitar dos extensiones en producción.
- **Pagar Vercel Pro**, que permite crons con frecuencia arbitraria.

No he hecho ninguna de las dos: la primera toca producción de una forma que no me has autorizado, y
la segunda cuesta dinero.

## Lo que este diagnóstico NO explica

`sales`, `collections` y `stripe_customers` también están a 0, con una clave de Stripe configurada.
Eso **no** es el mismo problema: Stripe no se sincroniza por cron, sino desde la pantalla de
conciliación y el registro manual de ventas. Ver la nota sobre el backfill de Stripe en
`ROADMAP_MVP.md`: crear ventas automáticamente exigiría inventar el producto y el plan de pago,
porque `sales.product_id` y `sales.payment_plan_id` son `NOT NULL` y un pago de Stripe no dice a qué
producto interno corresponde.

---

## Segunda ronda (2026-09-13): las tablas seguían vacías con el planificador puesto

Con las rutas ya programadas, el panel decía: _"Credenciales y planificador correctos, pero
`campaigns` está vacía. Revisa el último error del sync"_. **Ese último error no se guardaba en
ninguna parte**, así que no había nada que revisar. Las causas encontradas, todas reales:

1. **Un único fallo aguas arriba vaciaba tres tablas.** `campaign_daily` y `campaign_ads` se enlazan
   a la campaña por el mapa `external_id → campaigns.id`. Si la sync de campañas no escribe,
   ese mapa sale vacío y las filas diarias se descartan una por una en silencio
   (`if (!campaignId) return null`). No eran tres bugs: era uno.

2. **La sync se tragaba los errores de escritura.** `if (insErr) continue`, `if (!error) synced +=`,
   `.catch(() => 0)`: un fallo total de escritura devolvía `ok: true, synced: 0`, indistinguible de
   una cuenta publicitaria sin campañas. Ahora cada fallo se acumula en `failures[]`, la ejecución
   queda como `error` en el historial, y no se pierde lo que sí se escribió.

3. **La config guardada no era la config usada.** `resolveMetaConfigs()` leía `process.env`, que
   `ensureConfig(tenantId)` rellena. `process.env` es global al proceso y **nunca borra**: en el cron
   que recorre todas las subcuentas en la misma lambda, la segunda heredaba el token de la primera y
   se llenaba con SUS campañas, estampadas con su propio `tenant_id`. Las syncs reciben ahora la
   configuración **como argumento** (`MetaEnv`), y `getTenantConfigWithFallback` ignora los valores
   inyectados por otra subcuenta.

4. **"He borrado el App Secret y sigue dando el mismo error"** era exactamente el mismo problema: el
   valor borrado de `integration_settings` seguía vivo en `process.env` el resto de la vida de la
   lambda. `forgetInjectedKeys()` lo retira, y el borrado ahora cuenta las filas borradas de verdad
   (`.select('key')`) y avisa si la clave sigue llegando por variable de entorno de Vercel.

5. **Un token inválido se reportaba como "faltan credenciales".** Sin cuenta elegida a mano, el
   descubrimiento de cuentas ES la única fuente, y su error se silenciaba con `catch { [] }`. Ahora
   sube con su código (`token_invalido`, `proof_invalido`, `sin_cuentas`…).

### Lo que se añadió

- `integration_sync_runs` (migración `20260913190000`): historial de ejecuciones con estado, filas
  escritas, código y mensaje de error **ya redactado** (ninguna credencial entra ahí), y un **índice
  único parcial** `(tenant_id, job) WHERE status='running'` que hace de cerrojo: el cron y el botón
  manual no pueden correr a la vez. Las ejecuciones colgadas se cierran como `timeout` a los 15 min.
- Estados de datos explícitos (`lib/ops/sync-health.ts`): `NOT_CONNECTED`, `SYNC_FAILED`,
  `SYNC_PENDING`, `SYNC_SUCCESS_NO_DATA`, `DATA_STALE`, `DATA_AVAILABLE`. "Vacío" era un estado que
  tapaba cinco situaciones con cinco arreglos distintos.
- Reintentos **solo** para lo que puede salir bien al repetirlo (rate limit, error temporal,
  timeout). Reintentar un token caducado gasta la ventana del cron sin ninguna posibilidad.

### Stripe, en la misma ronda

- **Tres de las cuatro llamadas a Stripe no paginaban**: pedían `limit=100` y se quedaban con las 100
  filas más recientes. La base de clientes salía incompleta y la conciliación daba por cuadrado lo que
  nunca había mirado, las dos sin un solo error. Ahora todas pasan por `lib/stripe/client.ts`, que
  pagina y **dice** (`truncated`) si se quedó a medias por presupuesto de tiempo.
- La conciliación cotejaba contra "los 1.000 cobros más recientes". Con los pagos ya paginados, un
  cobro más antiguo que ese tope habría salido como "sin registrar" — y registrarlo otra vez
  **duplica la facturación**. Ahora se consulta por las referencias que aparecen, en lotes.
- La comprobación de Stripe del panel no tenía timeout: con Stripe colgado, la pantalla esperaba
  indefinidamente.

### Pendiente de verificar con datos reales

Nada de esta ronda se ha podido verificar contra Meta o Stripe de verdad: desde el entorno del agente,
`graph.facebook.com` está bloqueado por el proxy de salida y el MCP de Supabase pide reautenticación.
Queda `inspeccionado` y `probado` (291 tests), **no `verificado`**. La verificación real es: aplicar la
migración, pulsar **Comprobar** y **Cargar histórico** en Meta, y mirar el historial de ejecuciones.
