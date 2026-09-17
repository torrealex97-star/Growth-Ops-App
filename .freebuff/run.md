# Run doc — Growth-Ops-App (preview)

## Estado actual (funcionando)

- El preview corre desde la **copia en `/tmp/growthops-preview`** (clon del repo en el mismo commit `main`), porque el sandbox del agente no puede leer `~/Documents` (TCC de macOS pendiente de conceder a Terminal/Freebuff).
- **Puerto: 3000** (el 3001 puede ser usado por otra hebra).
- Server lanzado como job de launchd persistente:
  ```bash
  NODE=/Users/[tenant]/Library/Caches/ms-playwright-go/1.57.0/node
  launchctl submit -l growthops-dev -- /bin/sh -c \
    "cd /tmp/growthops-preview && exec '$NODE' node_modules/next/dist/bin/next dev --port 3000 > /tmp/growthops-dev.log 2>&1"
  # pid: launchctl print gui/$(id -u)/growthops-dev
  # parar: launchctl remove growthops-dev
  ```
- **Dos previews pueden coexistir** (una por hebra): puerto 3000 con job `growthops-dev` (log `/tmp/growthops-dev.log`) y puerto 3001 con job `growth-ops-3001`. No hacer `launchctl remove` del job de la otra hebra.
- `.env.local` reconstruido con claves públicas de Supabase MCP (ver método abajo). Nunca versionar.
- **Vercel CLI** instalado globalmente (`npm install -g vercel` desde `/tmp`). Auth guardada en `~/.vercel/`.
- **Vinculación del clon (2026-09-17):** `npx vercel link --yes --project growth-ops` en `/tmp/growthops-preview` (crea `.vercel/project.json`, no versionar). Para env vars: `npx vercel env pull .env.local --environment production --yes` — trae los valores NO secret ya resueltos; los 11 valores marcados como **Secret** en Vercel llegan como placeholder `[SENSITIVE]` (Vercel no permite descargarlos). Los Secret se rellenan a mano desde Supabase dashboard (Settings → API) o Vercel dashboard.
- **Hardening aplicado en producción (2026-09-17)** vía Edge Function efímera (ya retirada, responde 410): 28/28 sentencias DCL, verificado — `is_super_admin` por RPC anon ahora da 401; advisor ya no lista funciones ejecutables por `anon`.
- Nota: arrancar `next dev` con cwd FUERA del proyecto rompe Tailwind (`content` no resuelve); hacer `cd` al proyecto primero.

## Reproducir artefactos (checkout fresco)

1. Clonar/copyar el repo (a `/tmp` si el sandbox sigue bloqueando `~/Documents`).
2. **Construir `.env.local`** con las claves públicas de Supabase MCP + las server-side keys de Vercel:
   - **Públicas** (vía MCP): `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` → disponibles via `get_project_url` y `get_publishable_keys` en el MCP de Supabase (proyecto `rgcbveflosqgxrcqlqzv`).
   - **Server-side** (requieren `vercel env pull` o copia manual del dashboard): `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL`, `ANTHROPIC_API_KEY`, `CONFIG_ENC_KEY`, `SEQURA_MCP_TOKEN`.
   - Sin las server-side keys, la app carga pero las APIs de suggestions/commissions/integraciones dan 500.
3. `bun install` (hay `bun.lockb`). El PATH del shell no tiene Node: usar `/Users/[tenant]/Library/Caches/ms-playwright-go/1.57.0/node`.

## Pendiente para servir desde el worktree real (Documentos)

- Conceder **Acceso total al disco** a Terminal y Freebuff (Ajustes del Sistema → Privacidad y seguridad). Entonces: `cd "<repo>" && npm run dev` servirá directamente desde Documentos y la copia de /tmp dejará de ser necesaria.
