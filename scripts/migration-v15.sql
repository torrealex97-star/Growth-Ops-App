-- Migration v15 — Pagos: autofinanciado con entrada + cuotas, y reserva → completar pago en la MISMA venta
-- (para portar a [tenant])

-- Entrada (down payment) pagada al momento en un plan autofinanciado
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Fecha de la primera cuota del resto (cuando empieza el calendario de cuotas)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS installments_start_date DATE;

-- Nº de cuotas en las que se divide el resto (override del plan si es un trato especial)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS installments_count INT;

-- Cuándo se completó el pago de una reserva (NULL = reserva abierta pendiente de completar)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS reservation_completed_at TIMESTAMPTZ;

-- Método de pago elegido (registro explícito, p.ej. "transferencia", "autofinanciado", "stripe")
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method TEXT;
