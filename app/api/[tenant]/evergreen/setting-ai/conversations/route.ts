import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { ensureConfig } from '@/lib/config'
import {
  getInstagramConfig,
  resolveIgUserId,
  resolveFbPageId,
  getPageAccessToken,
  fetchIgConversationsWithMessages,
} from '@/lib/instagram/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Lista conversaciones (DMs) con su transcripción, para la pestaña "Conversaciones" de
// Setting AI. Instagram trae datos reales (mismo cliente que usa el sync orgánico);
// Facebook y TikTok todavía no tienen integración de mensajería, así que devuelven
// configured:false para que el front pinte un placeholder "próximamente".
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const platform = req.nextUrl.searchParams.get('platform') || 'instagram'
  if (platform !== 'instagram') {
    return NextResponse.json({ configured: false, platform, conversations: [] })
  }

  await ensureConfig(t.tenantId)
  const cfg = getInstagramConfig()
  if (!cfg) return NextResponse.json({ configured: false, platform, conversations: [] })

  try {
    const { id: igUserId } = await resolveIgUserId(cfg)
    const pageId = await resolveFbPageId(cfg, igUserId)
    if (!pageId) return NextResponse.json({ configured: false, platform, conversations: [] })
    const pat = await getPageAccessToken(cfg, pageId)
    if (!pat) return NextResponse.json({ configured: false, platform, conversations: [] })
    const conversations = await fetchIgConversationsWithMessages(cfg, pageId, pat, igUserId, 20)
    return NextResponse.json({ configured: true, platform, conversations })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
