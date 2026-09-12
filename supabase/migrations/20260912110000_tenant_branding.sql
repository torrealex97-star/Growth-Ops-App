-- Fase 10: branding por tenant (nombre de marca + acento de color mostrados en el shell),
-- guardado en `tenants.settings` (jsonb, ya existía y estaba sin usar — no se añade columna).
-- `tenants.name` ("Evergreen (plantilla)", "Women Digital Closer") es una etiqueta administrativa
-- interna, nunca fue el nombre de marca visible en el sidebar/login (ese era literalmente
-- hardcodeado como "Scalix Systems" en 9 archivos, igual para las dos subcuentas). `accent` es un
-- discriminador cerrado ('brand' | 'pink') que selecciona qué rampa de color CSS-variable-backed
-- usa el shell (ver app/globals.css) — no un hex libre, para no tener que reescribir las cientos
-- de clases `bg-brand-*`/`text-brand-*` ya usadas en toda la app.
UPDATE public.tenants
SET settings = settings || '{"branding": {"name": "Scalix Systems", "accent": "brand"}}'::jsonb
WHERE slug = 'evergreen';

UPDATE public.tenants
SET settings = settings || '{"branding": {"name": "WDC", "accent": "pink"}}'::jsonb
WHERE slug = 'women-digital-closer';
