-- Facturas subidas con IA: identidad del emisor y trazabilidad del pago.
-- La extracción es una sugerencia; needs_review sigue siendo el estado de revisión humana.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS invoice_due_date DATE;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS counterparty_tax_id TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS counterparty_address TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS counterparty_bank_account TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS counterparty_bank_name TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS paid_at DATE;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS paid_from_account TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS payment_reference TEXT;

COMMENT ON COLUMN public.expenses.counterparty_bank_account IS 'Cuenta bancaria del emisor detectada en la factura; requiere revisión humana antes de usarla para un pago.';
COMMENT ON COLUMN public.expenses.paid_from_account IS 'Cuenta propia desde la que se realizó el pago, introducida o confirmada por el usuario.';
COMMENT ON COLUMN public.expenses.ai_extracted IS 'Instantánea de datos extraídos por IA, incluidos campos no confirmados; no es prueba de pago.';

CREATE INDEX IF NOT EXISTS expenses_counterparty_tax_idx ON public.expenses(tenant_id, counterparty_tax_id) WHERE counterparty_tax_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_counterparty_bank_idx ON public.expenses(tenant_id, counterparty_bank_account) WHERE counterparty_bank_account IS NOT NULL;
