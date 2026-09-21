-- F-1 higiene de seguridad (aplicada 2026-09-20).
-- 1) match_knowledge_chunks: la migración original hacía REVOKE FROM PUBLIC, pero anon conservaba EXECUTE
--    por los privilegios por defecto de Supabase. La RPC ya devuelve vacío a anon por su gate de rol, pero
--    no debe ser invocable sin sesión. authenticated y service_role se mantienen.
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(text, uuid, text[], integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(text, uuid, text[], integer, public.vector) FROM anon;

-- 2) Esquema de backup con copias de ventas y cobros: RLS activado sin políticas (bloquea anon y
--    authenticated; postgres y service_role siguen accediendo). No se borra nada.
ALTER TABLE backup_20260914.sales_pre_merge ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_20260914.collections_pre_merge ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_20260914.sales_pre_facturacion ENABLE ROW LEVEL SECURITY;
