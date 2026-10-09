# VSL Intelligence · discovery y matriz de paridad

> PR-0 · 9-oct-2026 · estado del código en `main` tras PR #412. Este documento sustituye las
> conclusiones de producto desactualizadas de `VSL_MODULE_AUDIT.md`; aquel documento conserva el
> historial de las fases V0–V2 originales.

## Resultado ejecutivo

El módulo ya contiene un reproductor VSL propio, upload directo a Bunny Stream, captura aproximada
de segundos vistos, identificación por email y una primera curva de retención. No utiliza el iframe
de Bunny para reproducir: sirve HLS desde Bunny dentro de un `<video>` controlado por la app. Esto
permite alcanzar la analítica requerida sin reemplazar Bunny ni añadir un segundo reproductor.

La base actual no puede representar de forma fiable visitas, reproducciones, replays, versiones,
ubicaciones de embed ni ventanas temporales. La restricción `unique (video_id, anon_id)` fusiona
todas las visitas históricas del mismo navegador. Además, `avgPercent` usa `max_position`, de modo
que un seek al final se interpreta como vídeo visto. Antes de ampliar el dashboard hay que separar
vídeo lógico, versión, visita/playback, eventos e intervalos.

## 1. Superficie existente

| Área        | Implementación actual                                              | Estado comprobado                                  |
| ----------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| Pantalla    | `app/[tenant]/marketing/adquisicion/vsl/page.tsx` → `VslDashboard` | Operativa                                          |
| Biblioteca  | `GET/POST/DELETE /api/[tenant]/evergreen/vsl/videos`               | CRUD + soft delete                                 |
| Upload      | `subirABunny.ts` + `/vsl/bunny`                                    | TUS directo, firma efímera                         |
| Reproductor | `components/vsl/VslPlayer.tsx`                                     | `<video>` + HLS.js; no iframe Bunny                |
| Embed       | `/embed/vsl/[slug]`                                                | SSR público, app iframe en la landing              |
| Sesión      | `POST /api/vsl/session`                                            | Upsert por vídeo+navegador                         |
| Tracking    | `POST /api/vsl/track`                                              | batch de segundos nuevos cada ~3 s                 |
| Identidad   | `POST /api/vsl/identify`                                           | email/nombre → sesión → contacto                   |
| Métricas    | `/vsl/metrics/[slug]`, `/vsl/resumen`                              | totales, hitos, curva, drops, device, leads        |
| Funnel      | `lib/funnels/queries.ts`                                           | impressions/plays/progress/complete desde sesiones |
| CRM         | `syncContactWatchPct` y webhook Calendly                           | `%` máximo por email                               |

## 2. Reproductor y telemetría real

### Fuente y eventos disponibles

El player usa una URL `.m3u8` de Bunny con HLS.js cuando el navegador no ofrece HLS nativo. Al ser
un `<video>` first-party, están disponibles los eventos HTMLMediaElement: `loadedmetadata`, `play`,
`pause`, `timeupdate`, `seeking`, `seeked`, `ended`, `waiting`, `playing`, `stalled`, `error`,
`ratechange` y cambios de visibilidad. No se necesita Player.js mientras se mantenga esta
arquitectura.

Hoy solo se consumen de forma material `play`, `pause`, `timeupdate` y `ended`; unload/visibility
provocan un flush. No se persisten `ready`, resume, seek, buffer, error, playback rate, CTA
impression ni form events como eventos separados. El click del CTA llama `sendBeat('cta')`, pero la
ruta no guarda el tipo más allá de interpretarlo como no-play/no-ended.

### Embed y frontera cross-origin

La landing externa contiene un iframe de `app.scalixsystems.com`; el reproductor y sus endpoints
comparten origen dentro del iframe. La comunicación landing↔iframe usa `postMessage`. La frontera
cross-origin limita la lectura directa del formulario/página padre, pero no la telemetría del
vídeo. El contrato debe aceptar datos de contexto enviados explícitamente por `loader.js`, validar
`event.source === window.parent` y aplicar allowlist/origin policy cuando exista.

## 3. Datos actuales y fórmulas

### Tablas

- `vsl_videos`: vídeo lógico y fuente actual mezclados en una fila; `tenant_id`, slug, URLs,
  duración, config y soft delete. Unique real: `(tenant_id, slug)`.
- `vsl_sessions`: una fila de vida completa por `(video_id, anon_id)`; email/nombre, referrer,
  device, country, UA, duración, posición máxima, `watched_seconds int[]`, contador `plays`, estado
  final y timestamps.
- `contacts.vsl_watch_pct/vsl_watched_at`: resumen máximo por contacto, no historial.

### Definiciones efectivas actuales

| Métrica visible  | Fórmula actual                                     | Evaluación                                    |
| ---------------- | -------------------------------------------------- | --------------------------------------------- |
| Impressions      | número de filas `vsl_sessions`                     | navegador único histórico, no impresión       |
| Plays            | sesiones con `max_position > 0`                    | navegador único que vio algo, no total plays  |
| Play rate        | plays / impressions                                | consistente internamente, etiqueta incorrecta |
| Avg percent      | promedio de `max_position / duration`              | incorrecto con seeks y fragmentos             |
| Completed        | `reached_end` por sesión vitalicia                 | pierde número de completados/replays          |
| Retention(t)     | sesiones cuyo `watched_seconds` contiene t / plays | aproximación útil de alcance único            |
| Replay intensity | no existe                                          | Set/int[] elimina repeticiones                |
| Total time       | no existe                                          | no se conserva repetición ni velocidad        |
| Identified       | sesión con email                                   | no contact_id ni historial de enlace          |

No existe selector temporal en las APIs de métricas VSL. El referrer conserva el primero de toda la
vida del navegador. No hay UTMs, click IDs, ubicación de embed, URL de página, session/playback ID,
schema version, received_at ni event_id idempotente.

## 4. Lo que ya está implementado y debe preservarse

- Bunny Stream sigue siendo hosting/transcoding/CDN.
- Upload TUS navegador→Bunny; la API key permanece en servidor.
- HLS adaptativo y fallback HLS nativo.
- Preview de administración que no contamina tracking.
- Batch periódico y `sendBeacon` al cerrar.
- Captura de segundos observados que no rellena el hueco de un seek.
- CTA configurable, resume local, fullscreen y controles existentes.
- Identificación diferida y puente básico al CRM.
- Autorización de métricas por pantalla y filtro tenant explícito en consultas privilegiadas.
- RLS activada en `vsl_videos` y `vsl_sessions` para el acceso Data API.
- Soft delete del vídeo y conservación de sus sesiones.

## 5. Huecos y riesgos priorizados

### P0 · aislamiento y significado

1. El embed y `/api/vsl/session` buscan `vsl_videos` solo por slug. Desde que el slug es único por
   tenant, dos tenants pueden compartirlo y la resolución pública es ambigua.
2. La prueba de preservación actual exige explícitamente el lookup inseguro por slug; debe
   sustituirse por una regresión de aislamiento, no mantenerse.
3. `postMessage` de identificación acepta mensajes de cualquier ventana; debe limitarse al padre y
   validar el contexto sin impedir embeds autorizados.

### P1 · medición

1. Una fila vitalicia impide visitas/playbacks separados, filtros temporales y heatmaps por sesión.
2. `max_position` infla engagement e hitos ante seeks.
3. `Set` conserva alcance único pero destruye replay intensity y total time.
4. El batch se vacía antes de confirmar persistencia; un fallo de red puede perder segundos.
5. No hay event_id/idempotencia ni tolerancia formal a eventos fuera de orden.
6. No hay video_version_id: reemplazar contenido mezcla duraciones y curvas.
7. Reproducción en pestaña oculta puede contarse mientras el vídeo siga activo.

### P2 · producto

- CTA impression/click no se almacena; forms no están instrumentados.
- No hay embed locations, UTMs normalizadas, traffic, audience ni export.
- Identidad usa email libre y no `contact_id`; no existe historial/evidencia del match.
- No hay join canónico con agenda/show/sale/cash ni distinción observed/attributed/assisted.
- No hay Data Health VSL ni fecha visible de inicio de cobertura precisa.
- El dashboard es una composición de tarjetas y no una investigación operativa por pestañas.

## 6. Limitaciones comprobadas

- Los heatmaps exactos anteriores al nuevo contrato no pueden reconstruirse: `watched_seconds`
  conserva alcance único acumulado por navegador, no orden, visita ni repeticiones.
- Bunny puede mostrar su heatmap propio y ofrece Player.js para iframe, pero no convierte los datos
  históricos internos de Growth-Ops en eventos por reproducción ni aporta el join CRM.
- `above the fold`, tamaño real del embed, browser/OS fiables y atribución cross-device deben ser
  `NOT_TRACKED` hasta instrumentarse; no se infieren.
- Un viewer anónimo representa un identificador first-party del navegador, no una persona universal.
- No se persiste IP completa; `country` procede de headers de edge y debe declararse aproximado.

## 7. Contrato objetivo mínimo

El vocabulario objetivo es `player_impression`, `player_ready`, `video_play`, `video_pause`,
`video_resume`, `video_seek`, `video_progress`, `video_complete`, `video_error`,
`video_buffer_start`, `video_buffer_end`, `video_cta_impression`, `video_cta_click`,
`video_form_view`, `video_form_submit` y `video_viewer_identified`.

Cada evento debe incluir `event_id`, `tenant_id`, `video_id`, `video_version_id`,
`embed_location_id`, `viewer_id`, `session_id`, `playback_id`, `occurred_at`, `received_at`,
`event_type`, posición/duración/rate/visibility/source y `schema_version` cuando aplique. Los
intervalos se guardan como `[start_second, end_second)` y conservan repeticiones por playback.

Invariantes:

- player load ≠ visit ≠ playback ≠ viewer;
- resume no crea un play;
- seek no rellena el intervalo saltado;
- unique watched seconds = unión por playback;
- total time incluye repeticiones y se calcula desde intervalos válidos;
- retention y replay intensity son series diferentes;
- observed conversion ≠ attributed conversion;
- sales y cash se leen de las fuentes canónicas existentes.

## 8. Plan de PRs

| PR  | Alcance             | Salida verificable                                                                    |
| --- | ------------------- | ------------------------------------------------------------------------------------- |
| 0   | Discovery y matriz  | Este documento + tests/documentación alineados                                        |
| 1   | Tracking foundation | tenant público explícito, versiones, playbacks, eventos, intervalos, RLS/idempotencia |
| 2   | Metrics engine      | fórmulas puras versionadas, rollups y fixtures matemáticos                            |
| 3   | Engagement          | KPIs, retention/replay, heatmaps paginados y CSV                                      |
| 4   | Embed & Traffic     | ubicaciones, UTMs, referrer, device y series                                          |
| 5   | Audience            | viewer/contact identity verificable y actividad combinada                             |
| 6   | Conversions         | CTA, forms, leads y bookings observados                                               |
| 7   | Revenue attribution | show, sale, cash; first/last/assisted con motor existente                             |
| 8   | Diagnostics         | Data Health, cobertura, benchmarks y alertas con sample size                          |
| 9   | Compare & UX        | versiones/fuentes/periodos, responsive ~400 px y accesibilidad                        |
| 10  | Hardening           | rendimiento, retención, exports, RLS/IDOR, browser QA y reconciliación                |

PR-1 requiere migración aditiva y reversible. No eliminará `vsl_sessions`; se mantendrá como
compatibilidad hasta que PR-2 demuestre reconciliación. El backfill solo declarará lo recuperable y
marcará el inicio de precisión; no inventará replays ni playbacks históricos.

## 9. Matriz de paridad inicial

| Capacidad           | Referencia Wistia                    | Growth-Ops actual                 | Estado                  | Evidencia / gap             |
| ------------------- | ------------------------------------ | --------------------------------- | ----------------------- | --------------------------- |
| Plays               | total y unique separados             | navegador vitalicio con actividad | PARTIAL                 | `max_position > 0`          |
| Engagement          | tiempo visto / duración por play     | posición máxima promedio          | PARTIAL                 | se infla con seek           |
| Retention           | alcance segundo a segundo            | segundos únicos acumulados        | PARTIAL                 | sin playback/periodo        |
| Heatmaps            | sesión/viewer con rewatch            | int[] acumulado                   | PARTIAL                 | sin orden ni replay         |
| Embed               | visits, plays, rate, time, locations | snippet y referrer inicial        | NOT_IMPLEMENTED         | sin location/series         |
| Traffic             | referrer, UTM, device                | referrer + device básicos         | PARTIAL                 | sin UTM/normalización       |
| Audience            | anonymous/identified + touchpoints   | anon_id/email en sesión           | PARTIAL                 | sin contact_id/historial    |
| Conversions         | forms/CTA                            | CTA visual no persistido          | IMPLEMENTED_BUT_UNWIRED | `sendBeat('cta')` se pierde |
| Revenue attribution | diferencial propio                   | `%` al contacto                   | NOT_IMPLEMENTED         | sin booking/sale/cash join  |
| Data Health         | cobertura/errores                    | rate limit y errores genéricos    | NOT_IMPLEMENTED         | sin salud por sesión        |
| Versiones           | comparación compatible               | fuente/duración mutable           | NOT_IMPLEMENTED         | curvas se mezclan           |

## 10. Fuentes verificadas

- Wistia separa Embed, Traffic, Engagement y Audience; Engagement distingue retención de replay y
  ofrece heatmaps por sesión/viewer.
- Bunny documenta el iframe oficial, parámetros, seguridad por token y soporte Player.js. Este repo
  usa en cambio HLS directo dentro de un player propio, una opción compatible documentada por Bunny.
- El código y las migraciones del repositorio son la fuente de verdad para las capacidades actuales.

Referencias oficiales consultadas el 9-oct-2026:

- <https://support.wistia.com/en/articles/8219222-media-analytics-overview>
- <https://support.wistia.com/en/articles/8228871-average-user-engagement-analytics>
- <https://support.wistia.com/en/articles/8219083-heatmaps>
- <https://support.wistia.com/en/articles/12530699-media-embed-analytics>
- <https://support.wistia.com/en/articles/12622995-media-traffic-analytics>
- <https://support.wistia.com/en/articles/15556740-media-audience-analytics>
- <https://github.com/BunnyWay/documentation/blob/main/stream/embedding.mdx>
- <https://github.com/BunnyWay/documentation/blob/main/stream/security.mdx>
- <https://bunny.net/blog/introducing-player-js-support-for-bunny-stream-advanced-player-control-and-monitoring-api/>

## 11. Design Read para las fases de UI

**Regla rectora:** `FUNCTION > CLARITY > POLISH`. Cada pestaña responde una sola pregunta:
Engagement = cuánto ven; Traffic = de dónde vienen; Audience = quiénes son; Conversions = qué acción
ocurrió; Revenue = qué resultado comercial verificable siguió. El orden y los nombres no cambian
entre vídeos.

- **Intento:** cockpit de diagnóstico para un Growth Operator, no galería de tarjetas.
- **Densidad:** 8/10; números tabulares, líneas/divisores, detalle bajo demanda.
- **Variación:** 4/10; resumen compacto, gráfica central dominante, tablas secundarias.
- **Movimiento:** 2/10; solo feedback de selección/hover, sin animación decorativa.
- **Marca:** tokens del tenant; WDC conserva rosa y Evergreen su acento sin forks.
- **Jerarquía:** Resumen → Retención → Audiencia → Tráfico → Conversiones → Acciones.
- **Lectura en cinco segundos:** una métrica principal dominante, estado/benchmark y siguiente
  acción; KPIs secundarios después; fórmulas, numeradores y tablas bajo “Ver detalle”.
- **Estados:** carga, vacío, error y dato insuficiente son explícitos y visualmente distintos; nunca
  un spinner infinito, una pantalla en blanco ni un fallo presentado como cero.
- **Anti-slop:** sin card-dentro-de-card, badges para todo, glassmorphism, glows ni gradientes
  gratuitos. En móvil, una columna, tabla→lista detallable y heatmaps con scroll controlado.
