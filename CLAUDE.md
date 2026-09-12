# Instrucciones para Claude Code — Growth-Ops-App

Antes de realizar cualquier modificación, lee completamente `AGENTS.md` y considéralo normativa obligatoria para este repositorio. Este archivo NO repite esas reglas: solo añade cómo aplicarlas trabajando como Claude Code. Si algo de aquí contradice a `AGENTS.md`, gana `AGENTS.md`.

Para criterios detallados (arquitectura, base de datos, seguridad, rendimiento, observabilidad, protocolos de revisión), consulta `docs/DEVELOPMENT_RULES_FULL.md` — solo la parte relevante a la tarea, no el archivo entero de memoria.

## Prioridad cuando hay conflicto de instrucciones

1. Reglas del sistema/herramienta (Claude Code).
2. `AGENTS.md`.
3. Este archivo (`CLAUDE.md`).
4. Documentación de arquitectura del proyecto (`docs/DEVELOPMENT_RULES_FULL.md`, ADRs si existen).
5. La tarea concreta que pide el usuario.

## Antes de escribir código

No empieces por el código. Para cualquier tarea no trivial, resuelve internamente (no hace falta mostrarlo entero al usuario):
`TASK → CURRENT IMPLEMENTATION → DEPENDENCIES → ROOT CAUSE → RISKS → MINIMAL SOLUTION → TEST STRATEGY`.

Eso implica, antes de tocar nada:
- Leer los archivos relacionados con la tarea (no el repo entero).
- Buscar si ya existe una implementación equivalente (componente, hook, helper, service, endpoint, tipo, tabla, columna) antes de crear una nueva.
- Si la tarea toca datos: revisar el schema actual, las migraciones existentes en `supabase/migrations/` y quién consume esa tabla/columna.
- Si la tarea toca un bug: reproducirlo y encontrar la causa raíz antes de tocar código (no parchear el síntoma).

Amplía el contexto leído solo cuando la tarea lo exija — evita cargar archivos grandes o áreas del repo sin relación directa.

## Al modificar

- Cambio mínimo correcto. Nada de refactors, abstracciones, dependencias o "limpiezas" no pedidas.
- Si encuentras deuda técnica fuera del alcance de la tarea, anótala en tu resumen final como `OUT_OF_SCOPE_FINDING` y no la toques — salvo que sea un riesgo real de seguridad, corrupción de datos, o bloquee directamente la tarea.
- Nunca uses `any`, `@ts-ignore`, deshabilitar lint/tests, `sleep` arbitrario, catch vacío, desactivar RLS o eliminar constraints para "hacer que pase". Si algo bloquea, investiga la causa.
- Si la tarea toca Supabase: revisa RLS (SELECT/INSERT/UPDATE/DELETE explícitas), ownership, multitenancy (`tenant_id`), constraints/índices, y si el service role se está usando donde no toca. Nunca resuelvas un bug desactivando RLS.
- Todo cambio de esquema va por migración versionada, nunca por el Dashboard a mano.
- Para auth/permisos/organizaciones/datos privados/uploads/webhooks, pregúntate explícitamente: *¿puede otro usuario acceder a esto cambiando un ID?*
- Nada destructivo en producción sin confirmación explícita del usuario: `DROP`, `TRUNCATE`, `DELETE` masivo, migraciones irreversibles, borrado de buckets. Para en seco y pregunta si hay riesgo real de pérdida de datos.

## Después de modificar

Ejecuta las comprobaciones disponibles y relevantes al cambio (lint, typecheck, tests unitarios/integración, build, tests de RLS si existen). Si una herramienta no existe en el repo, dilo como `NOT AVAILABLE` — nunca afirmes que algo se probó si no se ejecutó.

Distingue siempre `INSPECTED` (lo leíste) de `TESTED` (lo ejecutaste) de `VERIFIED` (lo confirmaste corriendo/en el entorno real). "Inspeccioné el RLS" no es "probé el RLS"; "el build pasa" no es "el E2E pasa".

Antes de dar por terminada una tarea significativa, revisa tu propio diff buscando: errores obvios, permisos, race conditions, duplicación, código muerto, invalidación de caché, requests innecesarios, estado duplicado, manejo de errores y regresiones.

## Resumen final

Para tareas significativas, cierra con algo equivalente a:

```
IMPLEMENTED: qué cambió y por qué (causa raíz si era un bug)
VALIDATION: qué se ejecutó realmente y su resultado (PASS / FAIL / NOT AVAILABLE / NOT APPLICABLE)
SECURITY / DATA IMPACT: qué tocaste en auth, RLS, multitenancy o datos, si aplica
REMAINING RISKS: qué queda pendiente o sin cubrir
```

Sin relleno tipo "todo parece bien" sin evidencia detrás.

## Nota sobre Codex

Codex (CLI de OpenAI) lee `AGENTS.md` de forma nativa como su archivo de instrucciones del repositorio, igual que Claude Code lee `CLAUDE.md`. Por eso no existe un archivo `CODEX.md` aparte: crear uno duplicaría `AGENTS.md` sin necesidad. Si en el futuro Codex necesita algo que no aplique a Claude Code, añádelo aquí como sección propia en vez de crear un archivo nuevo.

Claude Code debe respetar especialmente la sección **Relevo Codex ↔ Claude Code y disciplina de ramas** de `AGENTS.md`: no debe abrir una rama nueva si Codex dejó una rama o PR activo, y debe publicar o documentar el relevo antes de terminar su contexto.
