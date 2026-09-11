# Runbook: backup y restore drill

## Qué backups existen hoy
Gestionados por Supabase a nivel de plataforma (no hay ningún script propio en este repo, y no debería haberlo —
reimplementar backups a mano sería reinventar algo que la plataforma ya cubre). **NEEDS_VERIFICATION antes de
confiar en esto**: entra al dashboard de Supabase → Settings → Database → Backups, y confirma:
- Qué plan está contratado (Free/Pro/Team) y qué retención de backups incluye.
- Si Point-in-Time Recovery (PITR) está activo (solo en planes de pago) — si lo está, el RPO real puede ser de
  minutos en vez de las 24h que este documento asume por defecto.

## RPO (Recovery Point Objective) propuesto
**24 horas** como objetivo mínimo aceptable, asumiendo backup diario estándar. Ajustar a la baja (sin coste
adicional de proceso) en el momento en que se confirme que PITR está activo — en ese caso el RPO real pasa a ser de
minutos.

## RTO (Recovery Time Objective) propuesto
**4 horas** desde que se decide restaurar hasta que la app vuelve a estar operativa (restaurar Supabase + verificar
+ redeploy de Vercel si hiciera falta). No hay infraestructura propia (colas, servicios stateful) que alargue esto
más allá del tiempo que tome la restauración de la base de datos en sí.

## Restore drill — procedimiento seguro (NUNCA contra producción)

1. **Obtener backup**: desde el dashboard de Supabase del proyecto de producción, solicitar una restauración a un
   **proyecto Supabase nuevo y aislado** (no al mismo proyecto) — Supabase soporta esto para planes con backups.
2. **Restaurar en entorno aislado**: confirmar que el restore apunta al proyecto de prueba, nunca al de producción.
3. **Ejecutar validaciones**:
   - `SELECT count(*) FROM tenants;` — deben aparecer `evergreen` y `women-digital-closer`.
   - `SELECT count(*) FROM sales WHERE tenant_id = '<evergreen_id>';` y lo mismo para WDC — deben ser números
     razonables, no cero (un backup vacío es peor que no tener backup, porque da falsa confianza).
4. **Comprobar integridad**: correr `EXPLAIN` o un `SELECT` simple sobre las tablas con RLS (`sales`, `contacts`,
   `collections`) usando un usuario de prueba de cada tenant — confirmar que el aislamiento sigue intacto tras el
   restore (las políticas RLS viajan con el schema, pero verificarlo es barato y evita sorpresas).
5. **Comprobar métricas**: cargar `lib/finance/pnl.ts` con datos del proyecto restaurado (o correr la query
   equivalente a mano) para un mes conocido, y comparar contra lo que se recuerde/documente del dashboard real de
   ese mismo mes — una discrepancia grande indica que el backup no es lo que se pensaba.
6. **Documentar resultado**: fecha del drill, cuánto tardó realmente el restore, si los datos cuadraron, y
   cualquier sorpresa — apéndice a este mismo archivo o un documento nuevo con fecha en el nombre.

**Nunca se ha ejecutado este drill según la evidencia disponible en el repositorio.** Hasta que se ejecute una vez,
el RPO/RTO de arriba son objetivos, no garantías verificadas — trátalos como tales al comunicarlos a negocio.
