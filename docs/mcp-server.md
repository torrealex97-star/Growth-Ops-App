# Servidor MCP propio de la app

Servidor MCP (Model Context Protocol) integrado en la propia aplicación Next.js para conectar
**ChatGPT** y **Claude** a los datos de la app. El modelo responde cualquier pregunta sobre los
datos con SQL de **solo lectura**, bajo el **mismo aislamiento por subcuenta (RLS)** que tu sesión
web. No existe ninguna vía de escritura.

## Arquitectura

| Pieza | Ruta / fichero | Función |
|---|---|---|
| Endpoint MCP | `app/api/mcp/route.ts` | JSON-RPC 2.0 por HTTP (`initialize`, `tools/list`, `tools/call`, `ping`) |
| OAuth 2.1 | `app/api/mcp/oauth/*` + `lib/mcp/oauth.ts` | authorization_code + PKCE S256, refresh rotativo, registro dinámico |
| Discovery | `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server` | RFC 9728 / RFC 8414 |
| Ejecutor SQL | `lib/mcp/sql-executor.ts` | read-only, RLS, timeout 8 s, máx. 500 filas |
| Store OAuth | `lib/mcp/store.ts` | clientes, códigos y tokens en Supabase (hashes SHA-256, nunca claro) |
| Migración | `supabase/migrations/20261009160000_mcp_server_oauth_and_reader.sql` | rol `mcp_reader` + tablas `mcp_oauth_*` |

## Conexión desde ChatGPT (connector / deep research)

1. Configuración → Connectors → Create → **MCP Server**.
2. URL: `https://app.scalixsystems.com/api/mcp`
3. Autenticación: **OAuth** — ChatGPT descubre el servidor vía `/.well-known`, registra un cliente
   en `/api/mcp/oauth/register` y abre `/api/mcp/oauth/authorize`.
4. Inicia sesión en la app si no lo estás y pulsa **Autorizar** en la pantalla de consentimiento.

## Conexión desde Claude (Custom Connector)

1. Claude → Settings → Connectors → **Add custom connector**.
2. URL: `https://app.scalixsystems.com/api/mcp`
3. Autenticación OAuth — mismo flujo que ChatGPT.

## Qué ve el modelo

Tres herramientas, todas de lectura:

- `list_tenants` — subcuentas visibles para el usuario que autorizó.
- `query_db` — SQL libre `SELECT`/`WITH` (una sentencia, máx. 20.000 caracteres, 500 filas, 8 s).
- `describe_table` — columnas de una tabla para saber qué consultar.

El aislamiento es el mismo del resto de la app: el access token lleva el `sub` real del usuario;
el ejecutor lo inyecta en `request.jwt.claims` y las policies RLS (`auth_tenant_ids`,
`is_super_admin`) filtran cada fila. Un usuario que solo pertenece a la subcuenta A no puede leer
ni una fila de la B, aunque el prompt lo pida.

## Seguridad por capas

1. **Rol `mcp_reader`** (Postgres, `NOLOGIN`): solo `GRANT SELECT` sobre tablas de negocio
   explícitas. Sin acceso a las tablas OAuth ni a las funciones de auth.
2. **Transacción `READ ONLY`**: cualquier escritura (incluso vía CTE o función) revienta.
3. **PKCE S256 obligatorio** y códigos de un solo uso de 60 s (canje atómico por `used_at`).
4. **Tokens cortos**: access 15 min (JWT HS256, revocable por `jti` en BD), refresh 30 días con
   **rotación**: reutilizar un refresh revoca la sesión.
5. **Consentimiento con sesión**: la aprobación exige sesión Supabase y fija `owner_user_id`;
   un cliente registrado dinámicamente no lee nada hasta que el usuario lo aprueba.
6. **Hashes**: códigos, tokens y client secrets se guardan solo como SHA-256.
7. **Sin reflexión de errores SQL** con datos: el mensaje de Postgres se trunca a 500 caracteres.

## Variables de entorno

| Variable | Dónde | Descripción |
|---|---|---|
| `MCP_JWT_SECRET` | Vercel + local | Secreto HS256, **≥32 caracteres**. Sin él, el servidor responde 503 (fail-closed). |
| `POSTGRES_URL` | ya existente | Conexión del ejecutor (rol de la conexión: `postgres`; la elevación la limita `mcp_reader` vía `SET ROLE`) |

> **Nota sobre el rol de conexión:** el ejecutor usa `SET LOCAL ROLE mcp_reader` dentro de la
> transacción para que los privileges SELECT sean los del rol lector y no los del propietario.

## Revoke

Los tokens de 15 min mueren solos; el refresh a los 30 días. Para revocar YA, borra el cliente o
sus filas de `mcp_oauth_tokens` (el usuario dueño puede hacerlo por RLS con su sesión).
