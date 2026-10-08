# Endurecimiento de seguridad

Auditoría de 2026-10-04 con la skill `security-audit` (Cloudflare) en modo guía, más las comprobaciones
propias del proyecto. Sin nombres de subcuentas ni credenciales (ver `docs/SECURITY_PRIVACY.md`).

## Hecho en código

| Hallazgo                                                                                                                            | Riesgo                                                                      | Arreglo                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/callback` redirigía a `${origin}${next}` con `next` de la URL                                                                 | Redirección abierta (`next=@sitio-malo.com`) tras un login válido: phishing | `lib/security/redirect.ts` (`rutaInternaSegura`): solo rutas internas                                                                                                                                                     |
| Sin cabeceras de seguridad (solo HSTS de la plataforma)                                                                             | Clickjacking, sniffing de tipos, fugas de `Referer`                         | `next.config.js`: `X-Content-Type-Options`, `Referrer-Policy`, HSTS con subdominios, `X-Frame-Options`/`frame-ancestors 'self'`, `Permissions-Policy`, `COOP`. `/embed` y `tracker.js` quedan fuera del bloqueo de marcos |
| `fetch(url)` del servidor con URLs guardadas (imágenes del chat de carruseles)                                                      | SSRF a red interna / metadatos                                              | `lib/security/safe-url.ts` (`esUrlPublicaSegura`) + `redirect: 'error'` + timeout                                                                                                                                         |
| Endpoints públicos sin límite: recuperación de contraseña, firma de contratos                                                       | Bombardeo de correos; prueba masiva de tokens                               | `lib/security/rate-limit.ts` (por IP y por email en recuperación). En memoria y por instancia: freno básico, no límite global                                                                                             |
| `guard_reservation_refund()` (trigger SECURITY DEFINER) ejecutable por `anon`/`authenticated`; dos funciones sin `search_path` fijo | Superficie innecesaria / suplantación por esquema                           | Migración `20261004200000_endurecimiento_funciones`                                                                                                                                                                       |

## Verificado y correcto (sin cambios)

- Webhook de Stripe: firma sobre el cuerpo crudo, secreto por subcuenta, rechazos registrados sin payload.
- Tokens de firma de contratos: 192 bits (`randomBytes(24)`), índice único.
- `match_knowledge_chunks`: con un usuario que no es miembro devuelve 0 filas aunque pase otra subcuenta o `NULL`.
- Actualizaciones por `id` con service role: validan antes la fila contra la subcuenta (`requireTargetInTenant`, selects con `tenant_id`).
- Ninguna variable secreta en código de cliente; solo `NEXT_PUBLIC_{SUPABASE_URL,SUPABASE_ANON_KEY,SITE_URL,SENTRY_DSN}`.
- `npm audit` de producción: 0 vulnerabilidades. Único archivo `.env` versionado: `.env.local.example`.
- RLS: aislamiento entre subcuentas y alcance por rol cerrados en las migraciones F01/F35.

## Pendiente: acciones fuera del repositorio (requieren tu cuenta)

1. **Cloudflare delante de la app.** El DNS ya está en Cloudflare, pero `app` apunta a Vercel sin proxy
   (nube gris): no pasa por el WAF. Opciones: (a) activar el proxy (nube naranja) con SSL/TLS en
   _Full (strict)_; ojo, Vercel desaconseja proxificar y puede alterar IPs/cachés, así que probar primero
   en un subdominio de pruebas; (b) dejar DNS only y usar el firewall de Vercel (Settings → Firewall).
   Con proxy: reglas de _rate limiting_ sobre `/api/*/evergreen/auth/recover`, `/api/public-contracts/*`,
   `/api/vsl/*`, `/api/track/*` y `/*/login`; _Bot Fight Mode_; managed rules del WAF; Turnstile en login y
   recuperación.
2. **Supabase → Authentication → Passwords:** activar _Leaked password protection_ (aviso del linter).
3. **Supabase Auth:** limitar intentos de login/OTP en _Rate Limits_ y revisar la lista de _Redirect URLs_
   (solo los dominios propios).
4. **CSP de scripts — observación implementada:** `Content-Security-Policy-Report-Only` informa a
   `/api/security/csp-report` sin bloquear Meta, Stripe, vídeo ni fuentes. El receptor limita
   tamaño/frecuencia y conserva solo directiva y origen (sin path, query, fragmento ni muestra de
   script). Antes de convertirla en bloqueante, observar producción y declarar los orígenes reales;
   `unsafe-inline` permanece temporalmente para evitar ruido masivo de hidratación hasta diseñar
   nonces/hashes.
5. **Extensiones en `public`** (`vector`, `pg_trgm`): aviso de bajo riesgo; moverlas a `extensions` exige
   recrear dependencias, hacerlo en una ventana con prueba.
6. Rotar cualquier secreto que haya pasado por chats o capturas, y mantener `gitleaks` activo en CI.

## SQL de funciones: aplicado (2026-10-05)

Aplicado desde el editor SQL de Supabase (el clasificador de permisos de Claude Code bloqueó `apply_migration`
para este cambio). Archivo: `supabase/migrations/20261005134300_endurecimiento_funciones.sql` (idempotente; no
figura en `schema_migrations`). Verificado en producción: `guard_reservation_refund` ya no es ejecutable por
`anon` ni `authenticated` y conserva sus 4 triggers activos; las dos funciones de canal tienen
`search_path=public, pg_temp`; el linter ya no avisa de ellas.
