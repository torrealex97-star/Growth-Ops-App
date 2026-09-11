# Registro de cambios — Growth Ops App

> Aquí se anota **cada cambio que se sube a producción**. Formato sencillo:
> una línea por cambio, agrupado por fecha. Lo más nuevo, arriba.
>
> Etiquetas: `[nuevo]` funcionalidad, `[fix]` corrección, `[mejora]` cambio a algo existente.

---

## Sin publicar (pendiente de confirmar)

<!-- Añade aquí lo que está pendiente de confirmar -->
- _(vacío)_

---

## 2026-09-11 — Limpieza a instancia propia + fixes de seguridad P0

- `[mejora]` Eliminado el stack legacy Closer Club / Lanzamiento / Cold Calling / Sorteo
  (Google Sheets + Postgres crudo) — queda solo el sistema Evergreen.
- `[fix]` RLS: cerrado el hueco por el que cualquier usuario autenticado podía leer
  todas las ventas/contactos/cobros de la empresa vía Supabase directo (política
  `collections_select_team` duplicada anulaba el scoping); `data_scope` ahora es
  `'own'` por defecto en vez de `'team'`.
- `[fix]` RLS habilitado en `positive_notes` (antes sin política, dependía solo de
  que la API no se saltara — ahora también protegido a nivel de base de datos).
- `[fix]` Añadida autenticación a `documents/state` (filtraba números de documento
  de identidad sin login), `documents/verify`, `vsl/videos` y `vsl/upload`.
- `[fix]` Enlace roto `/evergreen/retention` eliminado del menú.
- `[mejora]` Conectado a Supabase y Vercel propios (proyecto nuevo, sin datos de
  IA Winners / Closer Club).

---

## 2026-07-24 — Fix cash collected Sequra + WIP acumulada

- `[fix]` **Cash Collected de ventas Sequra**: el alta registraba las cuotas esperadas
  pero no el adelanto comisionable que recibimos de la financiera, así que la venta
  sumaba a facturación pero 0 € a Cash Collected hasta marcarla a mano. Ahora el
  adelanto se registra como cobro al instante (con comisionable explícito para no
  re-aplicar el ratio del plan). Regularizadas en producción las 2 ventas afectadas.
- `[nuevo]` **Reels del día**: bandeja diaria de borradores de reel minados de la
  competencia (cron + endpoints service-role) y vista en Contenido.
- `[nuevo]` **Setting-AI**: chat/crítico/mejora/simulación/autotrain para afinar prompts.
- `[nuevo]` **Plantillas de contrato en PDF** + validación de ID.
- `[mejora]` **VSL**: toggles de autoplay con sonido y reinicio al desmutear.
- `[mejora]` Ajustes varios en agendas, contratos, leads, integraciones y permisos.

---

## 2026-07-13 — Baseline + entorno de staging

- Estado inicial del repositorio con todo el trabajo acumulado (afiliados, contratos,
  carruseles, cualificación de contactos, onboarding, migraciones v37–v40, etc.).
- Repo privado en GitHub (`academiaiawinners-netizen/iawinners-app`) con ramas `main` y `staging`.
- **Entorno de staging montado y verificado**: `iawinners-staging.vercel.app` con BBDD Supabase
  aislada (`xryk…`, eu-central-1), esquema al día, roles sembrados y usuario admin de QA
  (`equipo@iawinners.com`). Ver `docs/FLUJO-DEPLOY.md`.
- Punto de partida para el flujo staging → producción.
