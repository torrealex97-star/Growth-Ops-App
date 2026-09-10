# Registro de cambios — [tenant]

> Aquí se anota **cada cambio que se sube a producción**. Formato sencillo:
> una línea por cambio, agrupado por fecha. Lo más nuevo, arriba.
>
> Reglas:
> - Nada llega a producción sin pasar antes por **staging** (`staging.[tenant]`) y ser confirmado.
> - Al hacer merge de `staging` → `main` (deploy a producción), se apunta aquí qué entró.
> - Etiquetas: `[nuevo]` funcionalidad, `[fix]` corrección, `[mejora]` cambio a algo existente.

---

## Sin publicar (en staging, pendiente de confirmar)

<!-- Añade aquí lo que está en staging esperando el OK para producción -->
- _(vacío)_

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
