# Flujo de trabajo: staging → producción

Objetivo: **nada llega a los clientes reales sin probarse antes en staging**.

## Los dos entornos

| Entorno        | URL                                   | Base de datos (Supabase)     | Acceso                         |
|----------------|---------------------------------------|------------------------------|--------------------------------|
| **Producción** | `[tenant]`                       | Producción (datos reales)    | Clientes / equipo real         |
| **Staging**    | `<proyecto>-staging.vercel.app`        | Staging `xryk…` (aislada)    | El equipo prueba aquí (QA)     |

> Staging tiene **su propia base de datos** (proyecto Supabase `xrykcqwjubthptkgecyb`, región eu-central-1).
> El equipo puede crear, editar y borrar sin miedo: **no afecta a datos reales**.

## Accesos para el equipo (QA)

Solo necesitan esto — nada de GitHub, Vercel ni Supabase:

- **URL:** https://<proyecto>-staging.vercel.app
- **Login de la app (usuario):** en el gestor de contraseñas  (rol admin)
- **Password del panel simple** (secciones tipo `/login`, coldcalling): `[en el gestor de contraseñas]`

## Cómo circula un cambio

```
1. Se hace el cambio de código ([tenant] / desarrollo)   -> rama "staging" en git
2. Se despliega a STAGING:  vercel deploy               -> <proyecto>-staging.vercel.app
3. El equipo prueba en staging y confirma que va bien
4. [tenant] da el OK
5. Se despliega a PRODUCCIÓN el MISMO código:  vercel --prod  -> [tenant]
6. Se anota el cambio en CHANGELOG.md
```

> ⚠️ **No se usa `vercel promote`** para pasar staging a producción. Cada entorno
> se compila con SUS variables (staging apunta a su BBDD, producción a la suya),
> y esas variables se "hornean" en el build. Por eso producción se despliega con
> `vercel --prod` (build propio con datos reales), desde **el mismo commit** que se
> probó en staging. Así se sube exactamente el mismo código, con la BBDD correcta.

## Comandos ([tenant] / desarrollo)

```bash
# 1) Publicar en staging para que el equipo pruebe
git checkout staging
# ...cambios de código...
git add -A && git commit -m "descripcion del cambio"
git push origin staging
vercel deploy                                   # crea un preview
vercel alias set <url-del-preview> <proyecto>-staging.vercel.app   # URL fija

# 2) Cuando el equipo confirma OK -> subir a producción (mismo código)
git checkout main && git merge staging && git push origin main
vercel --prod                                   # -> [tenant]
#   y anotar el cambio en CHANGELOG.md
```

## Estado de la infraestructura (2026-07-13)

- Repo privado GitHub: `(repo anterior, reemplazado 2026-09-19)` (ramas `main` y `staging`).
- Vercel: proyecto `[tenant]-app`. Deploys por CLI (la conexión automática Git↔Vercel
  quedó pendiente de autorizar la GitHub App; no es necesaria para este flujo).
- Protección SSO de previews: **desactivada** (para que el equipo acceda a staging sin cuenta de Vercel).
- Variables de staging configuradas en Vercel scope **Preview** (Supabase staging, `POSTGRES_URL`,
  secretos propios). Producción conserva las suyas intactas.

## Migraciones de base de datos

Los cambios de esquema (`scripts/migration-*.sql`) **no** se aplican solos. Se ejecutan con `psql`
primero en la BBDD de **staging** y, tras confirmar, en la de **producción**.

```bash
# staging
psql "postgresql://postgres.xrykcqwjubthptkgecyb:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require" -f scripts/migration-vXX.sql
```
