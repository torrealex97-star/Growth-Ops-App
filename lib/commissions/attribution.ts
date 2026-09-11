import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveUserIdByTrackingCode, normalizeTrackingCode as norm } from '@/lib/tracking'

export type AttributionPatch = {
  setter_id?: string
  affiliate_id?: string
  affiliate_commission_percent?: number | null
}

type SaleForAttribution = {
  id: string
  contact_id?: string | null
  setter_id: string | null
  affiliate_id: string | null
  affiliate_commission_percent: number | null
  appointment_id?: string | null
}

// Dada una venta a la que le falta setter y/o afiliado, deduce el usuario a partir de la
// atribución (UTM) del contacto y actualiza la venta. La regla de negocio es la misma que usa el
// sistema de enlaces (ver sección Enlaces / webhooks):
//   - utm_term    → users.tracking_code   (setter / cold caller)
//   - utm_content → users.affiliate_code  (afiliado)
// Solo rellena lo que esté vacío: NUNCA pisa una asignación manual ni un rep ya puesto por el
// webhook. Devuelve el parche aplicado (objeto vacío si no encontró a nadie).
export async function resolveSaleAttribution(sb: SupabaseClient, sale: SaleForAttribution): Promise<AttributionPatch> {
  const needSetter = !sale.setter_id
  const needAffiliate = !sale.affiliate_id
  if (!needSetter && !needAffiliate) return {}

  const patch: AttributionPatch = {}

  // 1) Si la venta viene de una agenda, respeta el setter que ya asignó Calendly/GHL (por utm/email).
  if (needSetter && sale.appointment_id) {
    const { data: appt } = await sb.from('appointments').select('setter_id').eq('id', sale.appointment_id).maybeSingle()
    if (appt?.setter_id) patch.setter_id = appt.setter_id
  }

  // 2) UTM del contacto (atribución primaria; si no, la más reciente). Coalesce first → plano → last.
  let term = ''
  let content = ''
  if (sale.contact_id && ((needSetter && !patch.setter_id) || needAffiliate)) {
    const { data: attr } = await sb
      .from('contact_attributions')
      .select(
        'utm_term, first_utm_term, last_utm_term, utm_content, first_utm_content, last_utm_content, is_primary, last_touch_at'
      )
      .eq('contact_id', sale.contact_id)
      .order('is_primary', { ascending: false })
      .order('last_touch_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (attr) {
      const a = attr as Record<string, string | null>
      term = norm(a.first_utm_term || a.utm_term || a.last_utm_term)
      content = norm(a.first_utm_content || a.utm_content || a.last_utm_content)
    }
  }

  // 3) Setter / cold caller por utm_term → tracking_code (punto único de resolución)
  if (needSetter && !patch.setter_id && term) {
    const setterId = await resolveUserIdByTrackingCode(sb, term)
    if (setterId) patch.setter_id = setterId
  }

  // 4) Afiliado por utm_content → affiliate_code (con su % por defecto si la venta no lo trae)
  if (needAffiliate && content) {
    const { data: affs } = await sb
      .from('users')
      .select('id, affiliate_code, default_affiliate_commission_percent')
      .not('affiliate_code', 'is', null)
    const match = (affs ?? []).find((u) => norm(u.affiliate_code as string) === content)
    if (match) {
      patch.affiliate_id = match.id as string
      if (sale.affiliate_commission_percent == null) {
        patch.affiliate_commission_percent = (match.default_affiliate_commission_percent as number | null) ?? null
      }
    }
  }

  if (Object.keys(patch).length) {
    await sb.from('sales').update(patch).eq('id', sale.id)
  }
  return patch
}
