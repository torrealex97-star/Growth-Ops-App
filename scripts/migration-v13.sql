-- v13 — Reservas: enlazar la venta completada con su reserva de origen
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS converted_from_reservation_id UUID REFERENCES public.sales(id);
