# Claude Code — Growth-Ops-App

Lee `PROJECT_CONTEXT.md` en la raíz del repo para el estado completo del proyecto.

## Quick start
```bash
npm run quality   # format + lint + typecheck + test + test:metrics
npm run dev       # next dev en localhost:3000
```

## MCPs del proyecto (`.mcp.json`)

Todos los servidores MCP están declarados en `.mcp.json` y funcionan vía `npx -y` / `uvx` / OAuth
hosted — **no requieren instalación global ni credenciales en el repo**. Son universales: funcionan
igual en Claude Code, Cursor, VS Code y Windsurf (copias en `.cursor/mcp.json` y `.vscode/mcp.json`).

| Servidor | Qué hace | Cuándo usarlo |
|---|---|---|
| `supabase` | BD (esquema, advisors, logs), OAuth hosted | Cualquier consulta de esquema/datos/advisors. `list_tables` primero, `get_advisors` tras DDL |
| `web-search` | Búsqueda DuckDuckGo sin API keys | Versión actual de librerías, errores de prod, docs |
| `fetch` | Traer URL como texto (requiere `uv`) | Leer docs oficiales tras buscar |
| `context7` | Docs actualizadas de librerías | Antes de usar APIs de Next/Supabase/React que puedan haber cambiado |
| `repomix` | Empaquetar repo en un archivo con conteo de tokens | Handoff entre hilos/agentes. Config en `repomix.config.json` |

Scripts equivalentes sin instalación global: `npm run mcp:supabase`, `mcp:search`,
`mcp:context7`, `mcp:repomix`, `npm run context:build` (genera `repomix-output.xml`).

## Reglas de optimización de tokens

- **Lectura modular**: nunca leas archivos completos a ciegas. Usa búsqueda por patrón con
  números de línea y luego lee solo la ventana (offset/limit) que necesitas.
- **Referencias explícitas**: cita archivos como `@ruta/al/archivo.ts` con ruta completa desde la
  raíz; para secciones grandes indica líneas (`app/x/page.tsx:120-180`).
- **Nunca procesar** `node_modules/`, `.next/`, `build/`, `coverage/`, `package-lock.json`,
  `public/` ni dumps generados (`repomix-output.xml`). Ya están excluidos en `repomix.config.json`
  y `.gitignore` — respétalo también en búsquedas y índices.
- **Compilador primero**: para corregir errores, actúa SOLO sobre la salida exacta del linter
  (`npm run lint`), typechecker (`npm run typecheck`) o tests. Ve a las líneas señaladas; no
  releeas archivos enteros.
- **BD antes que código**: para saber qué columnas existen, consulta el MCP de Supabase; no
  infieras el esquema leyendo código.
- **Responde conciso**: resúmenes con bullets, sin repetir el contenido de los archivos.

## Convenciones clave
- **Privacidad (obligatorio):** nada de tenants, personas o credenciales en commits — ni en docs,
  comentarios ni "solo en privado". Placeholders neutros y procedimiento en `docs/SECURITY_PRIVACY.md`
- Helpers de formato: `formatNumber`/`formatPercent` de `@/lib/utils` (NO inline `toLocaleString`))
- API routes: `app/api/[tenant]/evergreen/...` con `requireTenant()` de `lib/auth/`
- Tests: `tests/*.test.mjs` con Node.js test runner nativo
- Multi-tenancy: Rutas `[tenant]/...` con RLS en Supabase
- Freebuff/sandbox: Node falla con EPERM (`uv_cwd`) desde `~/Documents`; usa el clon `/tmp/growthops-preview` (ver `PROJECT_CONTEXT.md` §7)
