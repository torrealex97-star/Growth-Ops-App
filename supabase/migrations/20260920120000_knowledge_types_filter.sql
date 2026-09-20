-- P_TYPES: filtrar la recuperación RAG por TIPO de contenido (metadata->>'type'), además de por
-- categoría. Tipo = qué ES el fragmento (guion textual, fórmula, framework, secuencia, checklist)
-- — el enum canónico lo declaran docs/rag_*_knowledge_schema.json:
--   script | formula | framework | sequence | checklist (+ swipe solo en marketing;
--   la ingesta normaliza swipe → script para un único espacio de filtrado).
-- Los chunks existentes llevan metadata.type = 'framework' plano (ingesta anterior); la
-- re-ingesta (scripts/ingestar-knowledge.mjs) los enriquece con el tipo real y tags de rol.
--
-- Compatibilidad de callers: la firma pasa de 5 a 6 argumentos (p_types TEXT[] DEFAULT NULL,
-- SIEMPRE el último). En Postgres, el positional binding de PostgREST usa la firma completa y
-- los callers JS (sb.rpc) nombran los parámetros — pero una RPC renombrada/eliminada rompería
-- el cacheo del schema cache: en lugar de reemplazar la de 5 args, se CONSERVA como envoltorio
-- que delega en la de 6. Los callers existentes (lib/ai/knowledge.ts, pruebas E2E) no cambian;
-- el filtro nuevo llega solo cuando el caller lo envía.
--
-- Sin pgvector/columna embedding: mismo filtro p_types en la rama léxica pura (degradación
-- por diseño de 20260919200000 — la RPC se recrea SIEMPRE en las dos variantes para que el
-- filtro exista en cualquier entorno).

DO $rpc$
DECLARE
  tiene_col BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'knowledge_chunks' AND column_name = 'embedding'
  ) INTO tiene_col;

  IF tiene_col THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
        p_query      TEXT,
        p_tenant     UUID,
        p_categories TEXT[] DEFAULT NULL,
        p_limit      INTEGER DEFAULT 5,
        p_embedding  VECTOR(1536) DEFAULT NULL,
        p_types      TEXT[] DEFAULT NULL
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
        WITH
        semantica AS (
          SELECT k.id,
                 ROW_NUMBER() OVER (ORDER BY k.embedding <=> p_embedding) AS rk
          FROM public.knowledge_chunks k
          WHERE k.is_active
            AND p_embedding IS NOT NULL
            AND k.embedding IS NOT NULL
            AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
            AND (p_categories IS NULL OR k.category = ANY (p_categories))
            AND (p_types IS NULL OR k.metadata->>'type' = ANY (p_types))
          ORDER BY k.embedding <=> p_embedding
          LIMIT 50
        ),
        lexica AS (
          SELECT k.id,
                 ROW_NUMBER() OVER (ORDER BY (
                   ts_rank(to_tsvector('spanish', coalesce(k.title,'') || ' ' || coalesce(k.content,'')),
                           websearch_to_tsquery('spanish', p_query)) * 2
                   + similarity(k.title, p_query)
                 ) DESC) AS rk
          FROM public.knowledge_chunks k
          WHERE k.is_active
            AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
            AND (p_categories IS NULL OR k.category = ANY (p_categories))
            AND (p_types IS NULL OR k.metadata->>'type' = ANY (p_types))
            AND (
              to_tsvector('spanish', coalesce(k.title,'') || ' ' || coalesce(k.content,''))
                @@ websearch_to_tsquery('spanish', p_query)
              OR similarity(k.title, p_query) > 0.3
            )
          ORDER BY (
            ts_rank(to_tsvector('spanish', coalesce(k.title,'') || ' ' || coalesce(k.content,'')),
                    websearch_to_tsquery('spanish', p_query)) * 2
            + similarity(k.title, p_query)
          ) DESC
          LIMIT 50
        ),
        fusion AS (
          SELECT id, (1.0 / (60 + rk)) AS rrf FROM lexica
          UNION ALL
          SELECT id, (1.0 / (60 + rk)) AS rrf FROM semantica
        )
        SELECT
          k.id, k.category, k.title, k.content, k.source, k.module, k.section, k.metadata,
          (SUM(f.rrf) / 2.0)::real AS similarity
        FROM fusion f
        JOIN public.knowledge_chunks k ON k.id = f.id
        WHERE (is_super_admin() OR is_admin_or_director())
        GROUP BY k.id
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
        p_limit      INTEGER DEFAULT 5,
        p_embedding  VECTOR(1536) DEFAULT NULL,
        p_types      TEXT[] DEFAULT NULL
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
          ts_rank(to_tsvector('spanish', coalesce(k.title,'') || ' ' || coalesce(k.content,'')),
                  websearch_to_tsquery('spanish', p_query))::real AS similarity
        FROM public.knowledge_chunks k
        WHERE k.is_active
          AND (is_super_admin() OR is_admin_or_director())
          AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
          AND (p_categories IS NULL OR k.category = ANY (p_categories))
          AND (p_types IS NULL OR k.metadata->>'type' = ANY (p_types))
          AND to_tsvector('spanish', coalesce(k.title,'') || ' ' || coalesce(k.content,''))
                @@ websearch_to_tsquery('spanish', p_query)
        ORDER BY similarity DESC
        LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
      $body$;
    $fn$;
  END IF;
END
$rpc$;

-- Envoltorio de compatibilidad: la firma anterior de 5 args sigue funcionando (delega en la de 6).
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  p_query      TEXT,
  p_tenant     UUID,
  p_categories TEXT[] DEFAULT NULL,
  p_limit      INTEGER DEFAULT 5,
  p_embedding  VECTOR(1536) DEFAULT NULL
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
AS $wrap$
  SELECT * FROM public.match_knowledge_chunks(p_query, p_tenant, p_categories, p_limit, p_embedding, NULL)
$wrap$;

-- Grants explícitos: la de 6 args es NUEVA y el envoltorio se recrea — sin esto quedan sin EXECUTE.
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER, VECTOR(1536), TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER, VECTOR(1536), TEXT[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER, VECTOR(1536)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER, VECTOR(1536)) TO authenticated, service_role;
