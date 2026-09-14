-- Fase CONTRACT: aplicar solo después de verificar que producción usa
-- attribution_funnel_for_tenant. La función se conserva sin acceso de API para facilitar rollback.
REVOKE ALL ON FUNCTION public.attribution_funnel() FROM PUBLIC, anon, authenticated;
