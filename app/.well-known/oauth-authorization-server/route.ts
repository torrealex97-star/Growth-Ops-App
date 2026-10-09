import { NextResponse } from 'next/server'

/**
 * OAuth Authorization Server Metadata (RFC 8414) para el servidor MCP.
 * Solo el flujo authorization_code + PKCE S256 (OAuth 2.1).
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['read'],
  })
}
