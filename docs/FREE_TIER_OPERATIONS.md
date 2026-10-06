# Operación en Vercel Hobby + Supabase Free

Auditoría iniciada el 15 de septiembre de 2026 y actualizada con mediciones reales el 6 de octubre
de 2026. Este documento es la referencia operativa para
mantener Growth Ops dentro de los planes gratuitos. Los límites cambian: confirmar los enlaces
oficiales antes de aumentar carga o activar una integración nueva.

## Límites oficiales relevantes

### Vercel Hobby

- 4 horas de CPU activa y 360 GB-horas de memoria al mes.
- 1 millón de invocaciones de Functions y 100 despliegues al día.
- Hasta 100 cron jobs por proyecto; en Hobby cada expresión puede ejecutarse como máximo una vez al
  día y la hora puede variar dentro de una ventana aproximada de 59 minutos.
- Con Fluid Compute una Function Hobby puede admitir hasta 300 segundos. Este repositorio impone
  **60 segundos como presupuesto voluntario**, no porque sea necesariamente el techo técnico, sino
  para contener CPU y fallar de forma predecible.
- Hobby usa memoria/CPU administradas por Vercel; no se puede reducir `memory` por función desde
  `vercel.json` como mecanismo de ahorro.

Fuentes: [Vercel Hobby](https://vercel.com/docs/plans/hobby),
[límites de cron](https://vercel.com/docs/cron-jobs/usage-and-pricing) y
[duración de Functions](https://vercel.com/docs/functions/configuring-functions/duration).

### Supabase Free

- 500 MB de base de datos, 1 GB de Storage, 5 GB de egress y 5 GB de egress cacheado.
- 500.000 invocaciones de Edge Functions al mes.
- Dos proyectos activos y sin backups diarios administrados.
- Un proyecto con actividad insuficiente puede pausarse después de siete días.

Fuentes: [precios de Supabase](https://supabase.com/pricing) y
[pausa de proyectos Free](https://supabase.com/docs/guides/platform/free-project-pausing).

## Cambios aplicados y límite que protegen

| Cambio                                                       | Protección                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `fluid: true` y `maxDuration: 60` global para `app/api/**`   | Tope conservador de tiempo y CPU por invocación                               |
| Declaraciones de 120/300 s reducidas a 60 s                  | Evita que una ruta contradiga el presupuesto global                           |
| Webhook de Stripe limitado a 10 s                            | Mantiene rápida la ingesta y permite que Stripe reintente fallos transitorios |
| Anthropic, DeepSeek, Groq, GA4 y YouTube con timeout ≤45 s   | Reserva tiempo para responder limpiamente antes del límite de la Function     |
| Pruebas de conectividad de Integraciones con timeout de 10 s | Una API caída no bloquea toda la pantalla                                     |
| Máximo un reintento del SDK de Anthropic                     | Evita retry storms y consumo multiplicado dentro de una invocación            |
| Caché privada de 60 s para cuentas activas                   | Reduce lecturas/configuración repetidas sin compartir datos autenticados      |
| Caché pública de 7 días para CSS de fuentes                  | Reduce invocaciones y transferencia de un recurso casi estático               |
| `git.deploymentEnabled` desactiva Dependabot                 | Evita despliegues automáticos que no se quieren publicar                      |
| Preview de solo documentación omite el build                 | Ahorra CPU de build; producción nunca se omite                                |
| `POSTGRES_URL` documentada para Supavisor transaction pooler | Evita agotar conexiones directas desde serverless                             |

`ignoreCommand` no evita que una creación de deployment cuente en todos los casos: un build
cancelado puede seguir contando. Por eso Dependabot se bloquea además en `git.deploymentEnabled`.
Fuentes: [configuración Git de Vercel](https://vercel.com/docs/project-configuration/git-configuration)
y [Ignored Build Step](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step).

## Inventario de cron jobs

| Ruta             | Frecuencia        |
| ---------------- | ----------------- |
| `cron/meta-ads`  | diaria, 02:00 UTC |
| `cron/reminders` | diaria, 07:00 UTC |

Estos son los dos únicos crons declarados en `vercel.json` y ambos cumplen Hobby. Las demás rutas
`cron/*` del código no se ejecutan automáticamente desde Vercel. Las sincronizaciones que necesiten
frecuencia subdiaria deben ser manuales o migrarse a `pg_cron`/`pg_net` después de medir, sin añadir
un cron horario en Vercel Hobby.

## Supabase: decisiones de arquitectura

- Las rutas normales usan la Data API, adecuada para lecturas serverless. El cliente de navegador
  se reutiliza, pero el cliente autenticado de servidor se crea por request porque depende de las
  cookies de ese usuario; convertirlo en singleton global mezclaría sesiones y sería un riesgo de
  seguridad.
- El SQL directo de VSL debe usar Supavisor en modo **transaction**, puerto 6543. La conexión directa
  no es adecuada para el patrón efímero de Vercel. Ver
  [pooling y límites](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).
- Ya existen índices por `tenant_id` y fecha/identificador en las tablas de volumen principales y
  las lecturas críticas se paginan. No se añadieron índices a ciegas: cada índice también consume DB
  y encarece escrituras.
- No se hizo una sustitución masiva de `select('*')`: primero hay que medir endpoint por endpoint y
  confirmar qué campos consumen sus clientes. Cambiarlo globalmente sin contrato puede romper UI.

### Keepalive

Los crons diarios existentes consultan Supabase y constituyen actividad ligera si `CRON_SECRET` está
bien configurado y las ejecuciones terminan correctamente. No se añade otro ping redundante. Si los
crons dejan de funcionar, el proyecto vuelve a estar expuesto a la pausa por inactividad.

### Capacidad y retención

Medición del 6-oct-2026: la base ocupa **47.983.763 bytes (~48 MB, menos del 10% del límite)**. Las
tablas de mayor huella son `appointments` (~7,7 MB), `knowledge_chunks` (~4,8 MB), `audit_logs`
(~3,6 MB) y `contacts` (~1,8 MB). El autovacuum no muestra acumulación que justifique `VACUUM FULL`,
borrados o archivado inmediato. En este nivel, borrar históricos aportaría poco y sí eliminaría
valor de negocio.

`pg_stat_statements` señala como principal coste acumulado las lecturas de `appointments`; el advisor
también detecta policies que recalculan helpers de Auth por fila y FKs activas sin índice. La
migración `20261006090000_optimize_rls_and_foreign_key_indexes.sql` prepara la corrección sin cambiar
reglas de acceso ni datos: convierte esos helpers en InitPlans, elimina un índice duplicado y añade
índices selectivos. Debe pasar por PR y dry-run antes de aplicarse en producción.

Vigilar especialmente `raw_events`, `canonical_events`, `event_delivery_attempts`,
`contact_attributions`, transcripciones y archivos de VSL/testimonios. Umbral operativo: al 70% del
límite, identificar las tablas/buckets que crecen, exportar y solo después acordar una política de
retención. No hay borrado automático: sería destructivo y no existe todavía una política de producto
que diga qué historial se puede perder.

Supabase Free no ofrece backup diario. Antes de migraciones, deduplicaciones o limpieza: exportación
manual y prueba de restauración cuando el riesgo lo justifique.

## Webhook de Stripe

El handler actual:

1. lee el cuerpo crudo y verifica la firma por subcuenta;
2. normaliza y persiste el evento, sin llamadas externas a Stripe;
3. es idempotente por `(tenant_id, source, source_event_id)` y maneja la carrera `23505`;
4. devuelve 200 a duplicados/eventos válidos no interpretables y 500 solo si falla la persistencia;
5. no crea ventas ni cobros: esa decisión requiere producto y plan de pago.

Por tanto ya sigue el patrón rápido de «verificar, persistir, responder». Añadir una cola externa
sería complejidad y otro servicio sin carga real que la justifique.

## Métricas que hay que vigilar

### Vercel

- Active CPU: objetivo <70% de 4 h/mes; investigar rutas antes de 80%.
- Function duration, errores 5xx y timeouts por ruta.
- Invocations y transferencia, especialmente `/api/vsl/track` y polling de paneles.
- Estado/duración de cada cron y última ejecución correcta.
- Deployments diarios y builds omitidos.

### Supabase

- Database size y crecimiento semanal por tabla.
- Storage size por bucket y objetos huérfanos.
- Egress total/cacheado y endpoints que devuelven payloads grandes.
- Conexiones activas/esperando; confirmar puerto 6543 en `POSTGRES_URL` de Vercel.
- Errores RLS, queries lentas y actividad suficiente para no pausar.

## Riesgos y trade-offs restantes

- Un histórico excepcionalmente grande puede no terminar dentro de 60 segundos. Si se reproduce,
  la solución es persistir un cursor y continuar en lotes idempotentes; no aumentar el timeout.
- Reducir reintentos hace que un pico temporal del proveedor aparezca antes como error al usuario,
  pero evita multiplicar CPU y permite reintentar la acción de forma explícita.
- El keepalive depende de que un cron diario funcione; revisar alertas de ejecución.
- No hay backup automático ni retención automática: son tareas operativas deliberadas para evitar
  pérdida de datos silenciosa.
- Permanecen desplegadas varias Edge Functions de soporte/QA. `e2e-seed` es la función canónica
  versionada; `qa-seed-comisiones`, `qa-seed-contratos`, `ephemeral-migrate` y
  `tmp-exec-20260918` parecen temporales. No se eliminan hasta confirmar ausencia de invocaciones y
  autorizar expresamente el borrado.

## Limpieza de despliegues de Vercel (4-oct-2026)

**Por qué.** El 26-sep, Function Storage (10 GB) de Vercel llegó al límite y un despliegue bloqueado acabó
tumbando producción. Cada push construye un despliegue por proyecto vinculado al repositorio, y Vercel no
borra los viejos: el 4-oct había **423** (375 en `growthops-preview-3003`, 48 en `growth-ops-app`).

**Qué proyecto es cuál (comprobado el 4-oct).**

- `growthops-preview-3003` — **es producción**: sirve `app.scalixsystems.com`, tiene **14 variables de entorno**.
  A pesar del nombre.
- `growth-ops-app` — **proyecto duplicado**, creado el 3-oct a las 12:16 por la primera rama de Codex
  (`codex/reservation-refunds`). **0 variables de entorno**, sin dominio. Reconstruye cada push y duplica el
  consumo. Pendiente de que Alex decida borrarlo (`vercel project rm growth-ops-app --scope app-b1af`).

**Política de purga** (ejecutada con OK de Alex el 4-oct; baja de 423 a 52 despliegues):

1. Nunca el despliegue que sirve el dominio propio (`vercel inspect app.scalixsystems.com`).
2. Nunca algo en construcción, ni creado hace menos de 1 hora.
3. Se conservan las **5 últimas de producción** (rollback) y el **último preview de cada rama que siga
   existiendo en el remoto**: «lo que se está trabajando», con o sin PR.
4. Se borra el resto: `CANCELED`/`ERROR`, producción antigua y previews superados o de ramas ya fusionadas.
5. **No tocar variables de entorno**: borrarlas es lo que tumbó producción el 26-sep.

**Cómo.** `vercel remove <dpl_id> --safe --yes --scope app-b1af` (`--safe` se niega a borrar algo con alias).
Los alias de rama (`*.vercel.app`) los retira Vercel solo al borrar: para esos, comprobar antes que ningún
alias sea de dominio propio y repetir sin `--safe`. La API genérica `vercel api -X DELETE` exige
`--dangerously-skip-permissions`: no usarla, `vercel remove` ya trae su propia confirmación.
Listar con `vercel api "/v6/deployments?app=<proyecto>&limit=100&teamId=app-b1af"` (paginar con `until`).
