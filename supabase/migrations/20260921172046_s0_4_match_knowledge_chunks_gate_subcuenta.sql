-- S0.4 · P0 — REGRESIÓN DE F-1: la versión de 6 argumentos de match_knowledge_chunks volvió a la
-- puerta vieja.
--
-- F-1 (20260920074321) corrigió que la RPC comprobara el ROL del llamante (admin/director, global)
-- pero no su PERTENENCIA al tenant del chunk: un admin de un cliente podía pasar p_tenant de otro, o
-- NULL, y leer su conocimiento privado. Horas después, 20260920120000 (filtro p_types) creó la firma de
-- 6 argumentos copiando el cuerpo ANTERIOR al arreglo, y la de 5 pasó a delegar en ella: el arreglo de
-- F-1 quedó vivo solo en la de 4 argumentos, que ya nadie usa.
--
-- Además, al ser una función NUEVA nació con EXECUTE para `anon`: el `REVOKE ... FROM PUBLIC` de esa
-- migración no lo quita, porque en Supabase anon recibe un grant explícito por los default privileges.
-- La puerta del cuerpo seguía devolviendo 0 filas a anon, pero una RPC SECURITY DEFINER expuesta a
-- anon es exactamente lo que el advisor 0028 marca y lo que F-1 había cerrado.
--
-- Qué cambia: SOLO la condición de la puerta (idéntica a la de F-1) y los grants. Mismo cuerpo, misma
-- firma, mismas dos variantes (con y sin columna embedding). El envoltorio de 5 argumentos delega en
-- esta, así que queda corregido sin tocarlo.
--
-- tests/rag-gate-subcuenta.test.mjs impide que otra migración vuelva a definir la función sin la
-- comprobación de pertenencia.

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
        WHERE (is_super_admin() OR (is_admin_or_director() AND k.tenant_id IN (SELECT public.auth_tenant_ids())))
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
          AND (is_super_admin() OR (is_admin_or_director() AND k.tenant_id IN (SELECT public.auth_tenant_ids())))
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


-- anon no llama a esta RPC por ninguna vía legítima: el RAG corre con sesión o con service_role.
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER, VECTOR(1536), TEXT[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER, VECTOR(1536)) FROM anon;
REVOKE EXECUTE ON FUNCTION public.match_knowledge_chunks(TEXT, UUID, TEXT[], INTEGER) FROM anon;
