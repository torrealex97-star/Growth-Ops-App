-- F-1: match_knowledge_chunks comprobaba el rol del llamante (is_super_admin / is_admin_or_director,
-- global) pero no su pertenencia al tenant de cada chunk. Un admin o director de un tenant podía pedir
-- p_tenant de otro, o NULL, y leer su conocimiento privado. El gate pasa a exigir pertenencia al tenant
-- del chunk, salvo super_admin. CREATE OR REPLACE conserva los grants (anon ya revocado).

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(p_query text, p_tenant uuid, p_categories text[] DEFAULT NULL::text[], p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, category text, title text, content text, source text, module integer, section text, metadata jsonb, similarity real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        SELECT
          k.id, k.category, k.title, k.content, k.source, k.module, k.section, k.metadata,
          -- Relevancia: rank FTS español (2x, domina) + parecido trigram del título (1x). La suma
          -- ponderada cubre coincidencias que solo fallan por flexión y hace estable el orden.
          (ts_rank(to_tsvector('spanish', coalesce(k.title, '') || ' ' || coalesce(k.content, '')),
                   websearch_to_tsquery('spanish', p_query)) * 2
           + similarity(k.title, p_query))::real AS similarity
        FROM public.knowledge_chunks k
        WHERE k.is_active
          -- Gate en el PROPIO cuerpo de la RPC (defensa en profundidad): rol admin/director Y pertenencia
          -- al tenant del chunk. super_admin (plataforma) ve todos. is_* y auth_tenant_ids leen auth.uid().
          AND (is_super_admin() OR (is_admin_or_director() AND k.tenant_id IN (SELECT public.auth_tenant_ids())))
          AND (p_tenant IS NULL OR k.tenant_id = p_tenant)
          AND (p_categories IS NULL OR k.category = ANY (p_categories))
          AND (
            to_tsvector('spanish', coalesce(k.title, '') || ' ' || coalesce(k.content, ''))
              @@ websearch_to_tsquery('spanish', p_query)
            OR similarity(k.title, p_query) > 0.3
          )
        ORDER BY similarity DESC
        LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
      $function$;

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(p_query text, p_tenant uuid, p_categories text[] DEFAULT NULL::text[], p_limit integer DEFAULT 5, p_embedding vector DEFAULT NULL::vector)
 RETURNS TABLE(id uuid, category text, title text, content text, source text, module integer, section text, metadata jsonb, similarity real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        -- Gate: rol admin/director Y pertenencia al tenant del chunk; super_admin ve todos.
        WHERE (is_super_admin() OR (is_admin_or_director() AND k.tenant_id IN (SELECT public.auth_tenant_ids())))
        GROUP BY k.id
        ORDER BY similarity DESC
        LIMIT greatest(1, least(coalesce(p_limit, 5), 20));
      $function$;
