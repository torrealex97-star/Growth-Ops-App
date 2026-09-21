# Auditoría de clientes OAuth y URIs de rotación

> 21-sep-2026, aplicando las skills `oauth-implementation` + `integration-testing` (`.claude/skills/`).
> Regla clave (oauth-implementation): los redirect URIs se comparan como **cadena exacta** — nada de
> wildcards ni sufijos. Si algún día cambia el dominio de producción, hay que actualizar el URI en
> CADA proveedor ANTES del cambio DNS, o todas las conexiones mueren con `redirect_uri_mismatch` /
> callbacks firmados rechazados.

## Dominio de producción

- `https://app.scalixsystems.com` — Vercel, proyecto `growth-ops` (account `app-b1af`), dominio
  custom `scalixsystems.com` (registrar de terceros). Único dominio de producción.
- Dominio de Vercel sin alias (`growth-ops-weld.vercel.app` y deployment-urls) también responde —
  útil para pruebas, pero NINGÚN proveedor debe apuntar a un deployment URL efímero.

## 1. Google (cliente OAuth de YouTube — el único que existe)

| Dato                          | Valor                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente OAuth                 | `793841795630-h8p40rvkss05q1or8cp0iabi4tseni2k.apps.googleusercontent.com` (WDC, en `integration_settings.YOUTUBE_CLIENT_ID`)                |
| Redirect URIs registrados     | **Solo** `https://developers.google.com/oauthplayground` (verificado en vivo 21-sep: el callback de la app devuelve `redirect_uri_mismatch`) |
| Redirect que usa la app       | `https://developers.google.com/oauthplayground` (paso 1 del flujo de 2 pasos, PR #131)                                                       |
| Callback que recibe el código | La web del playground; el admin pega el código en Integraciones → YouTube → «Completar conexión»                                             |
| Scopes pedidos                | `youtube.upload` + `youtube.readonly` (mínimo necesario para subir Shorts; sin upload no se guarda)                                          |
| Refresco de token             | `lib/youtube/client.ts` autentica con el MISMO client y el refresh token cifrado en `integration_settings`                                   |

**Para rotar / migrar de dominio**: el redirect del playground NO depende del dominio — no hay que
tocar nada en Google salvo que se quiera eliminar el pegado manual. Para el callback automático,
registrar además `https://app.scalixsystems.com/api/oauth/google/callback` en Google Cloud Console
(APIs y servicios → Credenciales → el cliente OAuth → URIs de redirección autorizados) y desplegar
la rama ya preparada en `lib/google/oauth.ts` para callback propio (GA4/Gmail ya lo usan).

**Estado del cliente de GA4/Gmail (`GOOGLE_CLIENT_ID`)**: NO existe en la BD de WDC (verificado
21-sep). El flujo OAuth de GA4/Gmail (`lib/google/oauth.ts`, callback firmado en
`/api/oauth/google/callback`) no puede ejecutarse hasta que se guarden esas credenciales en
Integraciones → Google. Su redirect URI registrado (cuando exista el cliente) debe ser
exactamente `https://app.scalixsystems.com/api/oauth/google/callback`.

## 2. Supabase Auth (PKCE de email: invitaciones, recuperación)

| Dato                        | Valor                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Tipo                        | OAuth PKCE de Supabase (no es un cliente externo: la app ES el cliente)                                                                |
| Redirect URI que la app usa | `https://app.scalixsystems.com/api/{tenant}/evergreen/auth/callback` (5 llamadas: invite, recover, colaboradores, afiliados, registro) |
| Dónde se configura          | Supabase → Authentication → URL Configuration → **Redirect URLs** (permitir `https://app.scalixsystems.com/**`) y Site URL             |
| Riesgo de rotación          | Supabase valida la lista completa; un dominio nuevo hay que añadirlo ANTES del cambio DNS                                              |

## 3. Meta (Facebook/Meta Ads)

| Dato                                | Valor                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tipo de credencial                  | **System User token** pegado a mano (NO OAuth browser): no tiene redirect URI. La rotación es del token, no de URIs |
| Callbacks entrantes                 | Ninguno (solo polling de la Graph API)                                                                              |
| Si algún día se añade Login de Meta | Registrar `https://app.scalixsystems.com/api/oauth/meta/callback` (hoy no existe)                                   |

## 4. Webhooks entrantes (equivalentes operativos de un redirect: URLs que el proveedor llama)

| Proveedor | URL pública en producción                                                | Secreto de verificación                                        | Dónde rotarlo                                    |
| --------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------ |
| Apify     | `https://app.scalixsystems.com/api/webhooks/apify`                       | `x-apify-webhook-secret` (header, en los 2 webhooks de cuenta) | Apify → Settings → API & Integrations → Webhooks |
| Stripe    | `https://app.scalixsystems.com/api/{tenant}/evergreen/webhooks/stripe`   | firma del webhook (`STRIPE_WEBHOOK_SECRET`)                    | Stripe → Developers → Webhooks                   |
| Calendly  | `https://app.scalixsystems.com/api/{tenant}/evergreen/webhooks/calendly` | signing key (`CALENDLY_WEBHOOK_SECRET`)                        | Calendly → API & Webhooks                        |
| GHL       | `https://app.scalixsystems.com/api/{tenant}/evergreen/webhooks/ghl`      | secreto de la subcuenta (webhook-ghl)                          | GHL → Settings → Webhooks                        |

Estas URLs van **cifradas dentro de la config de cada subcuenta** (los catálogos muestran
`webhookPath` con `{tenant}`); al rotar dominio hay que re-crearlas en cada proveedor con el
dominio nuevo y actualizar `APIFY_WEBHOOK_SECRET`/claves donde proceda.

## 5. Calendly, Stripe, GHL, Fathom, Apify (APIs por token)

Ninguna usa OAuth browser: todas son **tokens/keys pegados en Integraciones** (verificado en el
catálogo `lib/integrations-catalog.ts`). No tienen redirect URIs que auditar; su superficie de
rotación son los tokens y los webhooks de la tabla de arriba.

## Checklist de rotación de dominio (por si algún día toca)

1. Añadir el dominio nuevo en Vercel (alias de producción) SIN quitar el viejo.
2. Google: añadir `https://{nuevo}/api/oauth/google/callback` al cliente OAuth.
3. Supabase: añadir `https://{nuevo}/**` a Redirect URLs; actualizar Site URL.
4. Re-crear los 4 webhooks con el dominio nuevo (Apify, Stripe, Calendly, GHL por subcuenta).
5. `NEXT_PUBLIC_SITE_URL` del env de Vercel → dominio nuevo + redeploy OBLIGATORIO.
6. Verificar con las sondas de Integraciones (todas en verde) ANTES de retirar el dominio viejo.
7. Solo entonces retirar el dominio viejo de Vercel y de cada proveedor.

## Cobertura de tests de integraciones (aplicando integration-testing)

| Área               | Tests existentes                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Webhooks entrantes | `webhooks-entrantes.test.mjs`, `webhook-ghl.test.mjs`, `stripe-webhook-route.test.mjs`, `webhook-secret-diagnostico.test.mjs` |
| Crons              | `cron-calendly-ghl.test.mjs`, `cron-stripe-payments.test.mjs`                                                                 |
| Google/YouTube     | `google-oauth.test.mjs` (state firmado, scopes, cifrado), `youtube-oauth.test.mjs` (exchange 2 pasos, extractor, cifrado)     |
| Apify              | `social-research.test.mjs` (guards de cuenta propia, webhook)                                                                 |
| Stripe             | `stripe-backfill-route.test.mjs`, `salud-pagos-stripe-sin-cobro.test.mjs`                                                     |
| Meta               | `tests/meta/` (fixtures y sincronización)                                                                                     |

Hueco conocido y asumido: las sondas contra APIs reales no se mockean en CI (se ejercitan en
producción con la sesión QA); el intercambio real de YouTube depende de Google y solo se prueba
con `invalid_grant` (código ficticio) para no quemar códigos reales.

### Verificación en vivo de la superficie (21-sep, producción)

| Endpoint                               | POST sin secreto | Esperado               | OK  |
| -------------------------------------- | ---------------- | ---------------------- | --- |
| `/api/webhooks/apify`                  | 401              | 401 fail-closed        | ✓   |
| `/api/{t}/evergreen/webhooks/stripe`   | 401              | 401 firma faltante     | ✓   |
| `/api/{t}/evergreen/webhooks/calendly` | 401              | 401 fail-closed (HMAC) | ✓   |
| `/api/{t}/evergreen/webhooks/ghl`      | 401              | 401 cabecera secreta   | ✓   |

### Hueco de cobertura detectado (pendiente para próxima pasada)

Las **acciones `test` de las sondas de Integraciones** (`action === 'test'` del route del panel:
meta, stripe, calendly, ghl, apify, youtube, ia…) no tienen ningún test: son el único trozo del
subsistema de integraciones sin red. Añadir tests de fuente como los de `youtube-oauth.test.mjs`
cuando toque tocar ese código.
