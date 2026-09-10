-- ============================================================
-- MIGRACIÓN v6 — Tareas (prioridad), Productos (duración), Comisiones por tramos
-- Idempotente.
-- ============================================================

-- Tareas: prioridad/urgencia (para el kanban)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'media'; -- baja/media/alta/urgente

-- Productos: duración del programa (meses) → control de renovación de alumnos
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS duration_months INT;

-- Comisiones por tramos de cash collected + por rep concreto + caducidad
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id); -- rep concreto (null = aplica a todos los de ese tipo)
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS min_cash NUMERIC(12,2) NOT NULL DEFAULT 0;   -- tramo: cash collected acumulado desde
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS max_cash NUMERIC(12,2);                       -- hasta (null = sin límite superior)
ALTER TABLE public.commission_rules ADD COLUMN IF NOT EXISTS label TEXT;                                   -- nombre del tramo (opcional)

-- ============================================================
-- FIN v6
-- ============================================================
