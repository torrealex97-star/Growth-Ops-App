# Auditoría del módulo VSL / Video — Growth Operator OS

> 2026-09-22 · Auditoría "audit-first" del módulo VSL existente antes de tocar código, según el
> contrato del producto (fases V0→V6, filosofía PRESERVAR→MEDIR→TESTEAR→CORREGIR→SIMPLIFICAR→FORTALECER→EXTENDER).
> Línea base verificada: suite VSL existente 11/11 en verde sobre main `4c2cfa7`.

## CURRENT ARCHITECTURE

```
app/[tenant]/marketing/adquisicion/vsl/page.tsx   → panel con biblioteca + dashboard por vídeo
app/api/[tenant]/evergreen/vsl/videos/route.ts    → CRUD biblioteca (postgres directo, filtro tenant_id explícito)
app/api/[tenant]/evergreen/vsl/bunny/route.ts     → firma TUS + prueba de conexión (clave nunca al front)
app/api/[tenant]/evergreen/vsl/metrics/[slug]     → métricas agregadas del dashboard
app/api/vsl/{session,track,identify,live}         → tracking público (anónimo, sin auth de tenant)
app/embed/vsl/[slug]/page.tsx                     → embed público SSR (preconnect/preload)
components/vsl/VslPlayer.tsx                      → player + tracking cliente (706 líneas)
components/vsl/VslDashboard.tsx                   → biblioteca + dashboard (697 líneas, monolito)
components/vsl/subirABunny.ts                     → TUS resumable directo a Bunny desde el navegador
lib/vsl/{db,bunny,types,sync}.ts                  → postgres proxy, firma TUS, config, sync % → contacts
```

## CURRENT BUNNY USAGE

**STABLE.** Flujo completo ya operativo: servidor firma TUS (`firmaSubidaBunny`, SHA256 library+key+expiry+videoId,
6h de validez), el navegador sube **directo a Bunny por TUS** (sin proxy, sin el límite de 4,5 MB de Vercel), URLs HLS
`iframe.mediadelivery.net` / `vz-xxx.b-cdn.net`, prueba de conexión y mensajes de error dedicados (key de biblioteca
vs key de cuenta). 11/11 tests cubren firma, normalización de host, URLs y guards de secretos.

## CURRENT TABLES

- `vsl_videos` (tenant_id, slug, name, source_url, poster_url, duration_seconds, config JSONB; unique (tenant_id, slug))
- `vsl_sessions` (video_id, anon_id, referrer, device, country, user_agent, watched_seconds int[], max_position,
  duration, plays, reached_end, first_play_at, last_beat_at, lead_email, lead_name)
- `contacts.vsl_watch_pct / vsl_watched_at` — puente a CRM

## CURRENT TRACKING (STABLE el núcleo)

- Latido cada ~3s: `watched_seconds` como **int[] con dedupe en DB** (heatmap real: detecta rebobinados y saltos)
- `sendBeacon` en ended/unload; bloqueo de doble-play por seek; `first_play_at` para time-to-play
- identify(email,name) público que **nunca lanza** (valida merge-fields `{{...}}` de GHL y regex de email)
- `syncContactWatchPct` → `contacts.vsl_watch_pct` (solo sube, try/catch aislado)

## CURRENT PLAYER (STABLE)

Autoplay/muted/restartOnUnmute/lockSeek/fakeProgress/loop/socialProof/exitHook ya viven en `config` JSONB con
defaults sensatos y `mergeConfig`. Media session, puppeting de `play()` en interacción y salidas del navegador cubiertos.

## CURRENT EMBED

SSR + preconnect/preload de póster y vídeo, orígenes derivados de las URLs, 404 amigable.

## CURRENT ANALYTICS

Retención (curva con unnest del int[]), mayores caídas, play rate, completion, dispositivos, leads identificados con % visto.

## CURRENT IDENTITY FLOW

anon_id por navegador → sesión única por (video_id, anon_id) → identify(email) fusiona en la sesión → % → contacts.

## STABLE CAPABILITIES (no reimplementar)

Bunny TUS end-to-end, latido+heatmap int[], identify robusto, embed SSR optimizado, tenant scoping en todas las
queries tenant-side, RLS habilitada, tests de secretos y de firma.

## BUGS / RIESGOS

1. **`/api/vsl/session` sin rate-limit** — puede inflar impresiones con peticiones automáticas. Mitigación barata:
   reutilizar el `MinuteRateLimiter` que ya existe en `app/api/track/[site]/route.ts`.
2. **DELETE físico de vídeos** en `videos/route.ts` — el contrato pide soft delete (`deleted_at`); hoy la fila
   desaparece y con ella el histórico de sesiones en los joins.
3. **Métricas agregadas sobre sesiones de vida entera**: un visitante que vuelve días después actualiza su sesión
   única, por lo que los plays de "hoy" pueden reflejar una primera reproducción de hace semanas.
   Decisión de producto necesaria (irreversible con datos): **sesión única vs una fila por visita**.
4. `VslDashboard.tsx` mezcla biblioteca + form + dashboard — refactor de extracción (V0/V1), sin cambio de comportamiento.

## MISSING (vs contrato V0–V6)

- Parseo de UTM/source/campaign en sesiones (hoy solo `referrer` crudo)
- Desglose por fuente/campaña en el dashboard
- CTA overlay configurable por vídeo
- QoE (stalls/buffering) para distinguir caída de contenido vs de reproducción
- Experimentos A/B por vídeo
- Person 360 de vídeo, Data Health de vídeo, exports con filtros

## SECURITY RISKS

- RLS habilitada en ambas tablas; las rutas de tracking usan `postgres` directo (bypass) — correcto por diseño,
  pero toda query de analytics nueva DEBE llevar `tenant_id` explícito (la nota ya existe en metrics).
- La clave de Bunny nunca sale del servidor (firma en backend, subida TUS desde el navegador con firma efímera).

## PERFORMANCE RISKS

- `watched_seconds` int[] con dedupe O(n²) en el UPDATE — OK hasta decenas de miles de latidos por sesión; no mover hasta medir.
- VslDashboard refetch de métricas en cada selección — aceptable; evitar fetches duplicados al dividir el componente.

## REUSE PLAN

- `MinuteRateLimiter` (tracking de pixels) → rate-limit de `/api/vsl/session` y `/api/vsl/track` (V1)
- Sistema de secretos existente (integration_settings cifrados) → nada nuevo que inventar
- `mergeConfig` + config JSONB → CTA y nuevas capacidades del player SIN migraciones (V2)

## MIGRATION PLAN

Gradual: una fase por PR, con OLD BEHAVIOR = PASS en cada paso (tests de preservación primero).

## PHASE PLAN

- **V0 (este pase):** tests de preservación del núcleo (dedupe del latido, validación de identify, semántica de
  upsert de sesión, filtro tenant en queries, guards de secretos).
- **V1:** UTMs en sesión + desglose por fuente/campaña; rate-limit de session/track reutilizando MinuteRateLimiter;
  soft delete de vídeos.
- **V2:** CTA overlay por vídeo (solo config JSONB, sin migración).
- **V3:** QoE (stalls/buffer) — "¿la caída es de contenido o de reproducción?"
- **V4:** experimentos A/B (hash de anonId → variante de config, sin tablas nuevas).
- **V5:** Person 360 de vídeo, Data Health de vídeo, exports.
- **V6:** seguridad avanzada de media (signed playback, watermark, DRM) — solo si hay necesidad real.

## Decisión necesaria del usuario (irreversible con datos existentes)

**¿Sesión única por (video_id, anon_id) o una fila por visita?** La sesión única sobreescribe el historial de la
primera visita cuando la persona regresa; migrar a por-visita recalcula todas las métricas base (plays, retención,
completados). No se toca hasta que lo decidas.

---

*Auditoría generada el 22-sep-2026; cada fase sale por PR con preservation gate (OLD BEHAVIOR = PASS).*
