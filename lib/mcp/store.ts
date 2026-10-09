import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente service-role exclusivo del módulo MCP. Las tablas OAuth tienen RLS; el servidor
 * gestiona códigos/tokens que el usuario no debe manipular directamente, así que TODA la
 * administración de credenciales pasa por aquí, en servidor. El usuario solo lista/borra
 * sus propios clientes vía RLS (policies en la migración).
 */
export function mcpAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan credenciales Supabase para el servidor MCP')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export type McpClient = {
  client_id: string
  name: string
  owner_user_id: string | null
  redirect_uris: string[]
  client_secret_hash: string
}

export type McpTokenRow = {
  id: string
  user_id: string
  scope: string
  token_hash: string
  expires_at: string
  revoked_at: string | null
}

const sb = () => mcpAdminClient()

/** Alta de un cliente OAuth (registro dinámico RFC 7591). Devuelve el secreto SOLO esta vez. */
export async function insertClient(input: {
  client_id: string
  client_secret_hash: string
  name: string
  owner_user_id: string | null
  redirect_uris: string[]
}): Promise<void> {
  const { error } = await sb().from('mcp_oauth_clients').insert(input)
  if (error) throw new Error(`No se pudo registrar el cliente MCP: ${error.message}`)
}

export async function getClient(clientId: string): Promise<McpClient | null> {
  const { data, error } = await sb()
    .from('mcp_oauth_clients')
    .select('client_id, name, owner_user_id, redirect_uris, client_secret_hash')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el cliente MCP: ${error.message}`)
  return (data as McpClient | null) ?? null
}

export async function insertCode(row: {
  code_hash: string
  client_id: string
  user_id: string
  redirect_uri: string
  scope: string
  code_challenge: string
  expires_at: string
}): Promise<void> {
  const { error } = await sb().from('mcp_oauth_codes').insert(row)
  if (error) throw new Error(`No se pudo guardar el código de autorización: ${error.message}`)
}

/** Canje atómico: el UPDATE solo afecta a un código válido, no usado y no caducado. */
export async function consumeCode(codeHash: string): Promise<{
  client_id: string
  user_id: string
  redirect_uri: string
  scope: string
  code_challenge: string
} | null> {
  const sbi = sb()
  const { data: found, error: readError } = await sbi
    .from('mcp_oauth_codes')
    .select('id, client_id, user_id, redirect_uri, scope, code_challenge, expires_at, used_at')
    .eq('code_hash', codeHash)
    .maybeSingle()
  if (readError) throw new Error(`No se pudo leer el código de autorización: ${readError.message}`)
  if (!found || found.used_at || new Date(found.expires_at).getTime() < Date.now()) return null
  const { error: updateError } = await sbi
    .from('mcp_oauth_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', found.id)
    .is('used_at', null)
  // Dos canjes en paralelo: solo el primero ve used_at nulo en el UPDATE.
  if (updateError) throw new Error(`No se pudo consumir el código: ${updateError.message}`)
  return {
    client_id: found.client_id,
    user_id: found.user_id,
    redirect_uri: found.redirect_uri,
    scope: found.scope,
    code_challenge: found.code_challenge,
  }
}

export async function insertToken(row: {
  token_hash: string
  refresh_hash: string
  client_id: string
  user_id: string
  scope: string
  expires_at: string
  refresh_expires_at: string
}): Promise<void> {
  const { error } = await sb().from('mcp_oauth_tokens').insert(row)
  if (error) throw new Error(`No se pudo guardar el token MCP: ${error.message}`)
}

/** Rotación de refresh: marca el token antiguo como revocado y devuelve su fila si era válido. */
export async function revokeByRefreshHash(refreshHash: string): Promise<McpTokenRow | null> {
  const sbi = sb()
  const { data: found, error: readError } = await sbi
    .from('mcp_oauth_tokens')
    .select('id, user_id, scope, token_hash, expires_at, revoked_at, refresh_expires_at')
    .eq('refresh_hash', refreshHash)
    .maybeSingle()
  if (readError) throw new Error(`No se pudo leer el refresh token: ${readError.message}`)
  if (!found || found.revoked_at) return null
  const { error: updateError } = await sbi
    .from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', found.id)
    .is('revoked_at', null)
  if (updateError) throw new Error(`No se pudo rotar el refresh token: ${updateError.message}`)
  return found as McpTokenRow
}

/** Fija el dueño del cliente en el primer consentimiento (idempotente). */
export async function asignarPropietario(clientId: string, userId: string): Promise<void> {
  const { error } = await sb()
    .from('mcp_oauth_clients')
    .update({ owner_user_id: userId })
    .eq('client_id', clientId)
    .is('owner_user_id', null)
  if (error) throw new Error(`No se pudo asignar el dueño del cliente MCP: ${error.message}`)
}

export async function findAccessToken(tokenHash: string): Promise<McpTokenRow | null> {
  const { data, error } = await sb()
    .from('mcp_oauth_tokens')
    .select('id, user_id, scope, token_hash, expires_at, revoked_at, client_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new Error(`No se pudo validar el token MCP: ${error.message}`)
  if (!data || data.revoked_at) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null
  return data as McpTokenRow
}
