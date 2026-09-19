-- Pipeline de embeddings para knowledge_chunks — búsqueda SEMÁNTICA + léxica.
--
-- La columna `embedding vector(1536)` ya existe (20260919200000). Este paso activa su uso:
--   1. Índice HNSW (ANN, distancia coseno) — para <100k filas también valdría exacto, pero HNSW
--      es el estándar de Supabase y no penaliza a este tamaño.
--   2. match_knowledge_chunks pasa a HÍBRIDA: rama semántica (cosine) y rama léxica (FTS español
--      + trigram de título) se fusionan con Reciprocal Rank Fusion (RRF, k=60 — constante
--      estándar del paper de Cormack et al.): score = Σ 1/(60 + rank_i). RRF sobre posiciones
--      (no sobre scores crudos) evita el problema de mezclar escalas incomparables
--      (1-cosine ∈ [0,1] vs ts_rank sin techo).
--   3. Degradación automática: si la columna embedding NO existe (pgvector ausente), la RPC
--      vuelve a ser la léxica pura de 20260919200000 — nada rompe.
--
-- Quién escribe los embeddings: scripts/ingestar-knowledge.mjs y runtime (lib/ai/knowledge.ts
-- embedQuery) vía la API de embeddings (OpenAI text-embedding-3-small, nativo 1536 dims),
-- con clave OPENAI_API_KEY (Vercel / integration_settings). Sin clave: sistema 100% léxico
-- como hasta hoy (degradación por diseño, nunca error).
--
-- Nota de licitud RRF en SQL: windowed ROW_NUMBER sin ORDER BY global es no determinista entre
-- workers, pero aquí cada ranking interno lleva su ORDER BY propio y los LIMIT acotan filas:
-- el resultado es estable salvo empates de score exactos (inofensivo para retrieval).

DO $$
DECLARE
  tiene_vector BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') INTO tiene_vector;

  IF tiene_vector THEN
    -- Índice ANN. Guardado: si la tabla se creó sin columna (rama sin pgvector de la migración
    -- anterior pero extensión instalada después), la columna puede no existir.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'knowledge_chunks' AND column_name = 'embedding'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_kc_embedding_hnsw
        ON public.knowledge_chunks USING hnsw (embedding vector_cosine_ops)';
    END IF;
  END IF;
END
$$;

-- RPC híbrida. Tres cuerpos posibles, MISMA FIRMA (los callers nunca cambian):
--   A) columna embedding + pg_trgm   → semántica + FTS + trigram (completa)
--   B) columna embedding, sin trgm   → semántica + FTS
--   C) sin columna embedding         → léxica pura (idéntica a 20260919200000)
DO $rpc$
DECLARE
  tiene_vector BOOLEAN;
  tiene_col BOOLEAN;
  tiene_trgm BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') INTO tiene_vector;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'knowledge_chunks' AND column_name = 'embedding'
  ) INTO tiene_col;
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') INTO tiene_trgm;

  IF tiene_vector AND tiene_col AND tiene_trgm THEN
    EXECUTE $fn$
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
      AS $body$
        WITH
        semantica AS (
          -- Rank semántico: cosine distance (pgvector) cuando hay embedding de consulta.
          -- El filtro de fila por embedding NOT NULL es CRÍTICO: sin él, filas aún sin vector
          -- (ingesta parcial) entran con distancia NULL y ensucian el ranking de la fusión.
          SELECT k.id,
                 ROW_NUMBER() OVER (ORDER BY k.embedding <=> p_embedding) AS rk
          FROM public.knowledge_chunks k
          WHERE k.is_active
            AND p_embedding IS NOT NULL
            AND k.embedding IS NOT NULL
            AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
            AND (p_categories IS NULL OR k.category = ANY (p_categories))
          ORDER BY k.embedding <=> p_embedding
          LIMIT 50
        ),
        lexica AS (
          -- Rank léxico: FTS español (dominante para términos exactos) + trigram de título.
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
          -- RRF: suma de recíprocos de posición. k=60 (Cormack et al. 2009).
          SELECT id, (1.0 / (60 + rk)) AS rrf FROM lexica
          UNION ALL
          SELECT id, (1.0 / (60 + rk)) AS rrf FROM semantica
        )
        SELECT
          k.id, k.category, k.title, k.content, k.source, k.module, k.section, k.metadata,
          -- similarity expone el RRF normalizado a [0,1] (2 máx. teórico con ambas listas):
          -- señal de "cuántas vías respaldan este chunk", no distancia bruta.
          (SUM(f.rrf) / 2.0)::real AS similarity
        FROM fusion f
        JOIN public.knowledge_chunks k ON k.id = f.id
        WHERE (is_super_admin() OR is_admin_or_director())  -- gate de rol (defensa en profundidad)
        GROUP BY k.id
        ORDER BY similarity DESC
        LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
      $body$;
    $fn$;

  ELSIF tiene_vector AND tiene_col AND NOT tiene_trgm THEN
    EXECUTE $fn$
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
      AS $body$
        WITH
        semantica AS (
          SELECT k.id, ROW_NUMBER() OVER (ORDER BY k.embedding <=> p_embedding) AS rk
          FROM public.knowledge_chunks k
          WHERE k.is_active AND p_embedding IS NOT NULL AND k.embedding IS NOT NULL
            AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
            AND (p_categories IS NULL OR k.category = ANY (p_categories))
          ORDER BY k.embedding <=> p_embedding
          LIMIT 50
        ),
        lexica AS (
          SELECT k.id, ROW_NUMBER() OVER (ORDER BY ts_rank(
                     to_tsvector('spanish', coalesce(k.title,'') || ' ' || coalesce(k.content,'')),
                     websearch_to_tsquery('spanish', p_query)) DESC) AS rk
          FROM public.knowledge_chunks k
          WHERE k.is_active
            AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
            AND (p_categories IS NULL OR k.category = ANY (p_categories))
            AND to_tsvector('spanish', coalesce(k.title,'') || ' ' || coalesce(k.content,''))
                  @@ websearch_to_tsquery('spanish', p_query)
          LIMIT 50
        ),
        fusion AS (
          SELECT id, (1.0 / (60 + rk)) AS rrf FROM lexica
          UNION ALL
          SELECT id, (1.0 / (60 + rk)) AS rrf FROM semantica
        )
        SELECT k.id, k.category, k.title, k.content, k.source, k.module, k.section, k.metadata,
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
    -- Sin pgvector/columna: léxica pura — misma firma nueva (p_embedding ignorado) para que
    -- los callers no tengan que saber en qué rama están.
    EXECUTE $fn$
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
          AND to_tsvector('spanish', coalesce(k.title,'') || ' ' || coalesce(k.content,''))
                @@ websearch_to_tsquery('spanish', p_query)
        ORDER BY similarity DESC
        LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
      $body$;
    $fn$;
  END IF;
END
$rpc$;

-- La firma cambió (nuevo parámetro con DEFAULT): re-aplicar grants explícitos.
REVOKE ALL ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER, VECTOR(1536)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER, VECTOR(1536)) TO authenticated, service_role;
