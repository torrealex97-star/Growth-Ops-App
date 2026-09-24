# Growth Operator OS — Plan de implementación (docs/plan/)

Versión: 1.6 (plan v1.5 reorganizado para Claude Code, con los 8 cambios de fondo aplicados el 2026-09-20). Sustituye al documento único de 112 secciones. El registro de qué cambió está en `99-cambios-aplicados.md`.

Orden de ejecución: S0 tramo 1 → A0 → F-1 → S0 tramo 2 → F1 → F2 → F3 → F7 → F4 → F6 → IA cualitativa → F5 → F0 → F8 → F9. Una sola fase activa a la vez.

Antes de arrancar F1 completa los marcadores `[definir]` de la etapa A en `00-constitucion.md` §2.

## Cómo usar estos documentos con Claude Code

1. `CLAUDE.md` y `AGENTS.md` del repo solo deben contener un mapa corto y un puntero a este directorio. No copies aquí las reglas.
2. Una sesión = una fase. Carga solo: `00-constitucion.md`, `07-prompts-base.md` (P0), el prompt de la fase (docs 08 o 09) y los documentos temáticos que la matriz de abajo indique.
3. Cada documento cabe en menos de 10 páginas y empieza con "Cuándo cargarlo". No cargues los demás.
4. Un prompt = una rama = un PR. Al cerrar una fase, actualiza solo el documento autoritativo afectado.

## Índice

| Doc                     | Contenido                                                                                                                | Origen en v1.5               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| 00-constitucion         | Tesis, principios, estado real, roadmap, dependencias, definición de terminado, riesgos, decisiones, reglas de prioridad | §0–4, 12–16, 76–88, 92       |
| 01-arquitectura-datos   | Tenancy, identidad, eventos, conectores, semántica, money, atribución, contratos con SQL                                 | §5–8, 53–56, 91 y Anexo v1.2 |
| 02-seguridad-privacidad | Estado de seguridad, roles, audit, hardening, RGPD, erase_person                                                         | §10–11, 41–42, 45–47         |
| 03-operacion-fiabilidad | Observabilidad, backups, entornos, migraciones, flags, lifecycles, Data Health, runbooks                                 | §17–24, 48, 68–69, 71–72     |
| 04-ia-agente            | Tools, Command Engine, prompt injection, evals, costes, Weekly Brief, call intelligence                                  | §9, 49–52                    |
| 05-producto-frontend    | Design system, UX, navegación, filtros, estados, notificaciones, ficheros, admin                                         | §25–40, 43–44, 70, 73–75, 90 |
| 06-calidad-gobierno     | Testing, quality gate, Definitions of Done, gobierno de agentes, ADRs, revisión de arquitectura                          | §57–67, 84–85, 89, 93        |
| 07-prompts-base         | Protocolo P0 y prompts especializados                                                                                    | Partes 4 y 5 (P0)            |
| 08-fases-s0-f4          | Prompts S0, A0, F-1, F0, F1, F2, F3, F4                                                                                  | Parte 5                      |
| 09-fases-f5-f9          | Prompts F5 a F9 y reglas de merge                                                                                        | Parte 5                      |
| 99-cambios-aplicados    | Registro de los cambios de fondo aplicados y lo que queda por definir                                                    | —                            |

## Matriz de carga por fase (además de 00 y 07)

| Fase     | Prompt | Documentos temáticos |
| -------- | ------ | -------------------- |
| S0       | 08     | 05, 06               |
| A0 y F-1 | 08     | 02, 03               |
| F0       | 08     | 01, 02               |
| F1       | 08     | 01, 03               |
| F2       | 08     | 01, 03, 06           |
| F3       | 08     | 01, 06               |
| F4       | 08     | 01, 04, 06           |
| F5       | 09     | 02, 04               |
| F6       | 09     | 02, 03               |
| F7       | 09     | 01                   |
| F8       | 09     | 01, 02, 03           |
| F9       | 09     | 04, 05               |

## Estado del 2026-09-20

- Aplicado en producción (Supabase): EXECUTE de `match_knowledge_chunks` revocado a `anon` y gate de pertenencia al tenant; RLS activado en las 3 tablas de `backup_20260914`. SQL en `20260920090000_...` y `20260920100000_...`, pendientes de commitear.
- Pendiente solo tuyo: repo privado o recreado, rotación de credenciales, leaked password protection.
- Pendiente de revisar: Vercel (deployments, errores, nombres de variables, crons).

## Verificación del 2026-09-21 (Claude Code)

Comprobado ejecutando contra el repo, la API de Vercel y los secrets de GitHub. Corrige o cierra
varios puntos del bloque anterior y de los documentos temáticos. **Donde este bloque contradiga a
otro documento, manda este**, y el documento afectado se corrige en su propio PR.

| Punto del plan                                                       | Estado real                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A0 "falta Vercel" (doc 08)                                           | **Cerrada.** Salida en `docs/A0-CIERRE-AUDITORIA.md`                                                                                                                                                   |
| "9 crons en GitHub Actions" (docs 02 §1, 03 §11)                     | Son **8**, más 2 en `vercel.json`. Ningún endpoint está en los dos sitios: **no hay doble ejecución**                                                                                                  |
| "64 ficheros de migración" (doc 02 §1)                               | Son **66**                                                                                                                                                                                             |
| Las 2 migraciones de seguridad del 20-sep                            | **Siguen sin commitear.** Producción tiene DDL de seguridad que el repo no reproduce                                                                                                                   |
| Test invariante de tenant "por comprobar si corre en CI" (doc 02 §1) | **Sí corre**: `ci.yml` le pasa `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` a `npm test`. Se auto-salta solo en local sin credenciales. **Falta** el test negativo que demuestre que falla cuando debe |
| `roles_select` con `USING (true)` (doc 02 §1)                        | **Ya decidido**: aceptado y documentado en `20260919110000_rls_tenant_isolation_remediation.sql` como catálogo de plataforma                                                                           |
| Repo público (doc 02 §1)                                             | **Confirmado público.** `gitleaks` sobre el historial completo corre en cada push y PR                                                                                                                 |
| Prompt injection sobre tools de lectura (F-1)                        | **Hecho**: `tests/agente-contenido-hostil.test.mjs`, 12 tests. Encontró y corrigió un fallo real en `autorizarTool` (nombres de `Object.prototype` salían autorizados)                                 |

Hallazgos nuevos que el plan no recogía, detallados en `docs/A0-CIERRE-AUDITORIA.md`:

- `RESEND_API_KEY` guardada en Vercel como valor **legible** (`readable-secret`) en los tres entornos. P1: rotar y recrear como sensible.
- `CRON_SECRET` existe **solo en Production**. En Preview todo cron responde 401, lo que bloquea el staging que F1 necesita.
- `ci.yml` justifica su recorte con "repo privado: cada minuto cuenta contra la cuota". El repo es público y los runners no consumen cuota: la premisa no se sostiene.
- El proyecto `go-prod` de Vercel está vacío (`live: false`, sin dominios ni despliegues).

Falta en este directorio: `99-cambios-aplicados.md`, que el índice referencia y no se entregó.
`00-constitucion.md` sí está, con tres enmiendas acordadas el 2026-09-20 (F6 adelantada tras F-1;
congelada la ingesta con PII al RAG hasta cerrar F6; reconocimiento del desvío del 13 al 20 de
septiembre).

## Puntero para CLAUDE.md y AGENTS.md (pégalo, no copies el contenido)

```
## Plan de implementación
Fuente autoritativa: docs/plan/. Empieza siempre por docs/plan/README.md.
Por sesión carga solo: 00-constitucion.md, 07-prompts-base.md (P0), el prompt de la fase
(08 o 09) y los documentos que indique la matriz del README para esa fase.
Una fase = una rama = un PR. No apliques migraciones de producción sin confirmación.
```
