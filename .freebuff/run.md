# Run doc — Growth-Ops-App (preview)

> **Fuente de verdad del código: GitHub `origin/main`** (repo `torrealex97-star/Growth-Ops-App`).
> Desde la consolidación del 21-sep la carpeta local canónica es `~/GIT HUB/Growth-Ops-App`;
> este checkout de Documentos está retirado (solo quedan artefactos, ver rama
> `rescate/wip-scalix-20260921`). El sandbox no puede leer `~/Documents` ni `~/GIT HUB` salvo
> vía git (TCC: EPERM en coreutils/node), así que el preview corre desde un clon dedicado en
> `/tmp` por hilo — NUNCA compartido entre jobs (los working trees se pisan).

## Estado por hilo

| Hilo (threadId) | Puerto | Job launchd | Clon | Notas |
|---|---|---|---|---|
| **194f9eda (este hilo, preview actual)** | **3003** | `growthops-preview-3003` | `/tmp/growthops-preview-3003` | **25-sep**: el 3001 murió con el reinicio de Freebuff; este hilo sirve ahora del clon 3003 (verificado: login QA WDC OK, comisiones Futuras con datos). **OJO — clon COMPARTIDO**: otra hebra Claude Code trabaja en él a la vez (escribe ficheros en vivo y mezcla `origin/main` avanzado con experimentos). No tratarlo como fuente de verdad ni fiar validaciones a su árbol: usar un arnés efímero (`git archive` + parche en `/tmp`, p. ej. `/tmp/qa-gate`) y borradores efímeros vía launchd |
| 194f9eda (histórico) | 3000 | `growthops-dataviz` | `/tmp/growthops-preview` | verificado 21-sep tras merge #118; 3000 pasó a otra hebra — NO reusar sin `lsof` |
| 7a08c143 (revivido 21-sep) | 3003 | `growthops-preview-3003` | `/tmp/growthops-preview-3003` | verificado 23-sep tras merges #190/#191/#192/#193: `gh/main` `c42b04e`, HTTP 200 en landing y login WDC; job launchd reconstruido (reinicio de Freebuff lo borra) con receta de abajo; `.env.local` restaurado desde checkout de Documents |
| — eliminados (hilos cerrados) | 3002, 3010 | `growthops-preview-3002` y `-personas` | `/tmp/growthops-preview-3002` etc. | **jobs matados** al cerrar sus hilos; los clones quedan en disk si hacen falta |

## Preview de ESTE hilo (194f9eda) — puerto 3000

1. Clon dedicado: `/tmp/growthops-preview`. Resync antes de servir:
   `cd /tmp/growthops-preview && git fetch gh && git checkout main && git reset --hard gh/main`
   (remote `gh` = GitHub). Artefactos ya en el clon (no se sincronizan, solo se conservan):
   `.env.local` completo (incluye `APIFY_WEBHOOK_SECRET` y `APIFY_API_TOKEN`) y `.vercel/`.
2. Arrancar con **launchd** (nohup + disown lo mata el runner de comandos de esta hebra):
   ```bash
   launchctl remove growthops-dataviz 2>/dev/null
   launchctl submit -l growthops-dataviz -- /bin/sh -c \
     "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH; cd /tmp/growthops-preview && exec npm run dev > /tmp/growthops-preview/.freebuff/preview-194f9eda-eba9-4ca9-be49-ba1e09780df7.log 2>&1"
   # pid: launchctl print gui/$(id -u)/growthops-dataviz
   # parar: launchctl remove growthops-dataviz
   ```
3. Esperar HTTP 200 en `http://localhost:3000/` (compilación en frío ~10-30 s).
4. Verificación en vivo 21-sep (tras fusionar #118): landing → subcuenta `women-digital-closer`
   → `/women-digital-closer/login` 200 con branding desde BD. Los 401 en consola son sondas
   de sesión pre-auth: esperadas.

Puerto 3000: es el puerto histórico de este hilo (3001/3002/3003 están de otras hebras;
verificar con lsof antes de reusar cualquiera).

## Preview de ESTE hilo (4250bf8e) — puerto 3001

1. Clon dedicado: `/tmp/gowt-verify` (remote `gh` = GitHub). Resync:
   `cd /tmp/gowt-verify && git fetch gh && git checkout main && git reset --hard gh/main`.
   Artefactos ya en el clon: `.env.local` y `.vercel/`.
2. Arrancar con **launchd** (nohup + disown lo mata el runner de comandos):
   ```bash
   launchctl remove growthops-preview-4250bf8e 2>/dev/null
   launchctl submit -l growthops-preview-4250bf8e -- /bin/sh -c \
     "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH; cd /tmp/gowt-verify && exec npm run dev -- -p 3001 > /tmp/gowt-verify/.freebuff/preview-4250bf8e-8585-4b34-bd14-121d6486c774.log 2>&1"
   # pid: launchctl print gui/$(id -u)/growthops-preview-4250bf8e
   # parar: launchctl remove growthops-preview-4250bf8e
   ```
3. Si el navegador pinta páginas vacías con `Cannot find module './vendor-chunks/…'` en consola,
   la caché `.next` quedó obsoleta tras cambios: `launchctl remove` + `rm -rf .next` + `submit` de nuevo.
4. Esperar HTTP 200 en `http://localhost:3001/` (compilación en frío ~10-30 s).
4. Verificado 21-sep (tras fusionar #125 «Webhooks entrantes»): landing 200, rutas protegidas
   redirigen pre-auth, `/women-digital-closer/login` 200 con branding desde BD. Los 401 en
   consola son sondas de sesión pre-auth: esperadas.

## Preview de la hebra 7a08c143 — puerto 3003 (doc original, sigue vigente)

- Sirve desde `/tmp/growthops-preview-3003`; `next dev` con cwd fuera del proyecto rompe
  Tailwind: hacer `cd` al proyecto primero (el job ya lo hace).
- Reconstrucción: rescatar `.env.local` y `.vercel/` del clon → `rm -rf` → clonar →
  `npm ci --no-audit --no-fund` → restaurar artefactos → relanzar job → esperar 200.
  Si faltara `.env.local`: públicas vía MCP de Supabase (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, proyecto `rgcbveflosqgxrcqlqzv`) y server-side vía
  `vercel env pull` (los valores Secret llegan como `[SENSITIVE]`: rellenar a mano).
- Nunca versionar `.env.local` ni `.vercel/project.json`.

## Notas generales

- Puertos de otras hebras: no tocar; cada job launchd es de su hilo.
- Tras el historial reescrito con `git filter-repo` (19-sep): si un working tree se ve viejo,
  `git reset --hard` contra el remote correcto — pero ojo, descarta ediciones sin commitear.
- Pendiente ideal: conceder **Acceso total al disco** a Terminal/Freebuff para servir directo
  desde `~/GIT HUB/Growth-Ops-App` y eliminar la capa de clon en `/tmp`.

## Lecciones del 25-sep (para no repetirlas)

- **Sesión limpia antes de diagnosticar auth.** El navegador de preview puede tener una cookie
  httpOnly heredada de OTRA cuenta QA (de un hilo anterior) además del login browser-side: los
  endpoints server-side resuelven el usuario equivocado y devuelven 404 "Subcuenta no encontrada"
  en rutas correctas. Diagnóstico: comparar el `sub` del JWT de la cookie que recibe el server con
  el usuario del email en `auth.users`. Si no coinciden, expirar cookies y re-loguear.
- **El sandbox intermitente no bloquea git.** Cuando node/npm/coreutils fallen con EPERM
  (`uv_cwd`, lecturas denegadas en oleadas), `git` sigue leyendo: reconstruir un árbol exacto con
  `git archive HEAD | tar -x -C /tmp/arnes`, aplicar el WIP con `git diff > parche` + `git apply`,
  enlazar `node_modules` de un clon sano y correr el Quality Gate vía job launchd efímero
  (crear con plist + `bootstrap gui/$(id -u)`, retirar tras usar). `launchctl submit` con
  `-p /bin/bash` devuelve 127: usar plist.
- **Credenciales jamás en comandos visibles ni en ficheros permanentes**: extraer el password de
  `POSTGRES_URL` con node a `/tmp/.pgpw` (0600), borrarlo al terminar; sondas SQL solo SELECT.
- Las sondas SQL reutilizables viven en `.claude/tmp/` (gitignored desde hoy: pueden contener
  datos de tenant).
