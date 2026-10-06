# Fase 1 — Matriz de integraciones (estado al 6-oct-2026)

Salida exigida por la Fase 1 del plan de cierre (`docs/ACTIVE_HANDOFF.md`): matriz por integración
con estado real, última sincronización, volumen y error accionable. Esta pasada es de **diagnóstico
sobre producción**: no cambia código, datos ni credenciales.

Leyenda: `INSPECTED` = leído en código/config · `TESTED` = ejecutado contra producción (BD de runs,
cron, API) · `VERIFIED` = confirmado en el servicio real con resultado esperado.

Fuente de evidencia: `integration_sync_runs` (ventana 10 días), `integration_settings`,
ejecución manual del cron de pagos (5-oct) y reproducción del fallo de visión IA (6-oct).

| Integración           | Estado                 | Nivel                      | Última sync OK      | Volumen reciente                | Error accionable                                                     |
| --------------------- | ---------------------- | -------------------------- | ------------------- | ------------------------------- | -------------------------------------------------------------------- |
| Stripe (read-only)    | Operativa              | VERIFIED                   | hoy (cron diario)   | 86 pagos en 30 días             | —                                                                    |
| Calendly              | Operativa              | VERIFIED                   | hoy (cron diario)   | 9 runs OK en 10 días            | —                                                                    |
| GHL                   | Operativa              | VERIFIED                   | hoy (botón manual)  | 7 runs OK en 10 días            | —                                                                    |
| Meta (ads)            | Caída — bloqueo humano | TESTED (fallo reproducido) | 4-oct               | 20 runs en error desde el 4-oct | Token caducado; el de reposición carecía de `ads_read`               |
| Instagram             | Caída — bloqueo humano | TESTED (fallo reproducido) | 28-sep              | 9 runs en error                 | Token inválido (error 100 del Graph API)                             |
| Email (Resend)        | No verificable         | INSPECTED                  | sin runs en 10 días | 0 facturas por email            | Clave irrecuperable (cifrada con key anterior): re-pegar             |
| YouTube               | No verificable         | INSPECTED                  | sin runs en 10 días | —                               | Secret irrecuperable (cifrada con key anterior): re-pegar y re-OAuth |
| IA texto (DeepSeek)   | Operativa              | TESTED                     | config descifrable  | —                               | —                                                                    |
| IA visión (Anthropic) | Caída — bloqueo humano | TESTED (fallo reproducido) | —                   | —                               | `ANTHROPIC_API_KEY` no existe en BD ni env: pegarla en Integraciones |
| Fathom                | Sin evidencia          | INSPECTED                  | sin runs en 10 días | —                               | Verificar próximo cron o sync manual                                 |
| Apify (reels/TikTok)  | Sin evidencia          | INSPECTED                  | sin runs en 10 días | —                               | Verificar planificador                                               |
| seQura                | Sin configurar         | INSPECTED                  | —                   | —                               | Decisión de producto: no conectada en esta subcuenta                 |

## Detalle por conector

- **Stripe**: run manual del cron (5-oct) HTTP 200 con espejo de pagos al día, 0 truncados; run
  diario de hoy OK. Webhook + backfill idempotentes probados por PR previa. Sin errores en 10 días.
- **Calendly**: 9 runs OK en 10 días; los 2 `timeout` históricos (29-sep y 3-oct) fueron cortes de
  lambda cerrados por el barrido de colgados, y el run siguiente entró OK — reintento idempotente
  funcionando. Presupuesto interno muy por debajo de `maxDuration`.
- **GHL**: va SOLO por botón por diseño (su API no cabe en 60 s de Hobby); webhook cubre tiempo
  real. 3 `timeout` históricos cerrados por el barrido. Run de hoy OK.
- **Meta**: el token caducó el 4-oct 05:00 PDT (`meta`, `meta-ads` y `meta-daily` en error desde
  entonces; última sync OK 4-oct 11:00 UTC). Los intentos del 4-oct con un token nuevo fallaron por
  `sin_permisos`: faltaba `ads_read`/`ads_management`. Arreglo: token de System User con `ads_read`
  sobre la cuenta publicitaria + re-guardar `META_APP_SECRET` (ver bloqueo abajo) y pulsar
  «Comprobar» en Integraciones (la UI ya muestra el fix por código `token_caducado`/`sin_permisos`).
- **Instagram**: `token_invalido` persistente desde 28-sep (el objeto de la Graph API deja de
  responder al token). Arreglo: regenerar token con los permisos del perfil profesional de IG y
  re-guardar `INSTAGRAM_ACCESS_TOKEN`.
- **Email/YouTube/Anthropic**: tres credenciales muertas o ausentes que solo el humano puede
  restaurar (ver bloqueo consolidado).
- **IA**: DeepSeek (texto) y Groq (transcripción) descifrados y operativos con la key vigente; la
  lectura de facturas (imágenes/PDF) exige Anthropic por diseño (`lib/ai/provider.ts`) y hoy devuelve
  «Could not resolve authentication method» — reproducido y diagnosticado el 6-oct.
- **Salud de UI**: la infraestructura `lib/integrations/health.ts` ya mapea los códigos reales de
  estos fallos (`token_caducado`, `token_invalido`, `sin_permisos`) a arreglos concretos en
  Integraciones; no requiere cambios de código.

## Bloqueo humano consolidado (una sola pasada en Integraciones)

1. Re-guardar con el valor original: `META_APP_SECRET`, `RESEND_API_KEY`, `YOUTUBE_CLIENT_SECRET`
   (cifrados con una `CONFIG_ENC_KEY` anterior; irrecuperables por diseño).
2. Pegar token nuevo de Meta (System User con `ads_read`) y token nuevo de Instagram.
3. Pegar `ANTHROPIC_API_KEY` (no existe en ninguna fuente) para restaurar el análisis de facturas.

Hasta entonces, Meta/Instagram/Email/YouTube/visión IA no se consideran VERIFIED aunque el código
compile — coincidente con el bloqueo del plan.

## GAPs declarados

- Logs de Vercel no consultados en esta pasada: la evidencia viene de `integration_sync_runs`
  (BD) y de las pruebas ejecutadas; la correlación por `request_id` queda para la siguiente vuelta.
- Fathom y Apify no registran runs en 10 días: verificar si es planificador faltante
  (`sin_planificador`) o simplemente no ejecutados; decidir con el criterio «un hueco no es un cero».
- Duplicados: sin evidencia de duplicados en los runs OK de hoy (upserts idempotentes cubiertos por
  tests); la comprobación exhaustiva anti-duplicados por conector queda ligada a la Fase 2.
