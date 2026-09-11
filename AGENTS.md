# Guía operativa para agentes

Estas reglas son obligatorias para cualquier agente que modifique este repositorio.
GitHub `main` es la fuente de verdad del código. Supabase es la fuente de verdad de los datos persistentes y Vercel despliega la aplicación.

## Flujo de trabajo

1. Antes de editar, sincroniza e inspecciona únicamente los archivos relacionados con la tarea.
2. Busca implementaciones existentes y reutiliza la solución canónica.
3. Realiza el cambio correcto más pequeño; evita refactors o dependencias no solicitados.
4. Verifica el resultado en proporción al riesgo: lint, typecheck, tests y build disponibles.
5. Revisa tu propio cambio buscando regresiones, duplicación, permisos incorrectos y código muerto.
6. Resume los cambios, comprobaciones y riesgos pendientes al finalizar.

No sobrescribas cambios del usuario ni uses operaciones destructivas de Git. Trabaja en una rama o commit acotado cuando corresponda.

No pidas permiso para inspeccionar archivos, buscar referencias, ejecutar lint/typecheck/tests/build o corregir bugs relacionados directamente con la tarea. Detente y pide al usuario cuando: falten credenciales, haya riesgo real de pérdida de datos, una acción destructiva afecte producción, exista una decisión de producto/negocio que no puedas inferir, o el cambio sea financiero/legal. No bloquees el resto del trabajo si puedes seguir con otras partes.

Evita patrones de "vibe coding": no añadas código hasta que desaparezca un error sin entenderlo, no dupliques un archivo para no tocar el original, no le pongas `V2`/`new`/`final`/`fixed` a algo que debería reemplazar al original, no crees una tabla nueva porque no entiendes la existente. Antes de terminar, elimina `console.log` de depuración, código comentado y TODOs temporales que hayas introducido.

## Arquitectura y código

- Mantén una sola fuente de verdad para cada dato y una implementación canónica para cada operación empresarial.
- Los componentes de UI se ocupan de presentación, interacción y estado visual; la lógica empresarial y la autorización viven en servidor o base de datos.
- Valida toda entrada externa. La validación del frontend mejora UX; la del servidor protege; los constraints preservan integridad.
- No uses `any`, `@ts-ignore`, excepciones ignoradas ni workarounds que oculten la causa real.
- Evita `SELECT *`, N+1, waterfalls, polling y cargas completas cuando se pueda filtrar, ordenar o paginar en PostgreSQL.
- No añadas capas, abstracciones, caché, índices o dependencias sin una necesidad demostrable.
- Para bugs: reproduce, localiza la causa raíz, corrige y añade una prueba de regresión cuando sea razonable.

## Seguridad, Supabase y multitenancy

- Nunca expongas secretos, tokens, service-role keys, stack traces ni datos de otros usuarios.
- No confíes en IDs, roles u organizaciones recibidos desde el cliente. Autoriza en servidor y/o mediante RLS.
- Toda tabla accesible por Supabase debe tener RLS explícita para `SELECT`, `INSERT`, `UPDATE` y `DELETE`.
- Toda tabla de negocio multitenant debe incluir `tenant_id`, constraints e índices apropiados; prueba aislamiento entre organizaciones.
- Los cambios de esquema deben ser migraciones reproducibles. No dependas de cambios manuales del Dashboard.
- Antes de aplicar una migración: inspecciona esquema y consumidores, ejecuta lint y `db push --dry-run`, define compatibilidad y rollback.
- Pagos, webhooks, imports y reintentos deben ser idempotentes; las operaciones multi-step críticas deben ser atómicas.
- Nunca realices cambios destructivos en producción sin autorización explícita, backup y estrategia de rollback.

## Integraciones y despliegue

- Las APIs externas deben contemplar timeout, errores, rate limits, reintentos e idempotencia.
- Las funciones de Vercel no pueden depender de memoria local persistente.
- GitHub debe activar los despliegues normales de Vercel; evita despliegues manuales que creen divergencia.
- No afirmes que producción quedó actualizada sin verificar el despliegue y el flujo afectado.

## Definition of Done

Una tarea termina cuando funciona el comportamiento solicitado, se mantienen seguridad e integridad, pasan las comprobaciones relevantes y se actualiza la documentación necesaria. No declares éxito si queda un fallo relacionado con el cambio.

Si varias mejoras entran en conflicto, prioriza en este orden: protección contra pérdida de datos → seguridad → integridad de datos → funcionalidad → fiabilidad → compatibilidad → rendimiento → simplicidad → mantenibilidad → coste → elegancia. Nunca sacrifiques seguridad o integridad por código más limpio.

Distingue siempre `inspeccionado` (leíste el código) de `probado` (lo ejecutaste) de `verificado` (lo confirmaste en producción/staging real) — no afirmes lo segundo o tercero si solo hiciste lo primero. Si falta infraestructura para probar algo (tests, CI, staging), dilo explícitamente como hueco pendiente en vez de asumir que está cubierto.

Al cerrar una tarea significativa, resume: qué cambió, la causa raíz si era un bug, qué comprobaciones se ejecutaron realmente (con su resultado — usa `no disponible` si una herramienta no existe, nunca inventes un resultado), y los riesgos reales que quedan pendientes. Sin relleno.

## Referencia ampliada

Consulta `docs/DEVELOPMENT_RULES_FULL.md` solamente cuando la tarea requiera criterios detallados de arquitectura, base de datos, seguridad, rendimiento, observabilidad o protocolos de revisión.
