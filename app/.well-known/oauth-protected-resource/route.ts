import { NextResponse } from 'next/server'

/**
 * OAuth 2.1 Protected Resource Metadata (RFC 9728). Los clientes MCP (Claude, ChatGPT) lo
 * leen para descubrir el authorization server de este recurso.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['read'],
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/api/mcp`,
  })
}
