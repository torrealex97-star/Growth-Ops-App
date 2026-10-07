import type { Sale } from '@/lib/types/database'

type UpdateResult = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string }

const normalizeMember = (value: unknown) => (value === 'none' || value === '' || value === undefined ? null : value)

/** Construye el parche parcial de una venta sin perder la atribución al editar solo su porcentaje. */
export function buildSaleUpdatePayload(
  body: Record<string, unknown>,
  previous: Pick<Sale, 'affiliate_id'>,
  userId: string
): UpdateResult {
  const payload: Record<string, unknown> = { updated_by: userId }
  if ('setter_id' in body) payload.setter_id = normalizeMember(body.setter_id)
  if ('closer_id' in body) payload.closer_id = normalizeMember(body.closer_id)
  if ('affiliate_id' in body) payload.affiliate_id = normalizeMember(body.affiliate_id)

  if ('affiliate_commission_percent' in body) {
    const affiliateId = 'affiliate_id' in body ? payload.affiliate_id : previous.affiliate_id
    const rawPercent = body.affiliate_commission_percent
    if (affiliateId && rawPercent !== '' && rawPercent != null) {
      const percent = Number(rawPercent)
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return { ok: false, error: 'affiliate_commission_percent debe estar entre 0 y 100' }
      }
      payload.affiliate_commission_percent = percent
    } else {
      payload.affiliate_commission_percent = null
    }
  }

  return { ok: true, payload }
}
