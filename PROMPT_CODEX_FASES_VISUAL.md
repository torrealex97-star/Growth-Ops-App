# Prompt para Codex: todo lo que esta auditoría (Claude, sin navegador) no pudo hacer

Rol: Claude hizo de estratega durante el ciclo de auditoría S1
(`docs/S1-MVP-READINESS-2026-10-01.md`) — auditó código, cerró 1 vulnerabilidad de seguridad, 1
bug de datos, y verificó 9 fases completas por código. Lo que queda es, casi todo, trabajo que
necesita navegador con sesión real y medición en runtime — exactamente lo que Codex tiene y esa
sesión de Claude no tenía. Este documento es la lista completa y concreta de qué falta, por qué
falta, y qué hacer con cada pieza. No dupliques el análisis que ya existe en los documentos
citados — este prompt asume que ya los leíste.

**Documento hermano:** `PROMPT_CODEX_SKELETON_EMPTYSTATE.md` cubre una pieza concreta de la Fase
10 (adopción de `Skeleton`/`EmptyState`) con su propio plan detallado — hazla primero o en
paralelo, es independiente de esto.

## 0. Acceso al tenant de prueba en local

Claude ya dejó el tenant QA (`qa-e2e`) aprovisionado y con login funcionando (vía el MCP de
Supabase, con acceso real al proyecto). **Las credenciales no van en este documento** — el
usuario te las pasa directamente en el chat/terminal al arrancar esta tarea (email + contraseña
de un usuario sintético con rol `admin`, solo en el tenant `qa-e2e`, sin ningún privilegio de
super-admin — ya verificado). Pasos:

1. **`.env.local`** — necesitas la URL del proyecto y la clave `anon`/publishable (son las claves
   PÚBLICAS del proyecto — las mismas que ya viajan en el bundle del navegador de la app
   desplegada). Pídeselas al usuario si no las tienes ya, o tráelas tú con
   `vercel env pull .env.local` si tienes el proyecto vinculado.
2. **Levanta la app:** `npm run dev`
3. **Entra** en `http://localhost:3000/qa-e2e/login` (o el puerto que uses) con el email y
   contraseña que te pasó el usuario. El tenant tiene rol `admin`, un producto con plan de
   reserva (300) y pago completo (3000), y dos contactos de prueba.
4. **Si necesitas RESETEAR el tenant** (volver a un estado limpio, o ejecutar
   `scripts/e2e/setup-tenant.mjs` directamente) necesitas `SUPABASE_SERVICE_ROLE_KEY` — esa es la
   llave maestra de TODO el proyecto (incluye tenants reales con datos reales), no solo de
   `qa-e2e`, así que no se escribe en ningún documento. Sácala tú con:
   ```bash
   vercel login && vercel link && vercel env pull .env.local
   ```
   y pídele al usuario confirmación antes de ejecutar nada que escriba fuera del tenant `qa-e2e`.
5. **Para el journey de colaborador** (Fase 13, punto 5): el fixture ya tiene un perfil de
   colaborador, pero su usuario (`colaborador@qa-e2e.test`) se generó con una contraseña aleatoria
   porque ese rol normalmente firma por token, no hace login. Si necesitas probar el login de un
   colaborador de verdad, crea un segundo usuario con rol `collaborator` desde la pantalla de
   usuarios de la app (ya logueado como admin) — más simple que tocar contraseñas a mano.

Solo pregúntale al usuario si quieres probar contra el preview de Vercel o producción en vez de
local, o si algún journey de la Fase 13 requiere escribir datos fuera del tenant `qa-e2e` (p. ej.
un pago real con Stripe) — eso sí necesita su confirmación explícita antes de ejecutarse.

---

## Fase 10 (resto) — UX/UI: lo que falta más allá de Skeleton/EmptyState

Ya cerrado por código (no repetir): consolidación de `Skeleton`/`EmptyState` (ver el otro prompt).

Lo que SÍ necesita navegador, pantalla por pantalla (usa el inventario de 93 rutas:
`find "app/[tenant]" -name "page.tsx"` para la lista completa; prioriza las que aparecen en los
journeys críticos de la Fase 13 primero):

1. **Jerarquía visual por pantalla.** Para cada pantalla, en 10 segundos de mirarla debe
   responderse: ¿dónde estoy? ¿qué periodo veo? ¿qué contexto (tenant/rol/filtro)? ¿qué pasó? ¿qué
   necesita atención? ¿qué puedo hacer? Si una pantalla no responde alguna, anótala con el nombre
   exacto de la ruta y cuál falta.
2. **Dashboard como Command Center real.** El Dashboard principal (`app/[tenant]/dashboard/page.tsx`
   y lo que renderiza) debe mostrar de un vistazo Adquisición/Funnel/Setting/Ventas/Cash/Entrega/
   Salud de datos + "qué necesita atención" — no un montón desordenado de tarjetas. Evalúa si el
   orden y agrupación actual ya logra esto o no.
3. **Sin plantilla de SaaS genérica.** Busca específicamente: gradientes sin motivo funcional,
   tarjetas-dentro-de-tarjetas, más de ~5-6 colores con significado real en una misma vista,
   decoración que no comunica nada. Si el design system (`components/ui/*`) ya define los tokens
   correctos y una pantalla concreta los ignora (colores hardcodeados, sombras/bordes inconsistentes
   con el resto), es un hallazgo real — cita el fichero y la línea.
4. **Reutilización del design system.** Antes de reportar "esta pantalla necesita un componente X",
   comprueba si `components/ui/` ya tiene ese primitivo (Buttons, Inputs, Selects, DateRange, Cards,
   Tables, Tabs, Badges, Drawers, Modals, Charts) y la pantalla construyó el suyo a mano. Mismo
   patrón que el hallazgo de Skeleton/EmptyState — búscalo con grep de imports vs. grep de patrones
   repetidos, no asumas.
5. **Responsive real** en desktop/tablet/mobile (usa las devtools del navegador para emular
   viewports, o redimensiona de verdad), con foco especial en: Dashboard, el panel de alertas del
   Header (hoy no hay Action Center unificado — ver Fase 9, no se construye aquí, solo se evalúa
   si el panel actual se rompe en mobile), CRM (`crm/agendas`, `crm/contactos`), el calendario de
   agendas, Ventas, Finanzas, el reproductor VSL, y cualquier tabla ancha (Comisiones, Cobros).

**Reporta:** lista de hallazgos con ruta exacta + captura o descripción de qué se ve mal + qué
arreglarías. No arregles nada todavía sin confirmarlo si implica tocar más de 1-2 ficheros por
hallazgo — primero junta la lista completa, luego decide con el usuario qué se corrige en esta
pasada vs. qué se documenta para después (mismo criterio que usó Claude: corregir lo existente,
no rediseñar).

## Fase 11 — Accesibilidad real (Claude lo intentó por grep, sin resultado fiable)

Claude no pudo hacer esto fiablemente por código (JSX multilínea, una regex no reconstruye el
árbol real). Con navegador real:

1. **axe-core** (o la extensión de accesibilidad de las DevTools del navegador que uses) contra
   cada pantalla de los journeys críticos de la Fase 13 como mínimo, idealmente contra las 93.
2. **Teclado:** navega cada pantalla crítica solo con Tab/Shift+Tab/Enter/Espacio/Escape. ¿Se
   puede operar todo? ¿El foco es visible siempre? ¿Un modal/drawer atrapa el foco dentro y lo
   devuelve al cerrar?
3. **Contraste:** cualquier texto sobre fondo de color (badges de estado, alertas) — revisa que
   cumpla AA al menos.
4. **Etiquetas:** cualquier botón solo-icono sin `aria-label`/`title` visible al lector de
   pantalla — esto es exactamente lo que Claude no pudo confirmar por código; con el navegador y
   el árbol de accesibilidad real de las DevTools, sí se puede.
5. **Movimiento:** confirma que `prefers-reduced-motion` se respeta (el repo ya tiene una regla
   global en `app/globals.css` según el código de `AppLoading.tsx` — verifica que de verdad aplica
   en el navegador con la preferencia activada, no asumas que el comentario del código es cierto).

**Reporta:** hallazgos con ruta + elemento exacto + qué falla + fix propuesto. Los triviales
(falta un `aria-label` en un botón concreto) puedes arreglarlos directamente; los estructurales
(un modal que no atrapa el foco, un flujo entero sin poder completarse por teclado) se documentan
para decidir con el usuario antes de tocar el componente compartido que probablemente usan varias
pantallas.

## Fase 12 (resto) — Performance real: lo que Sentry no cubre

Claude ya cerró con datos reales de Sentry (ver `docs/S1-MVP-READINESS-2026-10-01.md` §6.8):
LCP p75 1.97s (Bueno), INP p75 72ms (Bueno) — 30 días, proyecto `javascript-nextjs` en la org
`scalix-52` de Sentry. CLS tenía 48 muestras pero el agregado no se pudo extraer por la MCP — si
tienes acceso a Sentry, confírmalo abriendo el dashboard directamente y añade el número que falta
al mismo §6.8 (no lo inventes si no puedes confirmarlo).

Lo que SÍ necesita navegador/DevTools:

1. **Bundle real servido.** Pestaña Network, carga en frío de Dashboard/CRM/Finanzas — tamaño total
   transferido, qué chunk de JS es más pesado. Compara contra lo que `next build` reporta
   localmente (`npm run build` ya genera el análisis de tamaño por ruta) para ver si el servidor
   real coincide.
2. **Llamadas duplicadas.** Abre cada pantalla de los journeys críticos y mira la pestaña Network:
   ¿la misma URL se pide 2+ veces al cargar? ¿Hay una cascada de peticiones secuenciales que
   podrían ir en paralelo? (Nota: Claude ya revisó por código que 3 rutas de API concretas no
   tienen N+1 de base de datos — esto es sobre el navegador pidiendo de más, no sobre el servidor.)
3. **Gráficos lentos.** Las pantallas con Recharts (Finanzas, Dashboard, Marketing) — ¿el
   renderizado/interacción (hover, zoom, cambio de filtro) se siente lento con datos reales de
   producción? Usa el Performance tab de las DevTools si hace falta perfilar de verdad.
4. **Cambio de tenant.** Si el usuario tiene acceso a más de un tenant, mide cuánto tarda cambiar
   de uno a otro — el histórico de este repo (`PROJECT_CONTEXT.md`) menciona que esto ya fue un
   problema resuelto antes; confirma que sigue resuelto.

**Reporta:** números concretos (KB, ms, número de peticiones), no impresiones. Si algo es lento,
seguí el árbol de diagnóstico habitual: primero confirma el síntoma con datos, luego mira causa
(bundle grande / cascada de red / cálculo pesado en cliente), antes de proponer un fix.

## Fase 13 — Smoke test de los journeys críticos (ninguno se ejecutó esta sesión)

Ejecuta cada uno de punta a punta con datos reales (o de un tenant de prueba), mirando SIEMPRE la
consola del navegador mientras lo haces:

1. `LOGIN → TENANT → DASHBOARD`
2. `META → LEAD → CRM → BOOKING → SHOW → SALE → PAYMENT`
3. `VSL → VIEW → CONTACT → BOOKING → SALE`
4. `CONTACT → OPPORTUNITY → APPOINTMENT → SALE → CASH`
5. `COLLABORATOR → LOGIN → OWN DATA → COMMISSION` (usa una cuenta con rol `collaborator` — Claude
   ya confirmó por código y tests que el aislamiento de datos funciona; esto es la confirmación
   visual de que la UI respeta lo mismo, no una repetición de esa auditoría)
6. `EMAIL → TEMPLATE → SEND → HISTORY`
7. `STRIPE → PAYMENT → FINANCE`

Durante cada uno, en la consola del navegador busca: errores de JS, warnings de hidratación
(React), respuestas 404/401/403/500 en Network, peticiones duplicadas, assets que no cargan
(imágenes/fuentes rotas). Cualquier cosa que aparezca y no debería: anótala con el journey exacto
en el que salió y el paso concreto.

**Para cada journey, reporta: PASS / FAIL con evidencia** (captura de consola, captura de pantalla
del error, o descripción exacta de qué se esperaba vs. qué pasó). Un journey no se marca PASS por
"se veía bien" — se marca PASS porque se completó de principio a fin sin errores en consola/network
y el dato final (la venta, el cobro, el email) quedó donde debía quedar.

## Fase 14 — Regresión final (después de aplicar cualquier fix de las fases 10-13)

1. `npm run quality` completo en verde (mismo baseline que ya está documentado: 1202/1205 tests,
   los 3 fallos son de red al sandbox y no cambian).
2. Vuelve a correr los 7 journeys de la Fase 13 — un fix en una pantalla no debe romper otra.
3. Repite la verificación visual de responsive (Fase 10 punto 5) sobre cualquier pantalla que se
   haya tocado.
4. Actualiza el veredicto final de `docs/S1-MVP-READINESS-2026-10-01.md` (§6 / §6.0.1): con todo
   esto cerrado, decide si sigue siendo MVP READY WITH BLOCKERS (los bloqueadores de Alex del §8 no
   cambian con este trabajo) o si cambia a MVP READY.

---

## Cómo reportar al terminar

Sigue el mismo patrón que ya estableció esta auditoría — no crear documentos nuevos para esto:

- Añade los resultados de cada fase a su sección correspondiente en
  `docs/S1-MVP-READINESS-2026-10-01.md` (§6.8 ya tiene el hueco para Fases 10-12; añade §6.9 para
  Fase 13 y §6.10 para Fase 14 si no existen ya cuando llegues a esto).
- Actualiza `PENDIENTES.md` con cualquier ítem nuevo que necesite acción del usuario (formato
  "ACCIÓN REQUERIDA" con número concreto, nunca vago).
- Respeta `docs/SECURITY_PRIVACY.md`: si alguno de los journeys usa datos reales de un tenant de
  producción, no pongas nombres de personas, slugs de tenant, IDs de pago ni ningún dato de negocio
  real en los documentos commiteados — descríbelo en términos genéricos y comunica el detalle
  identificable aparte, directamente al usuario.
