-- knowledge_chunks — base de conocimiento RAG del sistema (ventas y marketing).
--
-- Fuente de los chunks: las skills canónicas .claude/skills/sales-engineering.md (§1-7) y
-- .claude/skills/marketing-and-copywriting.md (§1-6), troceadas por `scripts/ingestar-knowledge.mjs`
-- con los metadatos de docs/rag_*_knowledge_schema.json. El agente (lib/ai/agent/gateway.ts) las
-- consulta vía la tool searchKnowledge → RPC match_knowledge_chunks; nunca redefinir fórmulas.
--
-- EMBEDDINGS: columna vector(1536) lista para pgvector. Extensión y columna se crean
-- condicionalmente (los planes de Supabase pueden no exponerlas); si no están, la búsqueda
-- léxica (FTS español) funciona igual y la columna se añadirá con el pipeline de embeddings.
--
-- tenant_id NOT NULL: obligatorio por el invariante multitenant
-- (tests/esquema-tenant-invariante.test.mjs). El conocimiento global de plataforma (mismas
-- skills para todas las subcuentas) se siembra replicando las filas por tenant — la RPC acepta
-- p_tenant NULL para buscar en el conocimiento compartido cuando exista.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pgvector no disponible: embeddings quedan deshabilitados (búsqueda léxica activa)';
END
$$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm no disponible: la RPC queda solo FTS (sin refuerzo de título)';
END
$$;

-- Tabla con columna embedding SOLO si pgvector está disponible: si la extensión no existe,
-- el tipo vector no existe y el CREATE TABLE moriría — se construye el DDL condicionalmente.
DO $$
DECLARE
  tiene_vector BOOLEAN;
  col_embedding TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') INTO tiene_vector;
  col_embedding := CASE WHEN tiene_vector THEN ', embedding vector(1536)' ELSE '' END;
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
      source     TEXT NOT NULL,
      module     INTEGER NOT NULL CHECK (module BETWEEN 1 AND 7),
      section    TEXT NOT NULL,
      category   TEXT NOT NULL,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      metadata   JSONB NOT NULL DEFAULT ''{}''::jsonb,
      is_active  BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, source, section)%s
    )',
    col_embedding
  );
END
$$;

COMMENT ON COLUMN public.knowledge_chunks.source IS 'Fichero canónico (p. ej. .claude/skills/sales-engineering.md)';
COMMENT ON COLUMN public.knowledge_chunks.section IS 'Ancla de la sección dentro del módulo (idempotencia de ingesta)';
COMMENT ON COLUMN public.knowledge_chunks.category IS 'Categoría RAG (docs/rag_sales_knowledge_schema.json / docs/rag_marketing_knowledge_schema.json)';
COMMENT ON COLUMN public.knowledge_chunks.content IS 'Texto a vectorizar: script/fórmula/framework sin resumir';

CREATE INDEX IF NOT EXISTS idx_kc_tenant   ON public.knowledge_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kc_category ON public.knowledge_chunks(tenant_id, category);
-- Búsqueda léxica primaria (funciona sin pgvector): FTS español sobre título+contenido.
CREATE INDEX IF NOT EXISTS idx_kc_fts_spanish
  ON public.knowledge_chunks USING gin (to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(content, '')));
-- Índice ANN para embedding (HNSW) — crear junto al pipeline de embeddings:
-- CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- Policies MÁS ESTRICTAS que el patrón general: knowledge_chunks contiene metodología interna
-- (guiones, objeciones, precios, OTEs) que NO debe llegar a colaboradores/afiliados.
-- auth_tenant_ids() devolvería su tenant y les abriría la lectura vía PostgREST: el acceso directo
-- queda cerrado a administración (super_admin de plataforma o admin/director de la subcuenta).
-- Las escrituras normales van por service_role (ingesta, bypassa RLS). Los helpers son SECURITY
-- DEFINER: sin ciclo de recursión (lección de 20260918160000).
DROP POLICY IF EXISTS kc_select ON public.knowledge_chunks;
CREATE POLICY kc_select ON public.knowledge_chunks FOR SELECT TO authenticated
  USING (is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS kc_insert ON public.knowledge_chunks;
CREATE POLICY kc_insert ON public.knowledge_chunks FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS kc_update ON public.knowledge_chunks;
CREATE POLICY kc_update ON public.knowledge_chunks FOR UPDATE TO authenticated
  USING (is_super_admin() OR is_admin_or_director())
  WITH CHECK (is_super_admin() OR is_admin_or_director());

DROP POLICY IF EXISTS kc_delete ON public.knowledge_chunks;
CREATE POLICY kc_delete ON public.knowledge_chunks FOR DELETE TO authenticated
  USING (is_super_admin() OR is_admin_or_director());

-- RPC de recuperación: búsqueda léxica (FTS español) con refuerzo de similitud trigram en el
-- título cuando pg_trgm está disponible (dos variantes del cuerpo, misma firma). El tenant lo
-- fija el SERVIDOR (parámetro p_tenant, nunca lo elige el modelo). SECURITY DEFINER solo para
-- ordenar por ts_rank sin depender de los roles del caller; no lee nada fuera de la tabla.
DO $rpc$
DECLARE
  tiene_trgm BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') INTO tiene_trgm;

  IF tiene_trgm THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
        p_query      TEXT,
        p_tenant     UUID,
        p_categories TEXT[] DEFAULT NULL,
        p_limit      INTEGER DEFAULT 5
      )
      RETURNS TABLE (
        id         UUID,
        category   TEXT,
        title      TEXT,
        content    TEXT,
        source     TEXT,
        module     INTEGER,
        section    TEXT,
        metadata   JSONB,
        similarity REAL
      )
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $body$
        SELECT
          k.id, k.category, k.title, k.content, k.source, k.module, k.section, k.metadata,
          -- Relevancia: rank FTS español (2x, domina) + parecido trigram del título (1x). La suma
          -- ponderada cubre coincidencias que solo fallan por flexión y hace estable el orden.
          (ts_rank(to_tsvector('spanish', coalesce(k.title, '') || ' ' || coalesce(k.content, '')),
                   websearch_to_tsquery('spanish', p_query)) * 2
           + similarity(k.title, p_query))::real AS similarity
        FROM public.knowledge_chunks k
        WHERE k.is_active
          -- Gate de rol en el PROPIO cuerpo de la RPC (defensa en profundidad): aunque un afiliado
          -- llamara a rpc() directamente, devolvería vacío. is_super_admin/is_admin_or_director son
          -- SECURITY DEFINER pero leen auth.uid() del JWT del caller: evalúan a quien llama.
          AND (is_super_admin() OR is_admin_or_director())
          AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
          AND (p_categories IS NULL OR k.category = ANY (p_categories))
          AND (
            to_tsvector('spanish', coalesce(k.title, '') || ' ' || coalesce(k.content, ''))
              @@ websearch_to_tsquery('spanish', p_query)
            OR similarity(k.title, p_query) > 0.3
          )
        ORDER BY similarity DESC
        LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
      $body$;
    $fn$;
  ELSE
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
        p_query      TEXT,
        p_tenant     UUID,
        p_categories TEXT[] DEFAULT NULL,
        p_limit      INTEGER DEFAULT 5
      )
      RETURNS TABLE (
        id         UUID,
        category   TEXT,
        title      TEXT,
        content    TEXT,
        source     TEXT,
        module     INTEGER,
        section    TEXT,
        metadata   JSONB,
        similarity REAL
      )
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
      AS $body$
        SELECT
          k.id, k.category, k.title, k.content, k.source, k.module, k.section, k.metadata,
          ts_rank(to_tsvector('spanish', coalesce(k.title, '') || ' ' || coalesce(k.content, '')),
                  websearch_to_tsquery('spanish', p_query))::real AS similarity
        FROM public.knowledge_chunks k
        WHERE k.is_active
          AND (is_super_admin() OR is_admin_or_director())
          AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
          AND (p_categories IS NULL OR k.category = ANY (p_categories))
          AND to_tsvector('spanish', coalesce(k.title, '') || ' ' || coalesce(k.content, ''))
                @@ websearch_to_tsquery('spanish', p_query)
        ORDER BY similarity DESC
        LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
      $body$;
    $fn$;
  END IF;
END
$rpc$;

-- La RPC expone contenido interno: solo roles autenticados de la app y service_role.
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER) TO authenticated, service_role;
