-- ============================================================================
-- QUIÉN COMISIONA — flag por persona (2026-09-23).
--
-- REQUISITO: "Debemos poder marcar o desmarcar quien comisiona o no y cuanto."
-- Caso real: Claudia es SOCIA — cierra ventas como closer pero no cobra
-- comisión de closer (su beneficio va por la sociedad, no por el ledger).
-- Hasta ahora el motor generaba su comisión por el mero hecho de estar
-- asignada como closer/setter/afiliada en la venta.
--
-- DISEÑO: un boolean en users (pays_commissions, default TRUE — nadie cambia de
-- comportamiento por la migración). El motor de comisiones y la proyección de
-- comisiones futuras lo consultan y NO generan filas para los exentos. Como
-- TODO el reporting (dashboard, P&L, comisiones, proyección) lee del ledger
-- `commissions`, con no generar filas la persona desaparece de TODAS las
-- métricas a la vez — sin tocar ninguna pantalla.
--
-- El "cuánto" ya existe y no se duplica: commission_rules con user_id (regla
-- por persona, con vigencia y tramos) fija el % de quien comisiona; el flag
-- solo decide SI comisiona.
--
-- ADITIVA: sin datos históricos que reescribir, sin tocar RLS (la columna
-- hereda la política de la tabla), reversible (DROP COLUMN).
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pays_commissions BOOLEAN NOT NULL DEFAULT true;

-- No nullable sin default explícito: toda fila existente nace comisionando
-- (default true), así que el CHECK es solo defensa frente a estados imposibles.
ALTER TABLE public.users
  ADD CONSTRAINT users_pays_commissions_not_null CHECK (pays_commissions IS NOT NULL);

COMMENT ON COLUMN public.users.pays_commissions IS
  'FALSE = exento de comisiones (p.ej. socio): el motor no genera ni proyecta comisiones para esta persona en ningún rol (setter/closer/afiliado/colaborador). TRUE = comportamiento estándar.';
