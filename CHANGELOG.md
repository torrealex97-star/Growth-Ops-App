# Registro de cambios — Growth Ops App

> Aquí se anota **cada cambio que se sube a producción**. Formato sencillo:
> una línea por cambio, agrupado por fecha. Lo más nuevo, arriba.
>
> Etiquetas: `[nuevo]` funcionalidad, `[fix]` corrección, `[mejora]` cambio a algo existente.

---

## Sin publicar (pendiente de confirmar)

<!-- Añade aquí lo que está pendiente de confirmar -->

- `[mejora]` **Fiabilidad CI/ops (PR #214)**: el login E2E del global-setup reintenta una segunda vez y deja captura + errores de consola en `test-results/` si falla del todo (fin del flake del 25-sep que tumbó CI de `main`); el cron `calendly-ghl` baja su presupuesto de 35+25 s a 20+18 s para dejar colchón bajo el corte de 60 s de Vercel (504 `FUNCTION_INVOCATION_TIMEOUT` del 25-sep).
- `[mejora]` `AGENTS.md`: nuevas reglas aprendidas el 25-sep — suites solo por los scripts canónicos de `package.json` (los specs E2E no son `node:test`), prohibido fusionar linajes sin merge-base (caso PR #210), presupuestos de cron muy por debajo del `maxDuration` de Vercel, y la fila del tablero como contrato de relevo de trabajo sin commitear.

---

## 2026-09-11 — Limpieza a instancia propia + fixes de seguridad P0

- `[mejora]` Eliminado el stack legacy [tenant] / Lanzamiento / Cold Calling / Sorteo
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
  [tenant] / [tenant]).

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
- Repo privado en GitHub (`(repo anterior, reemplazado 2026-09-19)`) con ramas `main` y `staging`.
- **Entorno de staging montado y verificado**: `<proyecto>-staging.vercel.app` con BBDD Supabase
  aislada (`xryk…`, eu-central-1), esquema al día, roles sembrados y usuario admin de QA
  (`[tenant]`). Ver `docs/FLUJO-DEPLOY.md`.
- Punto de partida para el flujo staging → producción.
