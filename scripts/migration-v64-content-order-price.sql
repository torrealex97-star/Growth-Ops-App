-- Sugerencia de equipo (content/reels): reordenar manualmente la lista y añadir precio por pieza
-- con suma mensual, para llevar el pago a editores por pieza editada.
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS price NUMERIC(10,2);

-- Rellena sort_order inicial según el orden actual (más antiguo = 1) para que el modo "Manual"
-- arranque igual que "Añadido: antiguo primero" en vez de en blanco.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM public.content_items
  WHERE sort_order IS NULL
)
UPDATE public.content_items c
SET sort_order = ranked.rn
FROM ranked
WHERE c.id = ranked.id;
