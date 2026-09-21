# Claude Code — Growth-Ops-App

## Plan de implementación

Fuente autoritativa: `docs/plan/`. Empieza siempre por `docs/plan/README.md`.
Por sesión carga solo: `00-constitucion.md`, `07-prompts-base.md` (P0), el prompt de la fase
(`08` o `09`) y los documentos que indique la matriz del README para esa fase.
Una fase = una rama = un PR. No apliques migraciones de producción sin confirmación.

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

| Servidor     | Qué hace                                           | Cuándo usarlo                                                                                |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `supabase`   | BD (esquema, advisors, logs), OAuth hosted         | Cualquier consulta de esquema/datos/advisors. `list_tables` primero, `get_advisors` tras DDL |
| `web-search` | Búsqueda DuckDuckGo sin API keys                   | Versión actual de librerías, errores de prod, docs                                           |
| `fetch`      | Traer URL como texto (requiere `uv`)               | Leer docs oficiales tras buscar                                                              |
| `context7`   | Docs actualizadas de librerías                     | Antes de usar APIs de Next/Supabase/React que puedan haber cambiado                          |
| `repomix`    | Empaquetar repo en un archivo con conteo de tokens | Handoff entre hilos/agentes. Config en `repomix.config.json`                                 |

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

- **Skill sales-engineering (obligatoria antes de codificar ventas):** cualquier trabajo sobre flujos de ventas, CRM, agents de IA comerciales, secuencias SMS/email, dashboards de KPIs comerciales o landing pages de captación DEBE consultar primero `.claude/skills/sales-engineering/SKILL.md` (enlace a `.agents/skills/sales-engineering/SKILL.md`; módulos 1-7: pre-llamada, cierre, objeciones, post-llamada, hiring, frame control, metrología). Las fórmulas de KPIs del §7 son canónicas — no se redefinen en código; los scripts provienen de las categorías RAG de `docs/rag_sales_knowledge_schema.json` y el system prompt del agente vive en `src/prompts/sales_agent_system_prompt.ts`
- **Skill marketing-and-copywriting (obligatoria antes de escribir marketing):** consulta
  `.claude/skills/marketing-and-copywriting/SKILL.md` antes de escribir o programar páginas de aterrizaje,
  copys, VSLs, campañas o analizar métricas de marketing (módulos 1-6: UVP/ángulos, avatares/ICP,
  embudos, swipe file de copy, marketing economics, árboles de diagnóstico). Las fórmulas del §5
  (CAC, ROAS, CPL, CPQBC, LTGP:CAC...) son canónicas — no se redefinen en código; los copy/scripts
  provienen de las categorías RAG de `docs/rag_marketing_knowledge_schema.json` y el system prompt
  del agente de marketing vive en `src/prompts/marketing_agent_system_prompt.ts`
- **Privacidad (obligatorio):** nada de tenants, personas o credenciales en commits — ni en docs, comentarios ni "solo en privado". Placeholders neutros y procedimiento en `docs/SECURITY_PRIVACY.md`
- Helpers de formato: `formatNumber`/`formatPercent` de `@/lib/utils` (NO inline `toLocaleString`))
- API routes: `app/api/[tenant]/evergreen/...` con `requireTenant()` de `lib/auth/`
- Tests: `tests/*.test.mjs` con Node.js test runner nativo
- Multi-tenancy: Rutas `[tenant]/...` con RLS en Supabase
- Freebuff/sandbox: Node falla con EPERM (`uv_cwd`) desde `~/Documents`; usa el clon `/tmp/growthops-preview` (ver `PROJECT_CONTEXT.md` §7)
- **Gráficas (skill data-visualization-pro):** Recharts con tokens de diseño — `hsl(var(--brand-500) / alpha)` en fill/stroke, nunca hex hardcodeados; anillos ≤5 porciones (top-4 + "Otros"), % textual en la leyenda (el color nunca es el único encoding). Verificar el RENDER real en preview (`getComputedStyle` del elemento Recharts + `preview_logs`), no solo typecheck (ver `PROJECT_CONTEXT.md` §13)
- **`git` Lee Documentos aunque el shell no pueda:** `git hash-object -w <fichero>` + `git cat-file blob <sha>` extrae el contenido de `~/Documents` a `/tmp` sin TCC (base del flujo: extraer → procesar en /tmp → `checkout-index`/índice temporal para escribir de vuelta). Nunca `cp` directo ni leer `.env.local` con tools de fichero (bloqueo de secretos).
- **BD por pooler, no host directo:** `db.<ref>.supabase.co` es IPv6-only aquí; conecta vía `aws-1-eu-west-1.pooler.supabase.com:6543` (`postgres.<ref>`, `ssl: 'require'`, `prepare: false`) — ver `PROJECT_CONTEXT.md` §7
- **El clon `/tmp` es compartido entre hebras:** re-verifica que tu cambio sigue en disco antes de validar/commitear (otra sesión puede restaurar ficheros); commitea acotado y alinea con `origin/main` antes de pushear (ver `PROJECT_CONTEXT.md` §12.8)
- **CI: solo main y PRs, con `cancel-in-progress`:** un run "cancelled" no es un error — valida el ÚLTIMO commit (`gh run list --commit <sha>`), no el precedente (ver `PROJECT_CONTEXT.md` §12.6)
