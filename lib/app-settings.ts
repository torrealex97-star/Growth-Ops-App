import { createClient } from '@supabase/supabase-js'
import { DEFAULT_BUSINESS_CONTEXT } from '@/lib/ctas'

// Lectura server-side de app_settings (kv). Usa service-role (salta RLS).
function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function readKey(key: string): Promise<string> {
  const { data } = await svc().from('app_settings').select('value').eq('key', key).maybeSingle()
  const v = (data?.value as { prompt?: string } | null)?.prompt
  return typeof v === 'string' ? v : ''
}

// Prompt de estilo general para la generación de guiones (propios y de competencia).
export async function readStylePrompt(): Promise<string> {
  return readKey('ig_style_prompt')
}

// Contexto de negocio (modelo + avatares + funnel). Si está vacío, el por defecto.
export async function readBusinessContext(): Promise<string> {
  const v = await readKey('ig_business_context')
  return v.trim() || DEFAULT_BUSINESS_CONTEXT
}
