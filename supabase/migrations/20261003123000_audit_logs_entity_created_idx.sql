-- RENDIMIENTO — la lectura de auditoría de una entidad sin índice.
--
-- pg_stat_statements (3-oct): el listado de auditoría de una entidad que hace la app vía
-- PostgREST — `WHERE entity_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT …` —
-- acumulaba 858 llamadas × ~35 ms de media (29 s totales): audit_logs tenía índices para
-- tenant_id y actor_user_id, pero NO para entity_id, así que cada consulta rastreaba la
-- tabla (seq scan) para luego ordenar por created_at.
--
-- Índice compuesto: las dos igualdades primero y el orden del ORDER BY al final, para que
-- el plan sea un único index scan con el orden ya resuelto.
create index if not exists audit_logs_entity_tenant_created_idx
  on public.audit_logs (entity_id, tenant_id, created_at desc);
