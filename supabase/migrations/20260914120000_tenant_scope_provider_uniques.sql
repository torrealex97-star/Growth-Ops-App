-- ─────────────────────────────────────────────────────────────────────────────
-- DOS AGUJEROS DE INTEGRIDAD, MISMA RAÍZ: claves únicas pensadas para un solo inquilino.
--
-- ── A) OBJETOS DE PROVEEDOR CON UNIQUE GLOBAL ────────────────────────────────
-- `campaigns (provider, external_id)`, `campaign_ads.external_id`, `ig_media.external_id`,
-- `fb_media.external_id`, `ig_comments.external_id`, `ig_competitor_media.external_id` y
-- `youtube_uploads.ig_media_external_id` eran únicos ENTRE TODAS LAS SUBCUENTAS.
--
-- 20260911160000 los dejó así a propósito, razonando que "el id es globalmente único en el origen,
-- así que dos tenants no pueden producir la misma clave en la práctica". Ese razonamiento falla en
-- el caso más normal de esta plataforma: **la misma cuenta publicitaria (o la misma cuenta de
-- Instagram) conectada en DOS subcuentas**. El mismo negocio con dos subcuentas comparte token, y
-- `resolveMetaConfigs` sincroniza TODAS las cuentas que ve ese token. Entonces:
--
--   · `campaigns`: la segunda subcuenta NO PUEDE insertar la campaña (choca con la fila de la
--     primera). Su tabla `campaigns` se queda vacía y, como `campaign_daily` y `campaign_ads` se
--     enlazan por el mapa de campañas, esa subcuenta se queda sin NADA de Meta. Es una causa raíz
--     concreta del "esta subcuenta no trae datos".
--   · `campaign_ads` / `ig_media` / `fb_media`: la sync hace UPSERT por esa clave, así que la
--     segunda subcuenta no falla: **se lleva la fila**, reescribiendo su `tenant_id`. Los anuncios
--     y publicaciones van saltando de subcuenta según quién sincronizó último. Corrupción de datos
--     y mezcla entre inquilinos con aspecto de funcionar.
--
-- No hay nada que deduplicar: precisamente porque el unique era global, dos filas con la misma
-- clave en subcuentas distintas NO pueden existir hoy. Se sustituye la clave, no se toca una fila.
--
-- ── B) `collections` SIN UNIQUE PARA LA REFERENCIA DE PAGO ───────────────────
-- 20260911200000 cerró el doble-cobro de CUOTAS (unique parcial sobre expected_installment_id),
-- pero los cobros que vienen de un pago externo (el importador de Stripe: Integraciones › Stripe ›
-- "Registrar N ventas") llevan `expected_installment_id = NULL` y su identidad está en
-- `payment_reference`. Ahí no había ninguna garantía: la deduplicación vivía solo en memoria
-- (`knownReferences`, cargado al empezar la petición). Dos peticiones casi simultáneas —doble clic
-- en el botón, un reintento del navegador— pasan las dos la comprobación y crean **dos ventas y
-- dos cobros para el mismo pago de Stripe: el mismo dinero contado dos veces**. Y luego la
-- conciliación los ve "cuadrados", así que nadie se enteraría.
--
-- Aquí SÍ puede haber duplicados históricos, y son dinero: no se borra nada automáticamente. Si
-- existen, la migración FALLA con la lista para revisarla a mano. Es lo único honesto.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A) Claves de proveedor, ahora por subcuenta ──────────────────────────────

-- campaigns: (provider, external_id) → (tenant_id, provider, external_id).
-- No parcial, para que ON CONFLICT pueda usarlo sin repetir predicado. Los NULL (campañas
-- manuales) siguen sin colisionar entre sí.
DROP INDEX IF EXISTS public.campaigns_provider_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_tenant_provider_external_idx
  ON public.campaigns (tenant_id, provider, external_id);

-- campaign_ads: la UNIQUE de columna (campaign_ads_external_id_key) → (tenant_id, external_id).
ALTER TABLE public.campaign_ads DROP CONSTRAINT IF EXISTS campaign_ads_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ads_tenant_external_idx
  ON public.campaign_ads (tenant_id, external_id);

-- ig_media: la referencia de youtube_uploads apunta a esta clave, así que primero se suelta la FK,
-- se cambia la clave, y se rehace la FK como compuesta (tenant_id, external_id) — que es además lo
-- correcto: un reel subido a YouTube pertenece a la subcuenta de su publicación.
ALTER TABLE public.youtube_uploads DROP CONSTRAINT IF EXISTS youtube_uploads_ig_media_external_id_fkey;
ALTER TABLE public.youtube_uploads DROP CONSTRAINT IF EXISTS youtube_uploads_ig_media_external_id_key;
DROP INDEX IF EXISTS public.ig_media_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ig_media_tenant_external_idx
  ON public.ig_media (tenant_id, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS youtube_uploads_tenant_media_idx
  ON public.youtube_uploads (tenant_id, ig_media_external_id);
-- NOT VALID a propósito: protege todo lo nuevo sin arriesgar que la migración falle por una fila
-- histórica que apunte a la publicación de OTRA subcuenta — que es justamente lo que este cambio
-- impide a partir de ahora. Validar es un paso aparte, después de revisar esas filas.
-- (se suelta antes de crearla para que la migración se pueda reaplicar: ADD CONSTRAINT no admite
-- IF NOT EXISTS)
ALTER TABLE public.youtube_uploads DROP CONSTRAINT IF EXISTS youtube_uploads_tenant_media_fkey;
ALTER TABLE public.youtube_uploads
  ADD CONSTRAINT youtube_uploads_tenant_media_fkey
  FOREIGN KEY (tenant_id, ig_media_external_id)
  REFERENCES public.ig_media (tenant_id, external_id) ON DELETE CASCADE NOT VALID;

-- fb_media / ig_comments / ig_competitor_media: mismo cambio, sin dependencias.
DROP INDEX IF EXISTS public.fb_media_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS fb_media_tenant_external_idx
  ON public.fb_media (tenant_id, external_id);

DROP INDEX IF EXISTS public.ig_comments_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ig_comments_tenant_external_idx
  ON public.ig_comments (tenant_id, external_id);

DROP INDEX IF EXISTS public.ig_competitor_media_external_idx;
CREATE UNIQUE INDEX IF NOT EXISTS ig_competitor_media_tenant_external_idx
  ON public.ig_competitor_media (tenant_id, external_id);

-- ── B) Un pago externo = un cobro ────────────────────────────────────────────
DO $$
DECLARE
  duplicados TEXT;
BEGIN
  SELECT string_agg(format('%s (%s cobros)', payment_reference, n), ', ')
    INTO duplicados
    FROM (
      SELECT payment_reference, count(*) AS n
        FROM public.collections
       WHERE payment_reference IS NOT NULL AND status <> 'reversed'
       GROUP BY tenant_id, payment_reference
      HAVING count(*) > 1
    ) d;

  IF duplicados IS NOT NULL THEN
    RAISE EXCEPTION
      'Hay referencias de pago con más de un cobro activo: %. Es dinero contado dos veces: revísalas a mano (deja uno y marca el otro como reversed) y vuelve a aplicar esta migración.',
      duplicados;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS collections_tenant_payment_reference_key
  ON public.collections (tenant_id, payment_reference)
  WHERE payment_reference IS NOT NULL AND status <> 'reversed';
