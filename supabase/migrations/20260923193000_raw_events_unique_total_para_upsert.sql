-- El upsert de la capa en bruto (F1) no puede funcionar con el índice parcial.
--
-- 20260915100000 creó el índice único de ingesta como PARCIAL
-- (where source_event_id is not null) a propósito: las fuentes sin id propio —un
-- page_view de navegador— no traen id, y un único total colapsaría esas entregas.
--
-- El webhook de GHL (#180) y el de Stripe (#182) después introdujeron el upsert
-- `on conflict (tenant_id, source, source_event_id)` en su camino de ingesta, y
-- PostgreSQL rechaza ON CONFLICT contra índices parciales ("there is no unique or
-- exclusion constraint matching the ON CONFLICT specification"): Postgres exige que
-- el índice sin predicado coincida exactamente con el objetivo. Resultado verificado
-- en producción (23-sep): la capa F1 —sobres en raw_events, hechos canónicos y la
-- capacidad de replay— llevaba inoperativa desde su despliegue, silenciosamente
-- (el webhook se degrada y responde 200 igual).
--
-- El índice pasa a TOTAL. PostgreSQL permite infinitas filas con source_event_id
-- NULL en un único de varias columnas (los NULL nunca chocan entre sí), así que la
-- semántica que motivó el parcial se preserva: las entregas sin id siguen coexistiendo.
-- Verificado por dry-run transaccional antes de aplicar: 2 entregas idénticas →
-- 1 fila; 2 entregas con source_event_id NULL → 2 filas.

drop index if exists public.raw_events_tenant_source_event_key;

create unique index if not exists raw_events_tenant_source_event_key
  on public.raw_events (tenant_id, source, source_event_id);
