# Operación en Vercel Hobby + Supabase Free

Auditoría realizada el 15 de septiembre de 2026. Este documento es la referencia operativa para
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

| Cambio | Protección |
| --- | --- |
| `fluid: true` y `maxDuration: 60` global para `app/api/**` | Tope conservador de tiempo y CPU por invocación |
| Declaraciones de 120/300 s reducidas a 60 s | Evita que una ruta contradiga el presupuesto global |
| Webhook de Stripe limitado a 10 s | Mantiene rápida la ingesta y permite que Stripe reintente fallos transitorios |
| Anthropic, DeepSeek, Groq, GA4 y YouTube con timeout ≤45 s | Reserva tiempo para responder limpiamente antes del límite de la Function |
| Pruebas de conectividad de Integraciones con timeout de 10 s | Una API caída no bloquea toda la pantalla |
| Máximo un reintento del SDK de Anthropic | Evita retry storms y consumo multiplicado dentro de una invocación |
| Caché privada de 60 s para cuentas activas | Reduce lecturas/configuración repetidas sin compartir datos autenticados |
| Caché pública de 7 días para CSS de fuentes | Reduce invocaciones y transferencia de un recurso casi estático |
| `git.deploymentEnabled` desactiva Dependabot | Evita despliegues automáticos que no se quieren publicar |
| Preview de solo documentación omite el build | Ahorra CPU de build; producción nunca se omite |
| `POSTGRES_URL` documentada para Supavisor transaction pooler | Evita agotar conexiones directas desde serverless |

`ignoreCommand` no evita que una creación de deployment cuente en todos los casos: un build
cancelado puede seguir contando. Por eso Dependabot se bloquea además en `git.deploymentEnabled`.
Fuentes: [configuración Git de Vercel](https://vercel.com/docs/project-configuration/git-configuration)
y [Ignored Build Step](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step).

## Inventario de cron jobs

| Ruta | Frecuencia |
| --- | --- |
| `cron/meta-ads` | diaria, 02:00 UTC |
| `cron/instagram` | diaria, 02:30 UTC |
| `cron/meta` | diaria, 03:00 UTC |
| `cron/meta-daily` | diaria, 03:30 UTC |
| `cron/analyze-calls` | diaria, 04:00 UTC |
| `cron/ai-insights` | diaria, 05:00 UTC |
| `cron/reminders` | diaria, 07:00 UTC |
| `cron/sequra-morosos` | semanal |
| `cron/monthly` | mensual |

Los nueve cumplen el plan actual. No se consolidan: juntar proveedores no reduce el CPU real y hace
que un timeout o fallo de una integración impida ejecutar las demás. Las sincronizaciones que
necesiten frecuencia subdiaria deben ser manuales o migrarse a `pg_cron`/`pg_net` después de medir,
sin añadir un cron horario en Vercel Hobby.

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
