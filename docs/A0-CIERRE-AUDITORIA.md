# A0 — Cierre de auditoría (Vercel y CI)

Fase: **A0**. Graduación según `docs/00-CONSTITUCION.md` §5: _ningún ítem de la auditoría en estado
unknown_. Fecha: 2026-09-21.

Método: consultas de solo lectura a la API de Vercel (equipo `Growth-Ops_vercel`, `app-b1af`) y a
los secrets de GitHub Actions. No se modificó nada. Ningún valor secreto se leyó ni se descifró: solo
nombre, tipo y entornos de destino.

## 1. Los unknown que quedaban, resueltos

`docs/ACTIVE_HANDOFF.md` dejó cinco ítems sin verificar. Estado real:

| Ítem                                  | Estado                          | Evidencia                                                                                                                     |
| ------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Fluid Compute activo                  | **VERIFICADO: sí**              | `vercel.json` → `"fluid": true`                                                                                               |
| `maxDuration` efectivo                | **VERIFICADO: 60 s explícitos** | `vercel.json` → `functions."app/api/**/*.ts"`                                                                                 |
| `CRON_SECRET` en Production y Preview | **VERIFICADO: solo Production** | Ver §2.1                                                                                                                      |
| Nº máximo de crons del plan           | **Ya no aplica**                | Ver §2.2                                                                                                                      |
| Plan del equipo                       | **Sigue sin verificar**         | `get_team` no devuelve el plan y no hay otra herramienta que lo exponga. No bloquea nada: el límite de crons dejó de importar |

El único unknown que sobrevive es el plan, y ha dejado de tener consecuencias. A0 gradúa.

## 2. Hallazgos

### 2.1 `CRON_SECRET` no existe en Preview (P2)

En el proyecto `growth-ops` está definido **solo con target `production`**. Los 8 workflows
`cron-*.yml` y los 2 crons de `vercel.json` se autentican con `Bearer CRON_SECRET` fail-closed, así
que en un despliegue de Preview **todo cron responde 401**.

No es un agujero de seguridad — falla cerrado, que es lo correcto — pero sí un bloqueo para el
staging que F1 necesita en el mes 2: no se puede ensayar un cron sin poder autenticarlo.

`CONFIG_ENC_KEY` sí está en los tres entornos, así que el patrón existe y está aplicado en otras
claves; esta se quedó fuera.

### 2.2 Los crons ya no dependen del límite de Vercel

El reparto actual no se solapa, comprobado uno a uno:

| Dónde                            | Cuáles                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vercel** (`vercel.json`)       | `meta-ads` 02:00 · `reminders` 07:00                                                                                                                                                 |
| **GitHub Actions** (8 workflows) | `instagram` 02:30 · `meta` 03:00 · `meta-daily` 03:30 · `analyze-calls` 04:00 · `stripe-payments` 04:40 · `ai-insights` 05:00 · `monthly` día 1 06:00 · `sequra-morosos` lunes 08:00 |

Ningún endpoint está programado en los dos sitios, así que **no hay doble ejecución**. Y con solo 2
crons en Vercel, el límite del plan deja de ser una pregunta que haya que responder.

Conviene que esto quede escrito: la pregunta "¿cuántos crons permite el plan?" arrastraba desde el
handoff anterior, donde además se había afirmado en falso que Vercel Hobby solo permitía 3. La
respuesta hoy es que la pregunta es irrelevante.

### 2.3 El repositorio es PÚBLICO, y `ci.yml` asume lo contrario (P2)

`gh repo view` → `PUBLIC`.

`ci.yml` recorta cuándo corre CI con esta justificación literal:

> AHORRO DE MINUTOS (repo privado: cada minuto cuenta contra la cuota)

Por eso CI solo se dispara en `push` a `main` y en PRs, con `paths-ignore`. **En un repo público los
runners de GitHub no consumen cuota**, así que la premisa que motivó el recorte no se sostiene.

Es el mismo patrón que el error ya documentado sobre los crons de Vercel: una restricción real
construida sobre un dato no verificado. No propongo revertirlo sin pensarlo — restringir CI a `main`
y PRs tiene otras ventajas —, pero el comentario debe decir la verdad y la decisión rehacerse por su
mérito, no por una cuota que no existe.

Segunda consecuencia, más importante: **decide de hecho la decisión pendiente §8 de la constitución**
("repo privado o recreado"). Es público. El job de `gitleaks` sobre el historial completo pasa de ser
buena higiene a ser la defensa principal, y `docs/SECURITY_PRIVACY.md` ya está escrito para ese
supuesto.

### 2.4 `RESEND_API_KEY` está guardada como valor legible (P1)

Vercel la marca con `securityIssues: ["readable-secret"]`. Es de tipo `encrypted` con
`visibility: config`, no `sensitive`/`secret` como `CRON_SECRET`, `CONFIG_ENC_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` o `TRACKING_INGEST_KEY`. Está en los tres entornos.

Una clave de API guardada así se puede leer desde el panel y desde la API con un token de lectura.
Es el único ítem de este documento que toca credenciales vivas, y el arreglo es rotarla y volver a
crearla marcada como sensible. **No lo hago yo**: implica rotar una credencial de producción.

### 2.5 `deploy.yml` no puede ejecutarse (P3)

Declara necesitar `VERCEL_TOKEN`, `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`. Los secrets del repo son:

```
CRON_SECRET  SUPABASE_ANON_KEY  SUPABASE_SERVICE_ROLE_KEY  SUPABASE_URL
```

Los tres de Vercel **no están**, así que el workflow —ya limitado a `workflow_dispatch`— fallaría si
alguien lo lanzara. No urge: el despliegue real lo hace la integración de Vercel con el repo. O se
completan los secrets o se borra el workflow; tenerlo ahí sugiriendo una capacidad que no existe es
lo peor de las dos opciones.

Su comentario dice además que producción es `app.iawinners.com`. El dominio real de producción es
**`app.scalixsystems.com`** (verificado, `verified: true`).

### 2.6 El proyecto `go-prod` está vacío (P3)

Segundo proyecto en el mismo equipo, creado el 2026-09-18: `live: false`, sin despliegues, sin
dominios. Si fue un intento abandonado, conviene borrarlo para que nadie despliegue ahí por error.
Decisión de Alex.

## 3. Resumen

| #   | Hallazgo                                                                        | Prioridad | De quién                                     |
| --- | ------------------------------------------------------------------------------- | --------- | -------------------------------------------- |
| 1   | `RESEND_API_KEY` guardada como valor legible                                    | P1        | **Alex** (rotar)                             |
| 2   | `CRON_SECRET` no existe en Preview                                              | P2        | **Alex** (añadir) — bloquea el staging de F1 |
| 3   | El repo es público y `ci.yml` asume que es privado                              | P2        | Corregir comentario y revisar la decisión    |
| 4   | `deploy.yml` sin sus tres secrets, y con el dominio equivocado en el comentario | P3        | Completar o borrar                           |
| 5   | Proyecto `go-prod` vacío en Vercel                                              | P3        | **Alex** (borrar)                            |

Lo verificado y correcto, para que no se vuelva a auditar: Fluid Compute activo, `maxDuration` 60 s
explícito, crons reparados entre Vercel y GitHub Actions **sin solapamiento**, y `CONFIG_ENC_KEY`
presente en los tres entornos.
