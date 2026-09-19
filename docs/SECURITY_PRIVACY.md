# Seguridad y privacidad — reglas obligatorias

> **Contexto:** este repo puede hacerse público. Todo lo commiteado es legible por cualquiera,
> para siempre. El historial se reescribió el 2026-09-19 precisamente porque se incumplió esto.
>
> **Incidente 2026-09-19 (resumen):** una private key de Google service account, emails reales del
> equipo y de clientes, un webhook secret, credenciales de staging y nombres de clientes vivieron
> en el historial durante días. Se purgó con `git filter-repo` (SHAs nuevos) y se rotaron claves.
> Este documento existe para que no vuelva a pasar.

---

## 1. Regla de oro: la herramienta ≠ los tenants

Este repo es la **herramienta** multi-tenant. Nada que identifique a un tenant concreto pertenece
al código: los datos de cada tenant viven **solo** en su base de datos (Supabase) y en sus env
vars (Vercel). Si un fichero del repo responde "de qué empresa es esto", está mal.

## 2. Nunca commitear (lista cerrada)

- **Credenciales de cualquier tipo**, incluidas las "de staging" o "solo para tests":
  contraseñas, claves API, private keys (Google/AWS/PEM), webhook secrets, tokens de terceros,
  DSNs, recovery codes, contraseñas por defecto hardcodeadas.
- **Datos de negocio:** leads, clientes, ventas, testimonios, contratos, grabaciones, listas de
  emails, dumps SQL con datos reales, fotos de clientes.
- **Identidad de personas reales** (equipo o clientes): nombres, emails, teléfonos, IDs de
  usuario, rutas de disco con nombre personal (`/Users/juanperez/...`), hostnames personales.
- **Infraestructura de un tenant:** dominios de producción, subdominios de Vercel/Supabase,
  merchant references, IDs de organizaciones externas (Calendly, Meta, GHL).

## 3. Qué hacer cuando necesites un ejemplo

- Placeholders neutros: `tu-tenant`, `academia-demo`, `usuario@ejemplo.com`, `+34 XXX XXX XXX`,
  `notificaciones@tu-dominio.com`, `<proyecto-supabase>`.
- Datos de prueba con el seed (`scripts/seed-demo.mjs`), **nunca** exportaciones reales.
- Los tests usan fixtures evidentes (`sk_test_1234567890`) y además verifican que los mensajes de
  error redactan secretos (`tests/metrics/sync-runs.test.mjs`).
- Si un doc operativo necesita una credencial: escribe "ver gestor de contraseñas / Vercel
  dashboard" y **nunca** el valor.

## 4. Antes de cada commit

- Revisa el diff buscando emails reales, nombres, dominios y tokens (ojo a los comentarios).
- El CI ejecuta gitleaks y bloquea secretos; en local puedes correr
  `gitleaks protect --redact --staged` antes de `git commit`.
- `.gitignore` cubre `.env*`; **nunca** uses `git add -f` para forzar uno.

## 5. Si un secreto llega a un commit

1. **Privado hoy ≠ privado mañana** (merge, fork, cambio de visibilidad, descarga de un
   colaborador). Un repo privado no justifica nada.
2. **Rota la credencial primero** — el push no deshace la exposición, y la rotación hace
   irrelevantes las copias que existan.
3. **Purga el historial** con `git filter-repo` (`--replace-text`, `--path --invert-paths`):
   borrar el fichero en HEAD **no** elimina los commits viejos. Después: force-push y borra
   ramas/tags remotas que retengan SHAs viejos. Los blobs purgados quedan marcados con el
   marcador de redacción y conviene repararlos después con un pase de `--replace-text` que
   los convierta en placeholders legibles.
4. Los `refs/pull/*` de GitHub retienen commits viejos ~90 días y no se borran con git: para
   exposiciones graves, contacta con GitHub Support o recrea el repo desde el historial limpio.

## 6. Datos personales en los metadatos de git

- Mensajes de commit, autores y docs no llevan datos personales. Autor canónico configurado:
  `alex@growthops.dev` (mailmap del repo).- Al reescribir historial, recuerda: filter-repo espera `viejo==>nuevo` o línea simple en
  `--replace-text` (un tabulador en el fichero de reglas lo vuelve literal y el reemplazo es
  silenciosamente nulo), y tras un fast-import conviene `git reset --hard HEAD`.
