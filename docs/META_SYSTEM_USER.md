# Meta: token de System User y mapa de permisos

Última revisión: 4-oct-2026. Código de referencia: `lib/meta/permisos.ts` (inventario, comprobado por
`tests/meta-permisos.test.mjs`), `lib/meta/token.ts` (inspección del token), `lib/meta/salud.ts` y
`lib/instagram/salud.ts` (comprobaciones).

## 1. Por qué un token de System User

Un token del Explorador de la API Graph (o de un inicio de sesión) es **de usuario y de corta duración**:
muere en horas y, aunque se convierta en «larga duración», caduca a los ~60 días y **se invalida si esa
persona cambia la contraseña o cierra sesión**. Eso es exactamente lo que pasó: el 28-sep (Instagram) y el
30-sep (Meta) las sincronizaciones empezaron a fallar con el código 190 («la sesión ha sido invalidada»),
y el gasto de octubre dejó de entrar sin que ninguna pantalla lo avisara.

Un **token de System User** pertenece a un usuario de sistema del Business Manager, no a una persona:
no caduca (`expires_at: 0`) y no depende de ninguna contraseña.

## 2. Cómo generarlo (pasos exactos)

1. `business.facebook.com` › **Configuración del negocio** › **Usuarios** › **Usuarios del sistema** › **Añadir**.
   Rol **Administrador**.
2. **Asignar activos** al usuario del sistema, con control total o el mínimo que necesites:
   - la **cuenta publicitaria** (gasto y campañas),
   - la **Página de Facebook** vinculada,
   - la **cuenta de Instagram** profesional.
3. **Generar token** › elige la app **Growth Ops** › caducidad **«Nunca»** › marca los permisos (§3).
4. Copia el token **una sola vez** (Meta no lo vuelve a mostrar).

## 3. Dónde se guarda y cómo se valida

- **Dónde:** _Configuración › Integraciones › Meta Ads › Access Token_. Se guarda **cifrado por subcuenta**
  (`integration_settings`, clave `META_ACCESS_TOKEN`). La variable de entorno `META_ACCESS_TOKEN` solo es un
  respaldo para subcuentas sin token propio. Instagram usa `INSTAGRAM_ACCESS_TOKEN` si existe y, si no, el
  mismo de Meta.
- **Cómo se valida:** «Probar» (y los crons de Meta e Instagram, que ahora guardan el resultado **cada vez
  que corren**) hace una llamada mínima a la cuenta **y** le pregunta a Meta por el token (`/debug_token`):
  - token que **no caduca** → «Token que no caduca (System User)»;
  - token de usuario → **«Aviso: es un token de usuario y caduca en N h. Genera uno de System User…»**
    (sigue en verde, pero avisa **antes** de que muera);
  - token inválido → «Meta dice que el token ya no es válido (motivo)»;
  - falta un permiso obligatorio → nombra el permiso y dónde marcarlo.
    Si Meta no puede inspeccionar el token, **el veredicto no empeora**: solo no se añade la información.

## 4. Variables y campos a configurar

| Campo (Integraciones)     | Variable de entorno (respaldo) | Obligatorio                            | Para qué                                                                                                                                       |
| ------------------------- | ------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Access Token              | `META_ACCESS_TOKEN`            | **Sí**                                 | Token del System User.                                                                                                                         |
| Cuenta(s) publicitaria(s) | `META_AD_ACCOUNT_ID`           | **Sí** (o `META_AD_ACCOUNTS_ALL`)      | Regla D10: sin selección explícita no se sincroniza «todas».                                                                                   |
| App Secret                | `META_APP_SECRET`              | Solo si la app exige `appsecret_proof` | Firma las llamadas. Debe ser el de **la misma app** que generó el token.                                                                       |
| ID de la app de Meta      | `META_APP_ID`                  | Opcional (nuevo)                       | Con él y el App Secret se inspecciona el token con el token de aplicación (vale para cualquier tipo).                                          |
| Versión de la API         | `META_API_VERSION`             | No                                     | Vacío = la que mantiene la app (`v25.0`). Poner `v26.0` solo para probarla. Todas las anteriores a v24.0 están deprecadas desde junio de 2026. |
| Instagram User ID         | `IG_USER_ID`                   | **Sí** para Instagram                  | Cuenta de IG a sincronizar.                                                                                                                    |

Secretos de despliegue ya existentes, sin cambios: `CRON_SECRET` (los workflows de GitHub lo usan para
llamar a los crons) y `CONFIG_ENC_KEY` (cifrado de las credenciales por subcuenta).

## 5. Inventario: los 14 permisos del token

**En uso (7)** — todos de **lectura**:

| Permiso                     | Qué hace hoy la app                                                                |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `ads_read`                  | Gasto, campañas, anuncios y resultados (`/{act}/insights`, `/campaigns`, `/ads`).  |
| `pages_show_list`           | `/me/accounts`: de la Página a la cuenta de Instagram vinculada.                   |
| `pages_read_engagement`     | Token de cada Página y sus reels de Facebook.                                      |
| `instagram_basic`           | Perfil y publicaciones (`/{ig}`, `/{ig}/media`).                                   |
| `instagram_manage_insights` | Alcance, interacciones y audiencia (`/{ig}/insights`, `/{media}/insights`).        |
| `pages_messaging`           | **Lectura** de conversaciones de la Página (contadores).                           |
| `instagram_manage_messages` | **Lectura** de DMs de Instagram con su transcripción, para el análisis de setting. |

**Implícito (1):** `public_profile` (`/me`).

**Concedidos sin ninguna llamada (6)**, y por qué no los he activado sin más:

| Permiso                       | Lo que habilitaría                                                                                        | Por qué no está                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `instagram_manage_comments`   | Leer el **contenido** de los comentarios y moderarlos. Hoy solo se guarda el _número_ (`comments_count`). | La lectura es segura y está planificada (§6); responder/ocultar actúa en público. |
| `instagram_manage_engagement` | Responder comentarios, menciones.                                                                         | Escritura pública.                                                                |
| `instagram_content_publish`   | Publicar fotos, vídeos, reels y carruseles.                                                               | Escritura pública sobre la marca del cliente.                                     |
| `ads_management`              | Crear, editar y pausar campañas.                                                                          | Toca la inversión publicitaria del cliente.                                       |
| `business_management`         | Listar Business Managers y sus cuentas.                                                                   | Hoy `/me/adaccounts` basta si el token ya ve las cuentas.                         |
| `pages_manage_metadata`       | Suscribir la Página a webhooks (mensajes y comentarios en tiempo real).                                   | Sin webhooks, todo se consulta por cron; no llega en tiempo real.                 |

## 6. Plan por permiso (qué se haría, y con qué condición)

| Permiso                                               | Endpoint                                              | Cuándo se puede hacer ya     | Condición                                                            |
| ----------------------------------------------------- | ----------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `instagram_manage_comments` (lectura)                 | `GET /{media}/comments`                               | Ya                           | Tabla propia + sincronización acotada a las publicaciones recientes. |
| `business_management`                                 | `GET /me/businesses`, `/{business}/owned_ad_accounts` | Ya                           | Solo descubrimiento de cuentas para «Buscar cuentas».                |
| `instagram_content_publish` (límite)                  | `GET /{ig}/content_publishing_limit`                  | Ya                           | Solo lectura del cupo.                                               |
| `pages_manage_metadata`                               | `POST /{page}/subscribed_apps`                        | Con decisión                 | Hace falta un endpoint público firmado de webhook de Meta.           |
| `instagram_manage_engagement` (escritura)             | `POST /{comment}/replies`, `?hide=true`               | **Con decisión de producto** | Quién puede, con qué aprobación, registro de auditoría.              |
| `instagram_content_publish` (escritura)               | `POST /{ig}/media`, `POST /{ig}/media_publish`        | **Con decisión de producto** | Aprobación explícita por publicación + auditoría.                    |
| `instagram_manage_messages`/`pages_messaging` (envío) | `POST /{page}/messages`                               | **Con decisión de producto** | Hoy se responde desde GHL; ventana de 24 h de Meta.                  |
| `ads_management`                                      | `POST /{act}/campaigns`                               | **Con decisión de producto** | Aprobación y límites de gasto.                                       |

**Aviso de Meta:** usar estos permisos sobre cuentas que **no son de los administradores de la app**
requiere _Acceso Avanzado_ (revisión de la app). Para cuentas propias en modo desarrollo funcionan sin ella.

## 7. Lo que NO hay que tocar

- **`vercel.json`:** `cron/meta`, `cron/meta-daily` y `cron/instagram` **no** deben añadirse. Ya los programan
  GitHub Actions (`cron-meta.yml` 03:00 UTC, `cron-meta-daily.yml` 03:30, `cron-instagram.yml` 02:30) y
  duplicarlos los ejecutaría dos veces. `cron/meta-ads` (02:00) sí está en Vercel. Hay un test que lo fija.
