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
