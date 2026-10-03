# Relevo activo

## Auditoría de dashboards: estado reconciliado y lo que queda — 3-oct (Claude Code)

Origen: Alex pidió continuar la auditoría de Codex (brief de 58 puntos). En vez de repetirla, se
contrastaron los 25 hallazgos F01–F25 con el código actual de `main`: la tabla vive en
[`DASHBOARD_AUDIT.md`](../DASHBOARD_AUDIT.md) › «Estado de los hallazgos a 3-oct». **Límite:** es
verificación contra código y PRs, no re-medición de producción (sin credenciales de BD en esa sesión).

**Fusionado desde el 25-sep (mío):** #218 (acota por subcuenta, CTR, conteo de la IA), #219 (F02),
#220 (F24/F25/F17), #221 (F03), #222 (claves de lectura vs webhook en Salud de datos), #223 (% de
asistencia sobre lo resuelto), #316 (pestañas huérfanas y textos).

**Sigue abierto, por orden de prioridad:**

1. **F01 (P0) — RLS de colaborador.** Ninguna migración desde el 25-sep (#304 cierra otro agujero).
   Necesita migración + dry-run `BEGIN…ROLLBACK` + **confirmación de Alex antes de aplicar**.
2. **F19 restante (P0)** — CRM, alumnos, contenido, selectores y vistas guardadas sin `tenant_id`.
3. **F13 (P1)** — cerrado en Finanzas (resumen, P&L, cohortes, proyección y socios; este último en #318). Sin revisar loaders de otras áreas.
4. **F04 (P1)** — moneda en el cash canónico; **requiere decidir el proveedor de FX** (MONEY D2).
5. **F08 (P1)** — `evaluarDefinicion` sin consumidores: el diagnóstico sale antes de los gates.
6. F07, F05, F10 parciales; F14, F16, F18, F21, F22, F23 abiertos (ver tabla).

**USER_ACTION de Alex:** F11 (mapeo de setters y asistencias provisionales), F12 (fecha inicial
esperada por fuente) y F33 — comprobar en Integraciones que Meta tiene **cuenta publicitaria
elegida**: tras D10 sin selección no se sincroniza, y sin gasto no hay CAC ni ROAS reales.

**BUSINESS_DECISION:** F04 (FX) y F32 (la tabla de atribución mezcla leads históricos con ventas del
periodo).

**Concurrencia:** el tablero estaba vacío al empezar; la reclamación de Codex sobre estos documentos
era del 28-sep y sin commits posteriores. No se tocó código de otros carriles.

**Nota de entorno:** el script `npm test` usa `--experimental-transform-types`, que **Node 26 ya no
acepta** (la CI usa Node 24). En local con Node 26 se ejecuta la misma suite sin ese flag; el único
fallo conocido es `apify-retry-scenario`.

## ✅ Composer del inbox GHL verificado EN VIVO en producción (2-oct, Freebuff) — PRs #307 + #308

La verificación en vivo del envío de respuestas (petición de Alex, contacto controlado) destapó y
cerró **dos bugs reales del composer** contra la API de GHL, ambos fusionados con CI verde y con
deployment production READY verificado por API de Vercel:

1. **#307 — sin `Content-Type: application/json` GHL ignoraba el body** (404 `Contact id not
given`): `fetch` sin cabecera manda el JSON como `text/plain` y la API lo descarta. `ghlHeaders()`
   añade la cabecera (merge `2560445`).
2. **#308 — el canal Email exige `html`**: con solo `message`, GHL responde 422 `There is no message
or attachments for this message. Skip sending.` Nueva función `cuerpoEnvioGhl()` que construye el
   body con `html` escapado SOLO para Email (merge `2b24e38`, deployment
   `dpl_SjAgDTc6sdXn81yrDcku3tFgbiGm` READY).

**Resultado de la verificación en vivo (2-oct):** envío real por la ruta de producción
(`/api/<slug>/evergreen/setting-ai/conversations/reply`) con sesión de un usuario QA efímero →
**HTTP 200 `{ok:true, messageId}`** y el read-back de la bandeja muestra el mensaje **dentro de la
conversación elegida** (canal email, participante `to***@gmail.com`) como mensaje del equipo
(`from=agente`). Usuario QA borrado después (0 residuos). La sonda reutilizable vive en
`scripts/sonda-inbox-envio.mjs` (list/send/cleanup; nunca imprime secretos ni PII).
**Pendiente de Alex:** confirmar que el correo llegó físicamente a la bandeja del contacto
controlado — la API de GHL ya lo registró en el hilo.

## Censo y ejercicio en vivo de los canales del composer (2-oct tarde, Freebuff) — email ya verificado en #307/#308

Ampliación de la verificación en vivo al resto de canales del composer (SMS, WhatsApp, Instagram,
Facebook). Censo REAL de la bandeja GHL paginando el POST "Cargar más" con la sonda nueva
`scripts/sonda-inbox-canales.mjs` (dedupe por id, corte honesto cuando el snapshot deja de crecer,
nunca imprime PII): **300 de 532 conversaciones únicas** — call=168 · instagram=91 · email=36 ·
webchat=3 · facebook=2 · **sms=0 · whatsapp=0**. Dos límites estructurales de la bandeja (no
bugs): el cap duro de 300 deja 232 conversaciones viejas sin alcanzar nunca (el refresco y la
continuación devuelven siempre las 300 más frescas fusionadas), y "cargadas" se queda en 300
aunque el total declarado sea mayor.

- **Instagram — pipeline íntegro y regla de Meta confirmada**: había 2 hilos de contacto
  controlado (QA) sin mensajes; el envío de prueba atravesó toda la cadena (resolución contra
  snapshot → GHL type IG → Meta) y Meta rechazó con la regla de la ventana de 24 h ("last inbound
  message earlier than 24 hours ago"): sin DM entrante reciente no se puede abrir conversación.
  HTTP 400 legible al composer — comportamiento diseñado, no bug. Cerrar el ciclo exige que el
  contacto controlado escriba primero.
- **SMS y WhatsApp — sin volumen en la location**: 0 conversaciones en las 532 visibles por la
  bandeja; no hay con quién probar el envío real. El cuerpo de esos canales ya está cubierto por
  tests (`cuerpoEnvioGhl`, claves exactas) y la ruta es la misma para todos: solo cambia `typeDe`.
- **Facebook — solo leads reales** (2 conversaciones, ninguna de prueba): no se envía QA a
  desconocidos. Misma ruta que IG (type FB) y mismo riesgo de ventana de 24 h.

Usuario QA limpiado tras el ejercicio (0 residuos). **Pendiente de Alex (decisión, no trabajo de
agente):** crear un contacto controlado de IG que escriba primero — o señalar uno existente con DM
entrante en las últimas 24 h — para cerrar la verificación del DM; decidir si quiere probar
SMS/WhatsApp con un teléfono propio tras conectar esos canales en GHL.

## ✅ Relevo de los carriles codex / Claude Code (2-oct, Freebuff) — «todo lo que les quede»

- **Migración `20260922100000` (prioridad 1 encargada a Claude Code el 25-sep): YA aplicada y
  registrada en producción.** Verificado por SQL el 2-oct: las 9 columnas de `expenses` y los 2
  índices existen y la versión está en `schema_migrations` (hay migraciones aplicadas hasta
  `20261001162712`). Las filas del tablero que la pedían quedan cerradas.
- **Ramas de worktree auditadas una a una — todo su contenido único ya está en `main`:**
  `cf-custom-fields-pr` (= PR #172 fusionada), `docs/consolidacion-y-relevo` (= PR #173 fusionada),
  `docs/handoff-clarity` (nota de estado del 22-sep, absorbida por el handoff actual),
  `fix/f1-raw-events-unique-total` (sustituida por la migración `20260923193000`; el índice TOTAL
  de `raw_events` está verificado en producción y en `main`) y `feat/money-25sep` (PR #225 cerrada
  el 1-oct con verificación punto por punto de que sus 5 unidades están en `main`). **Se dejan en
  disco**: el sandbox actual se cuelga al inspeccionar esos directorios (EPERM) — borrarlas es
  seguro con esta evidencia.
- **`docs/DASHBOARD_AUDIT.md` y `docs/DASHBOARD_CORRECTION_PLAN.md` (auditoría de codex del 25-sep)
  siguen SIN commitear a propósito**: contienen volúmenes e importes reales del tenant y el repo es
  público; su resumen público vive en este documento y sus puntos ya están cerrados por #269/#273
  (cash canónico), #278 y #284. No subirlos sin redactar.
- Basura `route 2.ts` (artefacto de copia de macOS) eliminada del árbol de trabajo.

## Inbox operativo: responder leads + embudo de DM (1-oct, Freebuff) — fusionada #306

Petición de Alex («mejora todo el UX/UI para revisar y escribir a estas personas, todo IG y TikTok
que pasa por GHL, y ver en esa misma área los KPIs del DM funnel»). Tres piezas, todo en la misma
área de Conversaciones:

1. **Composer de respuesta (GHL)**: `enviarMensajeGhl` hace POST `/conversations/messages`
   (doc 2021-07-28) con `typeDe` según el canal de la conversación (instagram→IG, facebook→FB,
   whatsapp→WhatsApp, email→Email, resto→SMS). La ruta `reply` resuelve la conversación CONTRA
   el snapshot del tenant (nada del cliente se confía: ni contactId ni canal) — efecto externo
   irreversible con doble validación. UI: Enter envía, burbuja optimista, error reintentable,
   auto-scroll al enviar. Sin contacto GHL se explica, nunca falla en silencio.
2. **Embudo de DM en las tarjetas**: `respondidas` (el equipo contestó tras el último del lead —
   `respondidoDespuesDelLead` en `lib/instagram/conversation-metrics.ts`, fuente compartida
   IG/GHL) y `conEnlaceAgenda` (señal declarada, nunca cita). Cadena visible conversaciones →
   respondidas → enlace enviado → cita en CRM.
3. **TikTok**: llega como TYPE_TIKTOK, el mapeo genérico ya lo traía; ahora se etiqueta, filtra
   y se declara en el hint de la tarjeta.

5 tests nuevos (`typeDe`, `enviarMensajeGhl`, `respondidoDespuesDelLead`, embudo en resumen).
Fusionada en `16e19df` con CI completo verde a la primera y producción READY **verificada por API
de Vercel con el conector MCP**. La verificación en vivo quedó **CERRADA el 2-oct** (sección «Composer del inbox GHL verificado EN
VIVO» de arriba): envío real confirmado contra GHL en producción.

## Marcas de cita/venta verificada en el inbox (1-oct, Freebuff) — fusionada #305

Petición de Alex («marca visualmente las conversaciones con venta o cita verificada en el CRM»):
los badges "Cita" (verde, CalendarCheck) y "Venta" (brand, DollarSign) aparecen en cada fila de
la bandeja cuando la conversación está enlazada a un contacto con cita/venta en BD. Fuente ÚNICA:
`porConversacion` que **ya devolvía** `/conversations/metrics` para las tarjetas
(`lib/instagram/conversation-metrics.ts` + `lib/ghl/conversaciones-metricas.ts`) — sin segunda
definición de "verificado" ni llamadas nuevas; `null` (sin contacto vinculado) NO es marca.
Helpers puros en `lib/setting-ai/inbox.ts` (`alimentarVerificadas`, `marcaVerificada`) con 2 tests
nuevos. Fusionada en `8c5b9e8`, CI completo verde y producción READY **verificada por API de
Vercel con el conector MCP**. Nota: el primer push de la PR falló `format:check` (el TSX quedó
formateado en el arnés y se devolvió sin devolver — misma lección de #301); corregido en
`b511688`. Sin acciones pendientes.

## Bandeja de GHL paginada incremental ("Cargar más") (1-oct, Freebuff) — fusionada #303

Petición de Alex («prepara el inbox para más de 100 conversaciones»): el listado de
`/conversations/search` se pide por páginas con el cursor oficial `startAfterDate` (doc
2021-07-28, `sortBy=last_message_date&sort=desc`) hasta cubrir el objetivo o agotar el deadline
(20 s) — lo leído se devuelve SIEMPRE con cursor de continuación (nunca una lista vacía
disfrazada ni un "más" que repita página). El cursor (`ghl_conversaciones_cursor` en
`integration_settings`) y la fusión (sin duplicados, lo fresco gana, tope 300, tope en
`cursorMasProfundo` para que un refresco nunca retroceda la bandeja) viven en servidor; el inbox
añade el botón "Cargar más" (spinner, contador "125 de 530", error reintentable) y la ruta un
`POST` de continuación (efecto externo con presupuesto: el GET sirve snapshot y refresca en
`after()`, así un prefetch no gasta páginas). 6 tests nuevos (multi-página, continuación
idempotente, deadline con cursor, página repetida, fusión, cursorMasProfundo). Fusionada en
`4e56ebd` con CI completo verde y producción READY **verificada por API de Vercel con el conector
MCP**. Nota operativa: la concurrencia del CI es global — los pushes en ráfaga de la rama
`audit/mvp-phase0-baseline` (carril plan) cancelaron 3 veces el Smoke E2E; re-lanzado en ventana
estable (3 min sin runs en curso) salió en verde a la primera. Sin acciones pendientes.

## Avatar del inbox con foto real (1-oct, Freebuff) — fusionado #302

Petición de Alex («usa la foto de perfil real del contacto con fallback a iniciales»): GHL trae
`profilePhoto` por conversación en `/conversations/search` y ahora se mapea a `contact_photo_url`
(`null` si no llega o no es string); el componente `Avatar` del inbox la pinta con `onError` que cae
a iniciales y luego al icono del canal. **Nota:** Instagram no expone foto en el pipeline actual
(participants de la Graph API solo username/name, sonda 29-sep) — la foto real llega solo vía GHL;
el Avatar queda genérico por si IG la añade. Fusionado en `1b11a5c` con CI completo verde (Quality
2m22s, Build 2m4s, Smoke E2E 5m32s) y producción READY **verificada por API de Vercel con el
conector MCP** — el token del CLI local en `auth.json` expiró el 30-sep: si toca volver a usar el
script `/tmp/vercel-check.mjs`, primero `vercel login`. Sin acciones pendientes.

## ✅ GHL verificado en producción (29-sep tarde) — el hallazgo de la credencial huérfana era un artefacto local

**Corrección del hallazgo original de esta sección.** La credencial NUNCA estuvo huérfana: el token
descifra con la CONFIG_ENC_KEY de producción y la API de GHL responde (sonda de solo-lectura 29-sep:
HTTP 200, 20 conversaciones de 530 en la location, todas con transcripción). El error de descifrado
del diagnóstico anterior era una contaminación del propio arnés: `vercel env pull` redacta las
variables sensibles del dashboard ("[Sensitive]") y entrecomilla el resto, y la clave maestra se
derivaba del valor ENTRECOMILLADO en vez del limpio — por eso "unable to authenticate data" solo en
local. Además, el snapshot `ghl_conversaciones_snapshot` escrito a las 14:57Z con 20 conversaciones
reales (vinculaciones ghl_contact_id/email incluidas) prueba que la pestaña ya tiró de datos reales
en producción ese mismo día. **Sin acción pendiente para Alex en la credencial.**

**Lo que la verificación en vivo SÍ destapó (fix en el PR de la misma fecha):** la firma real de la
API diverge del mapeo en dos campos — `lastMessageDate` llega como epoch en MILISEGUNDOS (el mapeo
esperaba ISO-8601 → `updated_time` salía siempre vacío) y la llamada perdida llega como
`TYPE_NO_SHOW` (conversación TYPE_PHONE, messageTypes [100]) que se etiquetaba como canal
"no_show". Ahora `aIsoFecha` acepta epoch/ISO y `canalDe` mapea TYPE_NO_SHOW → 'call'.

**Lección para futuros diagnósticos:** los valores de `vercel env pull` NO son literales (redacción
para secretos, comillas para el resto): limpiar SIEMPRE antes de derivaciones criptográficas y
desconfiar de un "indescifrable" que producción no sufre.

## Cierre de sesión GHL (29-sep, Freebuff) — todo fusionado y desplegado

Las 5 unidades de la sesión están fusionadas con CI verde y en producción: #283 (pestaña GHL en
Conversaciones), #292 (GHL en el resumen cross-plataforma), #294 (búsqueda + filtro por canal),
#295 (sonda de verificación en vivo) y #297 (aviso de credenciales indescifrables en Integraciones).
Producción verificada por API de Vercel: deployment READY en `398d1b9` (lo posterior a main son
docs-only con deployment CANCELED por ignoreCommand, por diseño). Home 200; rutas
`/conversations?platform=ghl` e `/integraciones` vivas (401/307 sin sesión). CHANGELOG completo.
`main == origin/main`, tablero sin filas de esta sesión. **Seguimiento:** la verificación en vivo se
cerró el mismo día — el fix de mapeo de la firma real (sección ✅ de arriba) entra en el PR de esa
fecha y no queda ninguna acción pendiente para Alex en GHL.

## Rediseño de Conversaciones como inbox de dos paneles (29-sep noche, Freebuff) — fusionado #301

Petición de Alex («revísala como diseñador UX/UI de plataformas de chat»): Setting AI › Conversaciones
pasa de acordeones a bandeja unificada — lista escaneable con avatar, vista previa del último mensaje
("Tú: …"), tiempo relativo, punto de no-leídos y badge de canal con icono; panel de chat con
separadores Hoy/Ayer, hora por burbuja, equipo a la derecha y auto-scroll. Skeleton de carga, estado
sin-configurar con enlace directo a Integraciones. Lógica pura en `lib/setting-ai/inbox.ts` (+10
tests deterministas). Sin cambios de API ni contrato de datos; Instagram y GHL comparten la UI.
Fusionado en #301 (`b4e1194`) con CI completo verde y producción READY. Nota de diseño: el canal
NO_SHOW de GHL se presenta como "Llamada" (llamada perdida, ver sección ✅ de arriba); si algún día
GHL distingue no-show real de llamada, es un cambio puntual en `canalDe`.

## Estado de entrega — 28-sep-2026

PR [#284](https://github.com/torrealex97-star/Growth-Ops-App/pull/284) **fusionado** en `main`, commit `5b74885`. CI del head `24aa455`: formato, lint, tipos, unitarias/métricas, build, secretos y Smoke E2E **PASS**. La preview omitida de Supabase no equivale a una prueba ejecutada.

El despliegue de producción asociado al merge sigue **PENDING** en la última consulta a GitHub; se observó en cola en Vercel. No afirmar que la web pública contiene estos cambios ni que el flujo de registro se ha probado allí. Un commit posterior de main puede sustituir este despliegue: verificar que incluye `5b74885` y su estado READY antes del smoke.

### Continuación priorizada y criterio de cierre

1. **Producción y cobros**: comprobar despliegue del merge o descendiente; revisar Ventas y campana con sesión existente. Verificar lista, permisos admin/closer y formulario nueva venta/cuota. El alta real no se ejecutó: probar persistencia, idempotencia y comisiones en QA con datos de prueba, nunca registrar ventas ficticias en un tenant real.
2. **Otras fuentes**: Stripe es la única bandeja automática implementada. Confirmar proveedores realmente activos antes de añadir conectores. Transferencias y otras fuentes manuales conservan su flujo; la integración de deuda no demuestra ingesta de cobros.
3. **Cobertura operativa**: completar paginación y aislamiento de ventas/atribución/usuarios en Registro; comprobar más de 1.000 filas y errores de fuente sin convertirlos en cero.
4. **Finanzas**: revisar Cobros, Morosidad y Conciliación. Explicar y conciliar consolidado Stripe + interno frente al libro interno, planes incompletos y comisiones por creación frente a liquidación. No forzar igualdad entre universos distintos.
5. **Atribución y tasas**: revisar periodos, muestra, asignación y cohortes maduras; Show Rate sobre citas resueltas según contrato canónico. Orden obligatorio: definición → fuente → completitud → periodo → madurez → asignación → cálculo → benchmark. Un benchmark nunca prueba por sí solo un error.
6. **Visual/responsive**: verificar dashboards en móvil y escritorio con branding del tenant. Mantener métricas documentadas; no rellenar ausencias con datos ilustrativos. Clientes/retención aplazados por indicación del usuario.

Documentación canónica: `docs/SOURCE_OF_TRUTH.md`, `docs/METRICS.md`, `docs/MONEY.md`. Cash Collected medio de venta nueva representa la primera transacción de esas ventas, no todo el cash del periodo dividido entre ventas nuevas. La consulta de liquidaciones fue solo lectura; no se borraron ni modificaron comisiones. El detalle financiero permanece en la base de datos, no en este repositorio.

Esta actualización documental no reserva archivos para implementación futura. Reclamar el siguiente lote antes de editarlo; no retomar todo el backlog simultáneamente.

## Codex — cobros pendientes en Ventas y campana, 28-sep

Rama `codex/finance-breakdown-donuts` / PR #284, ampliada por petición del usuario. Bandeja de cobros Stripe sincronizados sin referencia interna en Ventas y en notificaciones; closers solo contactos asignados, admin/director pendientes globales del tenant. Lecturas paginadas, identidades ambiguas no asignadas por intuición. Registro humano de venta nueva (producto, plan, total pactado y cuotas restantes) o cobro de venta existente. Importe, moneda, estado y fee se verifican contra Stripe antes de escribir. Reserva existente conserva su estado: completar el producto/plan desde el detalle de venta. Fuentes manuales conservan el registro habitual; no se añadió un conector automático inexistente para seQura/transferencias.

Migración `20260928191947_resolve_payment_inbox.sql` APLICADA mediante Supabase y registrada con esa versión. Función SECURITY INVOKER solo service_role; EXECUTE de anon/authenticated denegado comprobado en BD. No se modificaron ventas/cobros reales. Transacción y candado por pago evitan ventas parciales/doble clic; referencia pi/ch reconocida. Cobro manual similar sin referencia bloquea y exige conciliación. Comisiones usan atribución/generación existentes; fallo queda marcado para revisión.

Validaciones: quality PASS (1.141 unitarias, 3 omitidas; 783 métricas), build PASS, dead-code informativo. `tests/integration/payment-inbox-postgres.mjs` ejecutado contra PGlite aislado: alta, reintento, cuota existente, rollback de plan inválido/cobro manual y permisos. Para repetir, instalar PGlite fuera del repo y pasar `PGLITE_TEST_MODULE` a su módulo ESM. Sin dependencia nueva de producción. Advisor de seguridad no menciona la función nueva.

Verificado local con build optimizado: lista, contador y campana con enlace a Ventas; formulario inline, opciones de venta nueva/cuota y estado sin ventas existentes. El modal inicial bloqueó el renderizador del navegador integrado; sustituido por edición inline, comprobada visualmente sin bloqueo. No se pulsó Guardar sobre pagos reales. CI del head final PASS, incluido Smoke E2E; PR #284 fusionado. Despliegue público pendiente de verificación. El E2E de la revisión anterior del PR fue CANCELADO por concurrencia (no fallo de código).

Servidor local optimizado 127.0.0.1:3100, configuración existente únicamente en memoria. Siguiente: verificar despliegue de producción y ejecutar el smoke indicado arriba. Seguir preguntando por otras fuentes automáticas si el usuario confirma alguna; hoy solo Stripe aporta pagos no registrados en el espejo.

## Codex — gráficos circulares de Finanzas (28-sep)

Rama `codex/finance-breakdown-donuts`. Los tres desgloses de Negocio (cobros por mes de venta, gastos y comisiones por función) reutilizan `FinanceBreakdown`, igual que Finanzas. Fuentes y cálculos intactos. Se conserva la leyenda completa, incluidos ceros, y el estado de ajustes negativos. Corregido el aviso de agrupación: ya no aparece cuando solo se excluyen ceros del anillo.

Quality completo PASS y los tres anillos verificados visualmente en localhost:3100. Servidor local sustituido después por build optimizado, configuración solo en memoria. Incluido en PR #284 fusionado, CI PASS; producción pendiente de verificación. Archivos: `components/os/BusinessFinance.tsx`, `components/finanzas/FinanceCharts.tsx`. Sin datos privados ni cambios de base de datos.

## CODEX — continuación de auditoría, 28-sep

PR de entrega: [#282](https://github.com/torrealex97-star/Growth-Ops-App/pull/282), rama `codex/metrics-audit-continuation`, desde main tras merge #278. Implementación terminada; consultar el PR para el estado de CI/fusión/despliegue. Esta sección documenta el lote y no reserva archivos para trabajo futuro. Ámbito: consulta/diagnóstico/registros de métricas, dashboard principal e índice de Analítica, fuentes/atribución/Colaboradores, resumen de registro de ventas y aclaraciones de Finanzas/Instagram. No hay migraciones ni escrituras de negocio. #278 fusionado, CI completo aprobado y despliegue confirmado en el embudo de producción.

Implementado en esta continuación:

- Analítica general reutiliza `canonicalCash` y `serieCanonicaCash`: primaria Stripe y cobros internos sin duplicar, mismo valor/serie que Negocio. Fallos o truncado de fuentes invalidan métricas dependientes y previsiones; COGS incompleto no se vuelve cero.
- Cash ROAS queda desconocido sin el enlace de pagos a adquisición de pago; no se sustituye por MER. Agendas deduplicadas; tasas de cierre sin cohorte enlazada/madura no se infieren de flujos.
- El motor deja de llamar «sin medir» a métricas que tienen valor pero no tienen objetivo. Índice de KPIs presentado con cobertura/fiabilidad e hipótesis a verificar; ratio cash/facturación no equivale a deuda.
- Atribución abandona los totales históricos mezclados con el periodo: todas las lecturas están aisladas por tenant y paginadas; identidades se consolidan preservando las atribuciones de sus duplicados. Citas, ventas, first/last touch y calidad corresponden al ámbito temporal indicado. Reservas excluidas. Se conserva el test de seguridad del RPC existente y se prueba el aislamiento de las nuevas lecturas.
- `ghl`/`ghl_import` por sí solos no son canales publicitarios; si existe UTM válida se conserva. La cobertura usa Facturación, no Revenue.
- Colaboradores pagina fuentes de KPI, consolida agendas y evita contar dos veces el mismo contacto. Comisión por creación distinta de liquidación explícita; cobros de ventas del periodo no se llaman facturación.
- Dashboard principal consolida leads/agendas y cuenta canceladas dentro de agendas, como Negocio. Muestra actividad sin conversiones de cohortes no enlazadas; tabla por fuente con el mismo periodo. Facturación/inversión y CAC global se identifican sin llamarlos ROAS atribuible.
- Analítica usa los presets compartidos (mes/trimestre/año naturales y ventanas móviles inclusivas), con fechas visibles. La previsión y series observadas terminan en hoy; no usan relleno futuro ni proyectan más allá del periodo. El aviso de atribución diferencia registro histórico de cobertura publicitaria del periodo.
- Registro de ventas excluye reservas abiertas de su resumen, conservándolas en la tabla operativa; origen registrado no se presenta como prueba de atribución.
- Resumen financiero identifica el anillo del libro interno. Proyección vacía declara dependencia de planes completos. Instagram distingue alcance acumulado por pieza de personas únicas.

Verificado con sesión local: Atribución y Negocio coinciden en leads/agendas/ventas/facturación; Analítica general y Negocio coinciden en cash consolidado. Colaboradores carga sus ventas/cobros/comisiones; cohortes recientes muestran En maduración sin semáforos de rendimiento. Se detectaron y corrigieron durante esa revisión el falso «sin medir» por falta de objetivo y las importaciones contadas como atribución; ambos ajustes confirmados en navegador. La revisión de periodos detectó además que Analítica cortaba Este mes en hoy, a diferencia del resto de vistas; corregido con el helper compartido.

Quality (formato/lint/tipos/unitarias) y suite de métricas final PASS: 1.136 unitarias, 3 omitidas y 783 métricas. Build final PASS, incluida previsión. Validación visual final: la previsión usa solo días observados y termina en el cierre del periodo. Dead-code informativo ejecutado. Sin datos de tenants en fixtures/docs.

Entrega condicionada a CI/preview de #282. Responsive pendiente (intento de viewport de herramienta no confirmó tamaño efectivo, no contarlo como validación móvil). Datos que no deben inventarse: Cash ROAS atribuible, conversiones de cohorte madura, planes de deuda completos, clientes/retención y desglose por closer del resumen. La cobertura no autoriza modificar registros para forzar igualdad. Dashboard, periodos y registro confirmados en el build final: recuentos coherentes y reservas excluidas del resumen. Cobros inspeccionado: tabla del libro interno, sin total consolidado; pendiente aclarar el subtítulo «todos los pagos» y cobertura de lectura. Conciliación inspeccionada: tabla vacía de resultados de cotejo, no demuestra que todos los cobros estén conciliados; no se pulsó Cotejar ni se importaron datos.

### Siguiente lote, por prioridad

1. **Cobertura de lecturas operativas**: `ventas/registro` aún usa consulta sin paginación para ventas/atribución y listado de usuarios sujeto a RLS sin join tenant_members. Aplicar el patrón paginado y aislamiento ya validado; revisar error de atribución, estado obsoleto tras fallo y tests con más de 1.000 filas. Dashboard principal usa techo con detección; validar el límite real del servidor, no asumir que range amplía PostgREST.
2. **Show Rate y diagnóstico**: conservar definición canónica sobre citas resueltas y mostrar su muestra/cobertura junto al porcentaje. No equipararlo a asistencias/total agendas de Negocio. Auditar recomendación de escalado y semáforos contra completitud, madurez y asignación antes de benchmarks; no afirmar causalidad.
3. **Finanzas**: inspeccionar Cobros y Morosidad, cobertura de planes/ingesta y estado vacío de Conciliación. Contrastar consolidado Stripe+interno con libro interno mediante conciliación por pago/venta; no forzar iguales fuentes de distinta cobertura. Diferenciar comisiones por creación/liquidación y gastos, sin modificar registros.
4. **Adquisición**: fuente de registro distinta de canal; completar verificación de filtros de pago/campaña, formularios y calidad. Cash ROAS necesita enlace verificable pago→venta→canal; no sustituirlo por MER. Revisar todas las series y paginación en pestañas secundarias de Instagram.
5. **Visual y responsive**: repetir matriz completa con rango idéntico, móvil real confirmado y estados vacíos/fallo; registrar pantalla, fuente y resultado, sin datos privados. Clientes/retención sigue aplazado por el usuario. Desglose de closer requiere fuente enlazada, no filas inventadas.

Servidor local configurado con credencial de servidor existente comprobada contra el proyecto actual, solo en 127.0.0.1:3100; credenciales solo en memoria del proceso, nunca en archivos del worktree ni navegador. Esta configuración permite verificar APIs antes bloqueadas por configuración local. No imprimir variables ni payloads.

## Relevo prioritario — auditoría transversal de dashboards, 28-sep cierre

El usuario solicita subir y fusionar lo validado y continuar el resto con otro agente. Rama `codex/dashboard-consistency`, PR #278. Leer primero esta sección y `docs/DASHBOARD_VISUAL_AUDIT.md`; los párrafos históricos posteriores no certifican el estado actual. No cambiar datos de negocio ni usar «Ver como».

### Correcciones de este lote

- Ventas/Ranking/Actividad: consultas por tenant, estados de error, reservas excluidas mediante contrato existente; agendas canónicas. Embudo muestra actividad independiente, no conversiones de personas no enlazadas. Ofertas explícitamente declaradas.
- Tendencias: total del periodo completo, comparación solo con periodo anterior explícito; eliminado cálculo que partía la serie en dos. Ejes monetarios más anchos y variaciones neutrales.
- Meta: no sumar alcance único entre días/campañas; sin comparación inventada. Funnels reutiliza recuentos CRM canónicos y bloquea conversiones/pérdidas no demostrables.
- Cohortes financieras: ventanas inmaduras sin porcentaje definitivo; excluidos cobros de ventas no elegibles y futuros. VSL sin muestra no presenta tasas cero ni diagnóstico de caídas.
- P&L: nombres y alcance del libro interno explícitos, resultado con signo. Gastos registrados diferenciados del total P&L. Colaboradores distingue cobros de facturación, excluye reservas y respeta signo de ajustes de comisión.
- E2E actualizado al selector conjunto Facturación/Cash Collected y sección Asistencia; no se elimina cobertura de interacción/móvil.

### Plan pendiente, en orden

1. **Verificación del cierre:** consultar PR #278 y SHA actual; confirmar Quality, Build, Smoke E2E y despliegue. No usar verde de un SHA anterior. Si no está fusionado, resolver checks antes de merge. No asumir que producción ya cambió.
2. **Analítica general (prioridad alta):** `components/metrics/PanelGrowth.tsx`, `lib/metrics/consulta.ts`, `agregados.ts`, API `evergreen/metricas/brief`. Se observó Health máximo con cobertura insuficiente, denominadores contradictorios de métricas disponibles y cash del libro interno etiquetado como consolidado. Unificar con reconciliación canónica y bloquear conclusiones si falta fuente, periodo, madurez o población. Cash ROAS requiere atribución real: no dividir todos los cobros entre gasto publicitario. Añadir regresiones de fuentes incompletas, reservas, cero frente a desconocido y cobros de ventas anteriores.
3. **Atribución (NO incluida en este lote):** conserva implementación previa. Mezcla totales históricos con agendas del periodo; RPC debe seguir aislando tenant. Rediseñar consulta autorizada/paginada con mismo periodo, exclusión de reservas, deduplicación y distinción fuente de ingesta/canal. Conservar prueba `tests/atribucion-aislamiento.test.mjs`; adaptar al nuevo contrato solo demostrando aislamiento equivalente. Un borrador descartado está en `/tmp/growthops-attribution-pending.patch` de esta máquina; es referencia incompleta, NO aplicar sin revisión. Primer/último toque y calidad necesitan alcance temporal explícito.
4. **Colaboradores y comisiones:** completar paginación/detección de truncado, deduplicación de contactos/citas. Explicar comisión por fecha de creación frente a periodo de liquidación/P&L; no reasignar roles ni forzar igualdad entre poblaciones distintas. Validar devoluciones/ajustes negativos.
5. **Finanzas:** aclarar origen de cobros del libro interno frente a consolidado en resumen. Proyección/morosidad sin planes no prueban inexistencia de deuda: mostrar cobertura. Verificar desglose de comisiones por tipo, gasto publicitario sin duplicar, primer cobro de venta nueva y cuotas de ventas anteriores. Cash Collected medio sigue siendo SOLO primera transacción de ventas nuevas (corrección previa `05c304d`).
6. **Revisión visual después del build/despliegue:** Unit Economics, Embudo, Ranking, Actividad, Funnels, Marketing/Meta, Atribución, Colaboradores, VSL, resumen/P&L/cohortes/proyección/morosidad/gastos/comisiones. Escritorio y móvil 390 px; probar selector, periodo, granularidad, filtros, tooltip, errores y vacíos. Esta sesión inspeccionó pantallas anteriores al último lote; aún NO certifica cada pantalla corregida.
7. **Instagram y resto:** alcance agregado de reels no es personas únicas; aclarar periodo y etiquetas. Completar revisión de ventas/registro, cobros/conciliación y dashboard principal. Contenido editorial vacío se verificó; no necesita métricas ficticias. Clientes se mantiene pendiente de definición del usuario.

### Entorno y criterios de aceptación

Checkout local `/tmp/growthops-dashboard-consistency`, puerto 3100. Runtime Node en caché Codex. Solo variables públicas de Supabase en servidor local; endpoints que requieren credencial privilegiada pueden fallar localmente. Revisar esos endpoints en preview/producción autenticada; NO inyectar secretos en logs/docs. No hay cambios de BD/migraciones en este lote.

Mismo tenant, periodo, zona horaria, población y fuente deben dar mismo KPI en todas las vistas. Fuentes fallidas/truncadas son desconocidas, no cero. No comparar poblaciones distintas como conversiones. Diagnóstico obligatorio: definición → fuente → completitud → periodo → madurez → asignación → cálculo → benchmark. No publicar cifras reales ni nombres de clientes en este repositorio público. Usar fixtures sintéticos.

Validación local del lote final: quality PASS (1.135 unitarias, 3 omitidas y 778 métricas); dead-code informativo ejecutado. Build local PASS antes del último ajuste de paginación del embudo. Verificación autenticada detectó lectura truncada; se sustituyó por fetchAllRows con orden estable. La causa adicional era users.tenant_id inexistente; Embudo/Ranking/Actividad ahora filtran usuarios mediante tenant_members!inner, como el dashboard principal. Quality repetida PASS después del ajuste. El build/Smoke definitivo debe pasar en CI. CI del SHA subido debe confirmarse en el PR antes de fusionar. Smoke anterior fallaba por selector antiguo, no por autenticación: actualizado, pendiente resultado del nuevo CI. No declarar la auditoría completa.

## ✅ Producción desbloqueada: builds de Vercel vuelven a desplegar + logo IA Winners 404 (PR #280, 28-sep tarde)

**Diagnóstico (5× `BUILD_EXCEEDED_MAXIMUM_TIME`, 10:37Z-15:16Z):** los builds de Vercel expiraban
en la fase «Linting and checking validity of types» (el compile de Next acababa en 3,2 min):
ESLint 9 (#262) + Tailwind 4 (#263) dispararon la carga de tipos que en CI exige 6 GB de heap, y
la instancia de build de Hobby no llega. **Producción estuvo congelada desde 06:26Z** (f18e336):
todo el trabajo del día (PRs #271-#277) seguía fuera.

**Fix (`44dcecc`):** `next.config.js` salta typecheck/eslint SOLO en la build de Vercel
(`process.env.VERCEL`); CI de GitHub sigue siendo el gate de tipos/lint de cada SHA (4 jobs, 6 GB).
**Resultado verificado en producción:** el deployment de `44dcecc` pasó a READY en **~7 minutos**
(los builds pre-fix seguían expirando a los ~45-50 min — `d07bb45` murió exactamente igual mientras
el fix esperaba cola: control experimental involuntario).

Verificación en vivo tras el despliegue: `/brand/iawinners-logo.png` → **404** (borrado desplegado;
la marca IA Winners ya no queda accesible públicamente), home 200, hero.mp4 825.608 bytes y poster
WebP 17.598 con etags = MD5 del repo, PNG viejo 404, HTML de la home sin ninguna referencia a
iawinners. Riesgo asumido declarado: un push directo a main sin PR desplegaría sin typecheck (no
existe tal workflow hoy; si aparece, retirar el flag).

Nota: **ojo con la sección siguiente** («Dashboard WDC… deployment pendiente») — su pendiente de
despliegue quedó resuelto por este mismo deployment (`44dcecc` es descendiente de esos commits).

## CODEX — consistencia y rediseño de dashboards (28-sep, en curso)

Ampliación activa: auditoría visual de todos los dashboards departamentales y contraste con contratos existentes. Reclama `app/[tenant]/analitica/*`, `components/os/TrendChart.tsx`, sus tests y documentación; misma rama/PR. Amplía reclamación a `components/os/MetaAds*`, `lib/meta/funnels.ts`, VSL (solo estados sin muestra), cohortes financieras y etiquetas P&L; correcciones de madurez y presentación sin escrituras de negocio. Incluye `lib/funnels/{queries,compute,types}.ts` y página Funnels para reutilizar recuentos canónicos del CRM y bloquear conversiones no enlazadas. Reclama también Atribución y Colaboradores (lecturas/etiquetas/KPI) para exclusión canónica de reservas, periodo explícito y fuentes completas. Primera discrepancia reproducida: embudo comercial cuenta reservas y ofertas de poblaciones distintas; tendencia parte el periodo por la mitad sin fuente anterior explícita. No modificar datos persistentes. Inventario y evidencia se registran en DASHBOARD_AUDIT.md.

Corrección tras localizar `docs/SOURCE_OF_TRUTH.md`: se retiró íntegramente el intento no validado de redefinir adquisición. Lote actual se ciñe a `METRICS.md` §1/2/6 y MONEY D8: CAC por contactos únicos (no primeras compras), ventas activas/partial_refund, reservas excluidas de series; IA reutiliza SOURCE_REGISTRY. Nombres corregidos en dashboard, gráficos, pagos, gestoría y alta de cobro; se identifica libro interno bruto sin confundirlo con caja consolidada. No modifica datos ni decisiones A3. Quality final PASS (1133 unitarias, 3 omitidas; 765 métricas), cuatro nuevas de paridad contractual. Build PASS; smoke local confirma las etiquetas, servidor activo en 3100. Dead-code ejecutado como informe informativo. Coherencia global NO certificada: siguen discrepancias documentadas entre registros de caja, cohortes de tasas y documentación histórica.

Ampliación solicitada: coherencia transversal de términos y cálculos KPI en toda la app. Auditoría en `DASHBOARD_AUDIT.md`, sección revisión transversal 28-sep. Reclama revisión de registros `lib/metrics/registro.ts`, `lib/ai/metrics/registry.ts`, agregadores y consumidores de métricas; no aplicar cambios de contrato financiero ni CAC hasta resolver las definiciones contradictorias. La revisión visual anterior NO certifica coherencia global.

Terminología corregida a petición del usuario: Facturación (precio pactado) y Cash Collected (canonicalCash.net), también en selectores, evolución y tabla comercial. Finanzas muestra Facturación, Cash Collected y Devoluciones; elimina el KPI bruto redundante. No modifica fórmulas, fechas ni fuentes. Quality y build PASS. Producción pendiente.

Revisión solicitada con `.agents/skills/data-visualization-pro/SKILL.md`: conserva composición aprobada, añade tabla desplegable de valores a cada tendencia (incluye ausencia explícita), ajusta conectores y skeleton del embudo compacto a su altura y respeta movimiento reducido. Quality PASS (1133 unitarias, 3 skip; 761 métricas) y build PASS. No cambia cálculos ni fuentes. Verificado en navegador local: tabla desplegable con valores, embudo conectado en escritorio (1536 px) y composición móvil (390 px); viewport restaurado. Producción pendiente.

Rama `codex/dashboard-consistency`, base inicial `16d484c`; integrado main `d07bb45`. Rediseño visual aprobado por el usuario: resumen de negocio y bloques Marketing, Operación comercial, Ventas, Finanzas y Clientes; selectores de métricas y datos reales, sin cifras de maqueta. Reclama también components/os/DepartmentDashboard.tsx. Reclama unit-economics, resumen financiero, componentes KPI/funnel y acceso VSL con sus pruebas. Alcance: error VSL, periodo/población de embudos, trazabilidad de cash y señales KPI neutrales. No modifica datos financieros ni migraciones. Checkout aislado; WIP de navegación ajeno preservado.

Ajuste visual tras comparación con la maqueta aprobada: KPIs compactos específicos de esta vista, acento de marca en selectores/gráficas, cabeceras y notas compactas, barra segmentada de estados, funnel comercial de tres etapas con indicadores laterales, tabla de closer y matriz de cohortes con estado sin datos explícito. No inventa tasas ni clientes. Verificado con sesión local en escritorio (1536 px) y móvil (390 px, main.scrollWidth == clientWidth); restaurado viewport normal. Pendiente completar fuentes del desglose por closer/cohortes y comprobación de producción; no afirmar paridad de datos con los ejemplos.

Rediseño aplicado en código (verificación autenticada inicial realizada): cabecera de negocio con seis indicadores; evolución con selector; bloques Marketing, Operación comercial, Ventas, Finanzas y Clientes; barras por canal y estado, funnel existente y desglose de fuentes de cash. Mantiene marca/tipografía y cálculos canónicos. Métricas de la maqueta no cargadas por esta página (gastos, vencimientos, retención, primer contacto) no se inventan: acceso al detalle o estado explícito. Controles nativos con foco y aria-pressed; gráficos sin animación de geometría. Revisión React realizada. Tests estáticos adaptados al nuevo layout y smoke E2E de selectores/agrupación/móvil añadido (ejecución pendiente). Quality local PASS: 1133 unit + 761 métricas, 3 skips. Build local PASS; dead-code informativo ejecutado. Build servido en puerto 3100. Revisión local autenticada: se reprodujo RangeError de moneda al pintar ejes (Recharts pasa índice como segundo argumento); corregido envolviendo tickFormatter con un único valor numérico. Pantalla y cambio Facturación/Cobrado y Día/Semana verificados en navegador. No publicado en producción; revisión móvil y E2E completos aún pendientes.

Implementado: ambos embudos leen el mismo agregado del periodo; asistencia por estado confirmado y reservas excluidas mediante cuentaComoVenta. Sin conversiones de cohorte inferidas de totales independientes. LTV:CAC descriptivo, variaciones de gasto neutrales. Resumen separa cobros registrados brutos de consolidado Stripe/interno y expone diferencia sin tocar P&L ni crear cobros. Tests de periodo, reservas, asistencia y aislamiento de consultas.

VSL: POSTGRES_URL ausente en runtime. Tras autorización y acceso al Dashboard, credencial validada con el pooler oficial (conexión SQL y tablas VSL correctas); restaurada como secreto de producción en Vercel por stdin, sin mostrarla ni guardarla en temporales. Falta activación y comprobación HTTP: despliegues bloqueados en cola tras un build prolongado. Se canceló exclusivamente nuestro redespliegue del código antiguo al aparecer nuevo main; el despliegue Git de main posterior a la restauración debe recoger la variable. No afirmar VSL reparado hasta verificar la pantalla y endpoints.

PR #278, commit de código 97094a3. Validación: quality local PASS (1133 unit, 3 skips; 757 métricas); build local y CI PASS, quality CI y secretos PASS. Smoke E2E: 10 PASS, contrato adjunto agota 20 s con carga en curso; reintento del job solicitado, sin modificar pruebas. Preview en cola. Verificación visual pendiente. Nuevo main c28327f revisado: cambios en dashboard principal, sin sobrescribirlos. Siguiente: revisar E2E reintentado, desbloquear/verificar despliegue Git y VSL, luego integrar PR y comprobar pantallas. No fusionada.

### Punto de relevo solicitado por el usuario

Trabajo preservado en PR #278 y rama `codex/dashboard-consistency`; sin fusionar ni afirmar despliegue. El usuario pide pasar a otras tareas mientras queda este seguimiento pendiente. No repetir la recuperación de credenciales ni modificar datos para cuadrar métricas.

- **Validaciones por commit:** los resultados anteriores corresponden al código `97094a3`. Los commits posteriores solo actualizan/formatean este relevo. En la última consulta del head `aa59553`, Vercel seguía pendiente y no se mostraba una nueva ejecución de Quality/E2E; no confundir los resultados anteriores con validación del head actual.
- **VSL:** configuración restaurada y conexión SQL probada; pantalla y endpoints de producción todavía NO verificados. No volver a pedir la credencial ni guardarla en archivos. Primero comprobar si el despliegue Git posterior a la restauración ya terminó.
- **Al retomar:** leer main y reclamaciones nuevas; comprobar el SHA del despliegue activo y la cola de Vercel; validar VSL con sesión existente (sin «Ver como»); revisar el fallo/reintento E2E de contratos; actualizar la rama desde main sin sobrescribir trabajo ajeno; integrar solo tras checks relevantes y verificar Unit Economics y resumen financiero.
- **Criterio de cierre:** VSL carga sin error de conexión, PR integrada con checks aprobados, métricas del periodo coherentes y distinción de fuentes de cash visible en producción. Mantener el orden diagnóstico de KPI del usuario: definición, fuente, completitud, periodo, maturity, asignación, cálculo y finalmente benchmark.

## ⏳ Dashboard WDC alineado con el filtro temporal — código en `main`, deployment pendiente (28-sep tarde)

**No repetir el desarrollo.** Los cambios están publicados directamente en `main` en los commits
`c28327f` y `d07bb45`:

- El bloque financiero de `/[tenant]/dashboard` usa todo el rango seleccionado, no solo el primer
  mes. La facturación se fecha por `sale_date` y el cash por `collected_at` (MONEY D1), incluyendo
  cobros del periodo correspondientes a ventas anteriores.
- La gráfica «Facturación vs cash cobrado» usa exactamente el filtro global: detalle diario hasta
  45 días y mensual para rangos mayores. Ya no está fijada a «últimos 6 meses».
- Analítica/Métricas generales reutiliza las series canónicas de `/metricas/brief`; no se creó una
  segunda fórmula ni otra consulta financiera.
- Con un único producto activo, la cuarta KPI muestra **Cash collected medio** por venta cobrada.
  Con varios productos muestra **Ticket medio por cliente**, agrupando varias ventas del mismo
  contacto (una venta sin contacto cuenta como cliente independiente).
- Administradores/directores no ven las tarjetas de comisión personal en la vista agregada. Al
  seleccionar una persona sí aparecen con su nombre; closers, setters y colaboradores conservan
  su resumen propio.
- El estado vacío de «Objetivos de empresa» ofrece a liderazgo un enlace a
  `/[tenant]/kpi/templates?tab=objetivos`; esa URL abre directamente la pestaña Objetivos.
- Regresión añadida en `tests/metrics/dashboard-period-finance.test.mjs` (4 casos).

**Validación ejecutada antes del push:** format PASS, lint PASS con avisos preexistentes,
typecheck PASS, `test:metrics` 756/756 PASS y build real de producción PASS. La suite general
equivalente dio 1.130 PASS, 3 SKIP y 1 fallo preexistente de compatibilidad del arnés con Node 26
(`apify-retry-scenario`: parameter properties de TypeScript); no está relacionado con este cambio.

**Único pendiente:** comprobar el deployment y hacer smoke autenticado cuando Vercel libere la
cola. Deployment esperado:
`https://growthops-preview-3003-dp26vx2di-app-b1af.vercel.app` (`production`, estado `Queued` al
cerrar esta sesión). `https://app.scalixsystems.com` seguía apuntando al deployment READY de unas
8 horas antes, por lo que todavía no mostraba estos cambios. No lanzar otro deploy duplicado ni
cancelar los trabajos en cola sin identificar primero sus commits; Claude Code también estaba
publicando. Comandos de continuación:

```bash
vercel inspect https://growthops-preview-3003-dp26vx2di-app-b1af.vercel.app --wait --timeout 5m
vercel inspect https://app.scalixsystems.com
```

Cuando el deployment quede READY, verificar en WDC Dashboard: cambio de rango, totales y gráfica
coherentes, nombre de la cuarta KPI según número de productos, ausencia de comisiones en vista
admin agregada, enlace de objetivos y gráfica financiera dentro de Analítica/Métricas generales.

## 📋 Documento de decisiones para Alex: `docs/DECISIONES-PENDIENTES-ALEX.md` (28-sep tarde)

Las 3 decisiones que bloquean el resto de la auditoría FASE A (A5 clawback/refunds acumulados,
doble firma concurrente, onboarding de alumno sin outbox) con estado real verificado hoy, opciones
A/B/C, recomendación y coste estimado. Esperando la respuesta de Alex en formato
«A5: X · Firma: X · Onboarding: X».

## ✅ Último P1 de crons cerrado: presupuesto real del sync de pagos Stripe (PR #277, 28-sep tarde)

El deadline del sync de pagos Stripe (30 s cron / 45 s manual) **solo gobernaba la paginación**
dentro de `stripeList`. Después venían, sin presupuesto alguno: (1) el bucle de fees —una llamada
`charges/:id?expand[]=balance_transaction` POR PAGO, secuencial, cada una con timeout de hasta
20 s— y (2) el upsert al final. **Worst-case medido con mock: 2.000 pagos = 20 páginas + hasta
2.000 llamadas de fee ≈ 400 s solo de fees** (>6× el maxDuration=60 de Vercel): la función moría
sin escribir la página leída y el reintento empezaba de cero. Arreglado en
`lib/finance/stripeFees.ts` + `lib/finance/stripePaymentsSync.ts`:

- **Bucle de fees deadline-aware** (`fetchStripeFeesForChargeIds`): consulta el reloj antes de
  cada llamada con margen de 5 s para responder; tope duro de 200 fees por turno.
- **Upsert garantizado antes del corte**: el dinero de la página leída se persiste SIEMPRE;
  el reintento nunca empieza de cero.
- **Corte honesto**: `truncated || deadlineReached` y `fees_pendientes` en el detail del run
  (cron y ruta manual).
- **Fee bueno no se pisa con NULL**: si la lectura falla o el presupuesto se agotó, la clave
  `stripe_fee` se omite del payload → PostgREST no toca la columna en el conflicto (conserva el
  fee del espejo); filas nuevas quedan NULL con el fallback del motor (comportamiento declarado).
- **Fee inmutable no se re-pide**: una lectura previa del espejo (`stripe_fee IS NOT NULL`)
  ahorra el bucle entero cuando no hay pagos nuevos (caso común): 0 llamadas de fee.

Tests: `tests/stripe-fees-deadline.test.mjs` (7 con mock de Stripe: reloj, corte parcial que
no pierde el dinero, conservación de fee, NULL honesto, cero re-lecturas, guardas estáticas).

## ✅ Documentación de lecciones y deudas actualizada (28-sep tarde, Freebuff/Buffy — petición de Alex)

Cierre de la petición «actualiza todos los md con las lecciones y deudas». **Solo docs/markdown;
sin código.** Qué cambió:

- **`AGENTS.md`** — nueva sección «Reglas de código aprendidas a golpes (26–28-sep, auditoría
  FASE A)»: helpers UTC de fechas solo-día (`plan-cuotas.ts`), `{ error }` de supabase-js SIEMPRE
  (incluido el gotcha TS de filtrar unión types), claim atómico antes de efectos externos
  irreversibles, presupuesto de cron ≪ `maxDuration` + esqueletos antes del bucle, consumir los
  booleanos de helpers de escritura, error de carga ≠ estado vacío en UI, resets de formularios
  comparando valores, clases Tailwind solo de la escala existente y tests `.mjs` sin sintaxis TS.
- **`PENDIENTES.md`** — 🧱 Deuda técnica con 6 entradas nuevas: firmas concurrentes sin CAS
  (requiere decisión del responsable de contratos), onboarding de alumno sin outbox (carril F1),
  webhook GHL no-objeto (carril F1), refunds acumulados + clawback (A5 de Alex), semántica refunds
  `pending`/`rejected` en cash canónico (la deuda de los globs que la arrastraba la cerró en
  paralelo la PR #274). «Hecho recientemente» con el cierre de la FASE A (26–28-sep).
- **`CAPABILITIES.md`** — postdata 28-sep: la tabla NO se re-mide; lista lo resuelto con evidencia
  (10 hallazgos, PRs #236–#273) y los abiertos con su bloqueo real.
- **`CHANGELOG.md`** — entradas 26–28-sep: #269, #270, #271, #272, #273, reglas de AGENTS.md y
  escalado de dependencias del carril Claude Code (#261/#262/#263).

Validación: markdown puro — `prettier --check` en verde; el `paths-ignore` solo exime los pushes
a `main`, NO las PRs: esta pasó CI completo (4 jobs en verde).
Abiertos para Alex (decisión, no trabajo de agentes): A5 clawback/refunds, semántica de doble
firma, y los dos del carril F1 (onboarding outbox, webhook no-objeto) pendientes de coordinación.

## ✅ Bugs sin decisión de Alex cerrados: SeQura fail-closed + cash canónico verificado (PR #273, mergeada 28-sep tarde)

**MERGEADA** (squash `8586ebb` en `main`). CI verde completo (Quality 2m15s, gitleaks, Build 3m5s,
Smoke E2E 5m17s). Quality gate local en arnés: unit 1085/1089 (1 fallo = apify-retry-scenario,
conocido de node 26) y metrics 754/754.

- **SeQura (P2, «un hueco no es un cero»):** `searchAllOrders` asignaba `total=0` ante un listado
  sin `of N total` legible y `syncDelinquents` marcaba 'recuperado' a TODOS los morosos ausentes.
  Ahora listado ilegible o página corta vs total anunciado LANZA (`SequraApiError`), el run del
  cron falla y reintenta (sync idempotente por upsert); la salida vacía válida sigue pasando.
  `marcarRecuperados` extraída como función pura: lectura fallida no colapsa a `[]` y el update
  de 'recuperado' fallido propaga (antes `if (!error) recovered++` se lo tragaba).
- **Cash canónico (P1 parcial):** `canonicalCash` y `serieCanonicaCash` ya filtraban refunds a
  'processed' pero sin test (la serie ni siquiera tenía cobertura): 5 casos nuevos de regresión
  lo dejan verificado, paridad con `repNetCash` desde #269.
- **Deuda cerrada (PR #274, mergeada):** los 3 ficheros de `tests/canonical/` (que no encajaban en
  los globs de `npm test` ni `test:metrics` — no se ejecutaban en CI desde que se crearon) se
  reubicaron a `tests/`: la suite pasó de 1089 a 1127 tests y la capa canónica ya es red real.
- **Siguen abiertos SOLO los que requieren decisión de Alex/carriles ajenos:** clawback y refunds
  acumulados (A5), semántica de doble firma concurrente (responsable de contratos) y onboarding de
  alumno sin outbox (coordinación con carril F1 para el GHL webhook). **El Stripe fees/upsert P1
  quedó cerrado en PR #275 (sección de arriba).**

## Auditoría estática FASE A (26-sep) — estado al 28-sep (tarde)

**Qué es:** consolidación del informe de auditoría estática del 26-sep (inspección de código, sin
reproducción HTTP/DB ni acceso a producción). Al 28-sep **10 de los hallazgos abiertos están
resueltos y fusionados** (PRs #269/#270/#272/#273, CI verde completo en cada una); quedan los que
requieren decisión de negocio (detalle en la sección de arriba).

### Resueltos en `main` — informe original + tandas del 28-sep

- Informe original (PRs #236, #238, #239, #240, #244, #245, #249, #256, #259, #260; además `my-status` y `BusinessContextCard`): disputed ≠ cash; PATCH collections→cuota; approve-review recuperable; tools IA y detectores sin fabricar ceros/anomalías; historial del agente; crons monthly/reminders fail-ruidoso; allowlist de complete-reservation; sales/delete compensable; proyección con guards; webhook GHL con writes verificados; my-status propagando error; BusinessContextCard con try/finally.
- **#269 (tanda dinero):** el alta de venta consume el booleano de `recordCollection` (estado parcial, contrato de acceso bloqueado si el cobro falló, toast honesto); `repNetCash` solo resta refunds `processed`; `collections/record` fail-ruidoso si el count previo falla (no reenvía `venta.registrada`); `appointments/create` manual valida que el contacto es del tenant.
- **#270 (efectos externos):** cron Reels con presupuesto real (45 s) y esqueletos persistidos ANTES del bucle (si el runtime corta, nada se pierde); backfill de YouTube con claim atómico `pending→uploading` y espejo post-upload verificado (sin re-publicaciones).
- **#272 (UX/estados):** home con error explícito + reintento (no «cero subcuentas»); Setting AI tolera storage no disponible; devoluciones y follow-ups sin loaders eternos; ContactForm resincroniza por VALORES al deshacer; P&L, cohortes, proyección y gestoría declaran la fuente ilegible en vez de pintar sumas parciales.

### Abiertos — dinero y estados

- **P1 — clawback y refunds acumulados.** `refunds/create` no consulta refunds previos (dos parciales válidos pueden superar lo cobrado) y no tiene idempotency key; `calculateNegativeCommissionsForRefund` limita cada fila contra SU positiva, no el total del participante. **Requiere la decisión A5 de Alex** antes de tocar.
- **P1 — los tramos descuentan refunds no `processed`… parcialmente resuelto:** `repNetCash` ya filtra (PR #269), pero el cash canónico (`lib/canonical/cash.ts`) debe reverificarse contra refunds en `pending`/`rejected` cuando existan filas en esos estados.

### Abiertos — crons e integraciones

- **P2 — SeQura puede cerrar morosos con un listado ilegible o truncado** (`searchAllOrders` asigna `total=0` si no matchea `of N total`). Tests: salida vacía válida vs truncada, >100 pedidos.
- **P2 — webhook GHL: `JSON.parse` válido pero no-objeto lanza 500 antes de guardar el sobre.** Carril F1: coordinar. Test: cuerpo `null`/`[]`.

### Abiertos — aislamiento y contratos (requieren decisión/QA de firmas)

- **P1 — dos firmas concurrentes con el mismo token pueden pisar PDF/hash:** el UPDATE final no condiciona por el estado leído (sin CAS) y el storage sube con `upsert: true`; en firma de alumno el evento a GHL se emite antes del UPDATE. La propia auditoría condiciona el fix a decidir la semántica ante doble submit con el responsable de contratos (impacto jurídico/financiero).
- **P2 — onboarding de alumno sin outbox:** fallo de GHL → contrato firmado con `accesos_enviados_at: null` pero sin reintento automático (409 impide volver a firmar); fallo del UPDATE tras GHL aceptado → evento repetible sin dedupe visible.

**Cobertura y límites:** sin P0 identificado; siguen abiertos el barrido de escrituras restantes, el
contraste tipos↔esquema vivo, la RLS efectiva y el smoke E2E autenticado. Todo hallazgo sigue
siendo **estático hasta reproducirse** con mocks/QA.

## ✅ Assets hero en producción verificados (28-sep mañana, Freebuff/Buffy)

Cierre del pendiente de la noche del 27-sep («falta verificar el deployment que sirva los assets
nuevos»). Producción ya los sirve desde el deployment production READY `dpl_5EodtVe7` (commit
`f18e336`, PR #259, 28-sep 06:26Z — descendiente del `b7a77f9` de los assets; los builds propios
habían quedado CANCELED en cola de Vercel Hobby y quedaron cubiertos por los merges posteriores:
no hizo falta redeploy manual).

Verificación en vivo sobre `https://app.scalixsystems.com`:

- `/panel/hero.mp4` → HTTP 200, `content-length: 825608` (806 KB), etag `38f30eb7…` = MD5 byte a
  byte del fichero comprimido del repo.
- `/panel/hero-poster.webp` → 200, `content-type: image/webp`, 17,6 KB, etag = MD5 local.
- `/panel/hero-poster.png` → 404 (ya no existe ni se referencia).
- Home HTTP 200; su HTML solo referencia `hero-poster.webp` y `hero.mp4` (cero refs al PNG).
- Ahorro real por visitante nuevo, ya en producción: 6,70 MB → 0,82 MB (−88%).

**Borrado ejecutado el 28-sep con ok de Alex** (commit `05e05d1`): `public/brand/iawinners-logo.png`
(1,47 MB, 0 referencias en código, único resto de la marca IA Winners) eliminado del repo; además,
producción lo servía públicamente en `/brand/iawinners-logo.png` (200, 1.539.785 bytes) — tras el
despliegue esa URL pasará a 404. Queda vivo: las 12 credenciales de `integration_settings`
(esperando que Alex pegue valores; Meta ya verificada en vivo).

## ✅ UX/a11y: clases Tailwind fuera de escala y botones de icono sin nombre (PR #265, mergeada)

**MERGEADA** (squash `9eda4b0` en `main`, 28-sep). CI verde completo en la rama
(run 36391898185: Quality 1m43s, gitleaks, Build 2m14s y Smoke E2E 4m13s ✓). Fila del tablero
retirada; rama `audit/bughunt-visual` eliminada.

- **Bugs visuales:** `w-4.5 h-4.5` (BusinessContextCard, GrowthContextForm) y `h-18` ×2
  (modal de reels de Instagram) NO existen en la escala de Tailwind (sin extensión de
  `spacing` en el config): el icono caía a 24px por defecto dentro de una caja de 36px y la
  miniatura perdía su altura. Corregidos a la convención del repo (`w-4 h-4`, `h-14`).
- **A11y:** 14 botones solo-icono sin `aria-label`/`title` anunciaban «botón» a secas
  (contratos, plantillas, recursos, productos, KPI, Header, Sidebar, calendar-popover).
- Barrido sistemático post-fix: 0 utilidades fuera de escala, 0 botones de icono sin nombre.
- Descartados como no-bugs en el mismo barrido: `parseFloat` sobre importes (todos en
  `type="number"` con `min` salvo conciliación, cuyos negativos son movimientos legítimos),
  `key={index}` en esqueletos estáticos, `target="_blank"` (noopener implícito en
  navegadores modernos, pendiente como endurecimiento) y charts recharts (todos con
  `ResponsiveContainer`, sin API privada tras la major #261).

## ✅ Fechas solo-día del plan de cuotas ancladas a UTC (PR #264, mergeada)

**MERGEADA** (squash `04e3720` en `main`, 28-sep). CI verde completo en la rama
(run 36389161157: Quality 2m0s, gitleaks, Build 2m42s y Smoke E2E 5m12s ✓). Fila del tablero
retirada; rama `fix/cuotas-fechas-tz` eliminada.

- **Bug:** las fechas solo-día de cuotas/ventas se construían con `Date` a medianoche LOCAL —
  el default de «primera cuota del resto» nacía como el último día del mes actual, la fecha de
  venta se guardaba como ayer en la ventana 00:00-01:59 y `setMonth` desbordaba el día 29-31
  (30 ene + 1 mes = 2 mar).
- **Fix:** helpers canónicos `parseFechaDia`/`addMonthsUTC`/`addDaysUTC`/`aFechaDia` en
  `lib/sales/plan-cuotas.ts` (anclado UTC + clamp al último día del mes destino), aplicados a
  `buildRestInstallments`, al calendario SeQura de la página de venta y al fin de programa de
  students. Tests de regresión (`tests/cuotas-fechas-utc.test.mjs`) con guardas estáticas
  contra el patrón eliminado.
- **Sin backfill:** los vencimientos ya persistidos no se reescriben.

## ✅ E2E smoke del contrato Radix de los modales migrados (PR #258, mergeada)

**MERGEADA** (squash `e07f8f0` en `main`, 27-sep noche). CI verde en el SHA final `9e35b46`
(run 36348650627: Quality, gitleaks, Build y Smoke E2E 5m16s ✓). Rama `feat/r4-e2e-modales`
eliminada y fila del tablero retirada.

- `tests/e2e/modales-dialog.spec.mjs` (solo lectura): «Nueva agenda» y «Nuevo gasto» abren su
  modal, afirman `getByRole('dialog', { name })` visible y que Esc lo cierra.
- **Lección para specs de modales:** Radix `@radix-ui/react-dialog` 1.1.23 NO emite `aria-modal`
  (verificado en su dist: emite `role="dialog"`, `aria-labelledby`, `aria-describedby` y
  `data-state`; el aislamiento de foco lo hace `hideOthers`, no el atributo). Un assert de
  `aria-modal` falla siempre — el contrato correcto es dialog accesible por nombre + Esc.
- Los "failures" intermedios de CI eran cancelaciones del concurrency group global
  `e2e-tenant-qa` (merges paralelos), no fallos del spec: el único run que cuenta es el del
  último SHA de la rama.

## ✅ RESULTADO (27-sep, noche): cierre de las 12 ramas de Claude Code — 2 obsoletas descartadas, resto en cola (Claude Code)

Instrucción de Alex: "todo lo que ya esté listo mejor mergearlo... sino tendremos cientos de ramas".
Mientras se esperaba la CI de PR #245 (varias horas de reloj), otros agentes concurrentes fusionaron
#246-#254 en `main` — dos de las 12 ramas quedaron **superseded por contenido más completo** y
mergearlas sería un RETROCESO. Verificado archivo por archivo antes de descartar, no solo por nombre:

- **`chore/ux04-formato-moneda-fuente-unica` — NO MERGEAR.** `main` (vía PR #249) ya usa
  `formatCurrency` (2 decimales, canónico) en `ColaboradorDashboard.tsx`; mi rama volvía a
  `formatNumber` con `maximumFractionDigits: 0` y de paso borraba los campos `tipo`/`exento` de
  `FilaFutura` que #249 añadió. Cerrarla sin PR.
- **`feat/port-pr225-ads-filter-nuevo-recurrente` — NO MERGEAR.** Las 3 piezas del port de PR #225
  del propio Alex ya están en `main` por otra vía (#249): `lib/finance/nuevo-vs-recurrente.ts`,
  filtro de cuentas ads en `lib/metrics/consulta.ts`, y el dual chart (`tests/unit-economics-dual.test.mjs`).
  Mi versión de `commissions/future/route.ts` y `comisiones/page.tsx` es más VIEJA que la de `main`:
  le falta el veto `pays_commissions=false` (exención, MONEY D9) y el fail-closed en
  `resolverScopeColaborador` que #249 ya tiene. Mergearla borraría ambos. Cerrarla sin PR. **PR-R2.1
  del roadmap queda resuelta — no requiere más decisión de Alex, el port ya ocurrió.**

Ramas que SÍ seguían vigentes (verificadas contra el código actual, no por nombre) y su estado:

| Rama                                             | Estado                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fix/collections-patch-sync-cuota`               | Ya en `main` (PR #244) — hecha antes de este barrido                                                                                                                                       |
| `docs/a3-alertas-deprioritizadas`                | Ya en `main` (PR #242) — hecha antes de este barrido                                                                                                                                       |
| `docs/relevo-sesion-27sep-r4-y-ramas-pendientes` | Redundante (su contenido ya está en `main`, señalado por Freebuff más abajo) — no mergear                                                                                                  |
| `fix/collections-approve-review-recuperable`     | **PR #245, mergeada (squash) esta sesión** — 2 reruns de CI por cancelación de concurrency global (no fallos reales)                                                                       |
| `fix/disputed-no-es-cash`                        | **PR #256, abierta, en cola de CI**                                                                                                                                                        |
| `fix/ai-tools-lectura-fallida-no-es-cero`        | Pendiente, verificada vigente (`getSales` en `main` sigue sin comprobar `error`)                                                                                                           |
| `fix/ai-agent-historial-orden`                   | Pendiente, verificada vigente (`ai/agent/route.ts:62` sigue con `ascending: true`)                                                                                                         |
| `chore/recharts-3-major`                         | Pendiente, verificada vigente (`package.json` sigue en `^2.12.7`)                                                                                                                          |
| `chore/eslint-9-config-next-16`                  | Pendiente, verificada vigente (`eslint` sigue en `^8`, `eslint-config-next` en `^15.5.25`)                                                                                                 |
| `chore/tailwind-4-major`                         | Pendiente, verificada vigente (`tailwindcss` sigue en `^3.4.1`) — **revisar solape con tailwind.config.ts del lote 3 de taste (REQ-UX-03, tokens `text-3xs`/`text-2xs`) antes de mergear** |

**Lección para próximas sesiones:** con varios agentes concurrentes fusionando en `main` a lo largo
de horas, una rama abierta hace tiempo puede quedar SUPERSEDED sin que nadie la cierre. Antes de
mergear una rama "pendiente" del inventario, diffear sus ficheros clave contra `main` actual — no
asumir que sigue vigente solo porque nadie la tocó.

## 📋 "¿Qué falta para el 100%?" — resumen pedido por Alex (27-sep)

Fuera del barrido de ramas, esto es lo que falta según `RECOVERY_ROADMAP.md`, en orden:

1. **Bloqueadores de Alex** (desbloquean todo lo demás): credenciales Supabase read-only en el
   entorno de agentes; rotar `ANTHROPIC_API_KEY`/`GROQ_API_KEY`/token Management Supabase/GHL secret;
   `SEQURA_MERCHANT_REFERENCE` en Vercel (cron de morosos en fallo recurrente); pixel en
   womendigitalclosers.com + UTMs; reconexiones GHL con cabecera secreta; Railway worker; retención
   legal de raw_events/transcripciones. **PR #225 ya no bloquea nada — ver arriba, el port ya está en `main`.**
2. **Datos/métricas** (fase R3): clasificación de llamadas desde datos canónicos (no IA); gate de
   columnas fantasma en CI; verificar % shows/reservas con el golden dataset.
3. **UX/frontend** (fase R4): el lote 3 de taste (PR #250) ya cerró REQ-UX-02/03 completos y
   REQ-UX-05 parcial (6/14 modales) — queda backlog de 8 modales y la revisión visual de dashboards
   autenticados (bloqueada por falta de credenciales de sesión en sandbox).
4. **Features nuevas** (fase R5, deliberadamente al final): resto del contrato de métricas F3;
   creación de usuarios desde Config › Subcuentas; % VSL desde el reproductor; alertas A3
   (deprioritizada por Alex); rate limiting de login. **Fase 2 del VoC mining sobre Conversaciones**
   (pedida por Alex, acordada, no arrancada — prompt de research ya lo tiene pegado en el handoff de arriba).
5. **Legacy** (fase R6): rename Afiliados→Colaboradores; tipado `Database` completo; quitar
   `?secret=` del webhook de onboarding.

El núcleo de dinero/comisiones está saneado (P1 de la auditoría FASE A cerrados + barrido de
escrituras sin comprobar error en #251/#252). Lo que queda es sobre todo credenciales/decisiones de
Alex, no código bloqueado.

## ✅ RESULTADO (27-sep, noche): taste lote 4 — REQ-UX-05 completo (PR #255)

Rama `feat/r4-ux-lote-4` (squash `2183bc2` sobre `origin/main` `930d219`, rama eliminada). Los ~14 modales
con overlay casero que quedaban tras el lote 3 pasan a `components/ui/dialog` (Radix): campanas ×3,
marketing/contenido ×2 (nueva pieza + tarjeta de detalle, título editable intacto), setting-ai ×3 (las
funciones `Modal`/`ModalHead` ahora envuelven Radix conservando los tamaños big/normal), instagram ×2,
instagram/competencia ×2, gastos ×2, subcuentas ×1 (confirmación de archivado: Radix aporta el
`aria-modal`/foco que el `role="dialog"` manual emulaba) y agendas ×1. `MetaFunnelAssigner` y `ScriptQueue`
(lote 3) entran en el invariante. Foco atrapado, Esc, click-fuera y X accesible gratis; −946 líneas de
boilerplate. **Intencionales preservados:** el click-catcher `z-30` del dropdown de columnas (contenido),
los overlays no-modales de `ContactsAllView` (z-10, dropdown) y los hexes de email/`#0866FF`/recharts del
lote 3.

**Validado:** `npm run quality` completo en local (format:check, lint, typecheck, `npm test` 1027/0/3 skips
sin credenciales, `test:metrics` 752/0) y build local ✓; CI del SHA final `6581eb5` (run `36344012044`):
Quality 1m14s, Build 2m54s, gitleaks y **Smoke E2E 5m18s en verde**. `tests/taste-public-pages.test.mjs`
ahora 9 invariantes (nuevo: nada de overlays `fixed inset-0 z-50` ni `bg-black/60` a mano en los 10
ficheros del lote 4). **Nota CI:** el E2E se canceló dos veces por la concurrency GLOBAL `e2e-tenant-qa`
compartida con la rama docs paralela de Claude Code (`docs/relevo-27sep-ramas-obsoletas-y-que-falta`,
hoy PR #257, CI success); re-lanzado con 2 commits vacíos documentados (`7015f15`, `6581eb5`) hasta que
su run terminó. Los specs E2E que usan `getByRole('dialog')` siguen
válidos: Radix emite ese rol. **No verificado:** navegación de dashboards autenticados (falta
`E2E_PASSWORD`, igual que lotes 1-3).

## ✅ RESULTADO (27-sep, noche): PRs #251-#254 — barrido de dinero, fixes de Instagram y arranque de Conversaciones (Claude Code)

Sesión completa: 4 PRs mergeadas en `main`, producción verificada sirviendo el HEAD tras liberar un
build zombi que bloqueaba la cola. Quality Gate en `main` tras el último merge: typecheck 0, lint sin
errores nuevos, `npm test` 1023 pass / 0 fail / 3 skips (falta de credenciales Supabase en vivo).

- **PR #251 y #252 — continúa el barrido de "~92 escrituras sin comprobar `{ error }`"** (criterio
  fijado en §Seguridad más abajo): `webhooks/calendly` (UPDATE de estado de cita en cancelación/
  reprogramación ahora responde 500 en vez de silencio, Calendly reintenta la entrega) y
  `api/track/[site]` (log del error real sin cambiar el comportamiento ya correcto) en #251;
  `sales/update` (sync de depósito en ventas "reserva" — hueco real, se desincronizaba en silencio),
  `collections/[id]` (estado de cuota tras editar/borrar un cobro), `payments/mark` (dos ramas de
  idempotencia devolvían `ok:true` aunque la escritura fallara) y `stripe-backfill/registrar`
  (rollback de venta huérfana sin comprobar) en #252. `audit_logs.insert` secundarios en varios
  endpoints ahora se loguean si fallan en vez de perderse.
- **PR #253 — Instagram, dos bugs reportados por Alex con el mismo síntoma:**
  1. _Conversaciones no cargaban_ ("Instagram tardó demasiado en responder"): el reintento con
     página más pequeña en `fetchIgConversationsWithMessages` nunca se ejecutaba porque el timeout
     de cada llamada (`IG_TIMEOUT_MS`=15s) era MAYOR que el presupuesto total para reintentar (12s)
     — cuando el primer intento expiraba, el presupuesto ya estaba agotado. Fix: `graphGet`/
     `graphGetAll` aceptan timeout explícito; el primer intento del listado usa uno más corto (7s)
     que deja margen real para el reintento.
  2. _Panel de Integraciones mentía_: `lib/ops/sync-health.ts` declaraba `instagram` con
     `scheduler:'vercel'`, así que comprobaba si `cron/instagram` estaba en `vercel.json` — pero ese
     cron se movió a GitHub Actions (`cron-instagram.yml`, diario 02:30 UTC) cuando se sacó de Vercel
     por el límite de 2 crons del plan Hobby. El panel decía "nadie la ejecuta" aunque SÍ corre a
     diario. Cambiado a `scheduler:'manual'` con `manualReason`, mismo patrón ya usado para
     `stripe-payments`/`calendly-citas` en el mismo fichero.
- **PR #254 — primera fase del panel de métricas de Conversaciones** (pedido explícito de Alex:
  "esta sección debería llamarse Conversaciones... panel de métricas e insights... saber cuál
  [plataforma] genera más leads, agendas"). Alcance acordado antes de codificar (3 preguntas al
  usuario): solo Instagram por ahora (Facebook/TikTok sin integración de mensajería, sin
  credenciales ni cliente API — quedan "próximamente" en el mismo panel); cruce con datos reales
  cuando sea posible, fallback a la propia conversación cuando no. Implementado:
  `lib/instagram/conversation-metrics.ts` (función pura, 6 tests) cruza el username del participante
  con `contacts.instagram` (normalizado) y, si encaja, comprueba cita/venta REAL en BD — nunca
  `false` sin evidencia (queda `null`, no determinable), nunca cuenta un enlace de Calendly en el
  texto como agenda confirmada (se expone aparte, `enlaceAgendaEnTexto`). Endpoint
  `/setting-ai/conversations/metrics` reutiliza el snapshot ya guardado (no duplica llamadas a la
  Graph API). Panel de 3 tarjetas en `ConversacionesTab` siempre visible.
  **Pendiente (fase 2, acordada con Alex, no arrancada):** motor VoC (Voice of Customer mining) sobre
  estas conversaciones para pains/hooks/objeciones/clusters — Alex pegó un prompt de research
  completo para esto; primero como informe puntual sobre datos reales, después como feature.
- **Build zombi de Vercel, otra vez:** el deploy de producción de #253 (`b1e9151`) se quedó colgado
  ~43 min sin nuevas líneas de log tras el paso de lint, bloqueando en cola el deploy de #254. Mismo
  patrón que los builds de `out_of_memory`/timeout vistos antes hoy — cancelado con
  `mcp__Vercel__cancel_deployment` (autorización explícita de Alex de sesiones anteriores:
  "solucionalo por api... como sea"), lo que liberó la cola. **Sigue sin fix estructural — solo
  mitigación reactiva cada vez que aparece.** Si vuelve a repetirse con frecuencia, vale la pena abrir
  un ticket con soporte de Vercel (proyecto en Hobby, single build-concurrency slot).
- **Verificado en vivo:** `app.scalixsystems.com` (alias de producción) sirve `63d7062` (HEAD de
  `main` tras #254, `aliasError: null`). 2 builds de preview obsoletos de la propia rama ya mergeada
  cancelados (limpieza, no bloqueaban nada).
- **Siguiente paso natural:** fase 2 del VoC mining cuando Alex confirme, y seguir el barrido de
  escrituras sin comprobar error (quedan candidatos en `appointments/*`, `contracts/*`,
  `webhooks/onboarding`, `instagram/transcribe`, `lib/tenants/provision.ts`,
  `lib/contracts/team-contract.ts` — recuento exacto pendiente, identificados con escaneo estático +
  verificación manual archivo a archivo para descartar falsos positivos, mismo método que #251/#252).

## Assets hero comprimidos: −88% de bytes por visitante nuevo — 27-sep noche (Freebuff/Buffy)

**hero.mp4 5,28 MB → 806 KB** (re-encode H.264 1080p CRF 26, sin audio, +faststart; SSIM 0,9947
contra el original — visualmente idéntico, verificado con comparador lado a lado + zooms 2× en
`.freebuff/asset-compare.html`) y **hero-poster.png 1,42 MB → hero-poster.webp 17 KB** (q82).
Referencias actualizadas en `app/page.tsx` y `app/panel.css`; test del panel adaptado al WebP
(7/7 verde en arnés; build verde). Descarga por visitante nuevo: 6,70 MB → 0,82 MB (−88%);
página total a networkidle −26%. Bonus: el re-encode elimina los metadatos C2PA (procedencia IA)
que pesaban dentro del mp4 original. **Asset muerto detectado: `public/brand/iawinners-logo.png`
(1,47 MB) no tiene NI UNA referencia en el código — borrado el 28-sep, commit `05e05d1`, con ok de
Alex (producción lo servía públicamente; su URL pasará a 404 al desplegar).** Pendiente de decidir (Fase 2, no ejecutada): mover el vídeo a Bunny Stream (ya
conectada) si el tráfico de la landing crece; a escala actual no ahorra dinero (Vercel Hobby
gratis, 100 GB/mes) y la compresión ya resuelve el problema.
**→ Verificado en producción el 28-sep** (deployment `dpl_5EodtVe7`, commit `f18e336`): hero.mp4
806 KB 200, poster WebP 17 KB 200 con etags = MD5 del repo, PNG 404, home 200 solo con refs
nuevas. Detalle arriba.

## ✅ RESULTADO (27-sep): taste lote 3 — deuda UX R4 (REQ-UX-02/03/05) + revisión visual (PR #250)

Rama `feat/r4-ux-lote-3` (commits `be8e8a8` + merge `f81e410` sobre `origin/main` `2d8e18c`). Quality Gate local
del árbol fusionado en verde: format:check, lint, typecheck, `npm test` (1015/0), `test:metrics` (752/0) y build.
La integración con `origin/main` resolvió el solape con el PR upstream #249 («unificación de formato/color»),
que tocaba 14 de los mismos ficheros: se combinaron ambas intenciones (mis tokens zinc/`text-3xs`+`text-2xs` y
sus `formatDateTime`; en Sidebar prevaleció la conversión zinc del lote sobre la equivalente a tokens semánticos).

- **REQ-UX-02:** Sidebar sin hexes → zinc con paridad exacta (7 conversiones); layout del shell con
  `AlertTriangle` (lucide) en lugar de 2 SVG dibujados a mano; `VslDashboard` `text-[#e2e8f0]` → `text-zinc-200`.
  Intencionales preservados y documentados: hexes del HTML de email, `#0866FF` (marca Meta), fills de
  data-viz recharts, `#22c55e`/BLUE de VslDashboard y fallback de color de proveedor de integraciones.
- **REQ-UX-03:** tokens `text-3xs` (10px) y `text-2xs` (11px) en `tailwind.config.ts` con paridad exacta
  (solo font-size); barrido mecánico de `text-[10px]`/`text-[11px]`: 256 sustituciones en 81 ficheros, 0 restantes.
- **REQ-UX-05:** triage de los 14 overlays caseros — todos son modales reales (falso positivo descartado:
  click-catcher de columnas en `marketing/contenido`). Migrados a `components/ui/dialog` (Radix): 6 modales
  en `tasks` (2), `csm-events`, `contratos`, `drops`, `biblioteca`. El resto queda en backlog R4 por volumen.
- **Revisión visual:** el preview gestionado se re-apuntó temporalmente al build de producción del worktree
  (restaurado después a su config original). Verificado por SSR/HTTP sobre home, `/ver-como/entrar`,
  `/firmar/*`, login y gates de dashboard: 200s, cero `neutral-*`, cero hexes en clase, cero
  `text-[1[01]px]`; tokens compilados comprobados en el CSS del build (`.text-3xs{font-size:10px}`,
  `.text-2xs{font-size:11px}`), zinc del shell incluido. Playwright headless fue imposible en sandbox
  (Chromium sin librerías de sistema; no se instalan paquetes fuera del proyecto sin permiso).
- **Test:** `tests/taste-public-pages.test.mjs` ampliado a 8 invariantes (shell zinc sin hexes ni SVG a
  mano, tokens en config con barrido global, modales migrados sin overlays caseros).
- **No verificado:** navegación de dashboards autenticados (sandbox sin credenciales de sesión), igual que
  en los lotes 1-2. **Nota CI:** el run de la PR fue cancelado externamente (~14:41, sin push propio; la
  concurrency group es por ref) — se re-lanza con el push de este commit de documentación.

## 🔎 CONSOLIDADO (27-sep, tarde): revisión total del proyecto y del handoff (Freebuff/Buffy)

Auditoría de coordinación sin cambios de código: `origin/main`, ramas remotas, PRs abiertas, crons,
worktrees y tablero, cruzados con el relevo de Claude Code de más abajo.

- **Estado de `main`:** `4a4ea62` (#251, webhook Calendly/pixel) con CI success por SHA. Fusionados y
  verificados hoy: #244, #245, #249, #251 y los tres lotes de taste (#247/#248/#250).
- **PRs abiertas a cierre:** #225 (`feat/money-25sep`, del usuario, con decisión pendiente propia) y 5
  de Dependabot (#227-230, #235). Según el relevo de Claude Code, los majors ya están investigados en
  las chores `recharts-3`, `eslint-9-config-next-16` y `tailwind-4` (artefacto real verificado, falta
  vistazo visual en preview); #229 (ESLint 10) crashea de verdad con `eslint-config-next@16` — cerrar
  las de Dependabot como superseded al mergear las chores.
- **Las 12 ramas de Claude Code siguen sin PR.** 4 de sus piezas ya entraron en `main` por otra vía:
  `PATCH reversed/disputed` (#244), `approve-review recuperable` (#245) y 2/3 del port de #225 dentro
  de #249 (filtro de cuentas ads + nuevo-vs-recurrente canónico). Quedan íntegras por contenido
  (verificado contra el código de `main`): `fix/disputed-no-es-cash` (sin tratamiento de `disputed` en
  `lib/sales/plan-cuotas.ts`), `fix/ai-agent-historial-orden` (`ascending: true` sigue en
  `lib/ai/agent/tools.ts`), `fix/ai-tools-lectura-fallida-no-es-cero`, `fix/collections-patch-sync-cuota`,
  `docs/a3-alertas-deprioritizadas` y las 3 chores de majors. **La rama
  `docs/relevo-sesion-27sep-r4-y-ramas-pendientes` (`6b09094`) es REDUNDANTE: su contenido completo ya
  está en `main` (secciones «CONCURRENCIA» y «RELEVO») y le falta el lote 3 — no fusionarla, procede
  cerrarla.** Su inventario de UX R4 (REQ-UX-02/03/05) quedó resuelto por #250: leer ese bloque antes
  de re-ejecutar su plan.
- **Checkout raíz (`fix/money-path-silent-writes`, carril de Claude Code):** 2 commits locales sin push
  (`6160dc3` baseline de gates + `9453e67` formato del relevo) y WIP sin commitear en este mismo
  handoff (+176 líneas del informe FASE A). Intacto a propósito — pendiente de su agente: commitear y
  pushear o descartar.
- **Crons GHA:** `stripe-payments` success; `sequra-morosos` FAILURE recurrente (último 14:38Z) por
  `{"error":"Falta configurar SEQURA_MERCHANT_REFERENCE"}` — mismo bloqueo de usuario ya registrado en
  USER ACTION REQUIRED. El resto de crons sin cambios.
- **Carril producto (Freebuff):** lote 3 cerró REQ-UX-02/03 y REQ-UX-05 parcial (8 modales restantes,
  lista en el bloque ✅ del lote 3) + revisión visual de dashboards autenticados pendiente de sesión
  real (bloqueo de credenciales de los lotes 1-3).
- **Tablero:** las 2 filas activas refieren lo mismo (migración `20260922100000` en producción,
  encargo P1 a Claude Code del 25-sep) — siguen vigentes hasta que se aplique.

## Sentry activo + crons reanimados + rotación de secretos — 27-sep (Freebuff/Buffy)

**Sentry (javascript-nextjs, org scalix-52):** DSN obtenido vía MCP (`find_dsns`) y subido como
`NEXT_PUBLIC_SENTRY_DSN` (Production+Preview) → redeploy → **DSN horneado verificado en el chunk
`main-app-*.js` de app.scalixsystems.com** (y el ref de Supabase sigue horneado en el suyo). En
Sentry solo hay 1 issue (JAVASCRIPT-NEXTJS-1), el evento de prueba del proyecto; la app aún no ha
enviado errores reales — el usuario dio la verificación end-to-end por suficiente. `SENTRY_ORG` /
`SENTRY_PROJECT` ya estaban. `SENTRY_AUTH_TOKEN` sigue sin existir: los builds suben source maps
solo si Alex lo añade (dryRun mientras tanto, ver next.config.js).

**Causa raíz del fallo de los crons desde el 26-sep (2 incidentes encadenados, ambos resueltos):**

1. Los 9 workflows de cron llamaban a `https://growth-ops-weld.vercel.app` — host borrado en la
   limpieza de Storage del 26-sep (404 desde entonces; solo quedan `growthops-preview-3003` y
   `go-prod` en el equipo). Fix: variable de repo **`CRON_APP_URL=https://app.scalixsystems.com`**
   (los workflows ya traían el override `vars.CRON_APP_URL || default`).

2. **Error propio del relevo del 26-sep, corregido:** al restaurar envs desde el `.env.local` del
   clon, `CRON_SECRET` y `TRACKING_INGEST_KEY` eran la máscara `[ SENSITIVE ] ` que `vercel env
pull` escribe para variables _sensitive_ — quedaron guardadas literalmente y todo cron daba 401
   (canario: workflow sequra-morosos → HTTP 401). Lección anotada en el código (`lib/vsl/db.ts`
   comprueba `=== '[SENSITIVE]'` exactamente por esto): **nunca poblar envs de Vercel desde un
   `.env.local` descargado con el CLI**. Rotación: nuevo valor en Vercel (delete+post: las envs
   _sensitive_ no aceptan PATCH de tipo) y **el mismo valor en `gh secret set CRON_SECRET`**.
   `TRACKING_INGEST_KEY` rota también en Vercel (nada externo lo consumía: la ingesta legacy
   acepta la clave de la config en BD).

**Paridad Fase 1.1 aplicada (Vercel, Production+Preview salvo que se diga):** restaurado `preview`
en las 8 envs del incidente (lo habían perdido); creadas `NEXT_PUBLIC_SITE_URL=https://
app.scalixsystems.com` (antes los emails/embeds caían a `http://localhost:3000`) y
`CONFIG_ENC_KEY` nueva (production). **Credenciales cifradas en `integration_settings` (`enc:v1:`) indescifrables sin la clave vieja**
(desde el 26-sep no había ninguna `CONFIG_ENC_KEY`). **Ya regrabadas (27-sep tarde) y verificadas
en vivo:** `META_ACCESS_TOKEN` → dispatch de `cron-meta-daily` con HTTP 200, run `ok` en
`integration_sync_runs` y 166 días sincronizados sin fallos (las subcuentas sin token se omiten
honestamente); también `APIFY_API_TOKEN` e `INSTAGRAM_ACCESS_TOKEN`. **Pendientes de regrabar
(12):** `STRIPE_SECRET_KEY` (la crítica: espejo de pagos), `GHL_API_TOKEN`, `GHL_WEBHOOK_SECRET`,
`CALENDLY_API_TOKEN`, `CALENDLY_WEBHOOK_SECRET`, `META_APP_SECRET`, `RESEND_API_KEY`,
`YOUTUBE_CLIENT_SECRET`, `DEEPSEEK_API_KEY`, `GROQ_API_KEY`, `FATHOM_API_KEY`,
`BUNNY_STREAM_API_KEY` — desde Integraciones con el valor del gestor de contraseñas (la única
copia restante murió con los envs del 26-sep). Fail-closed mientras tanto: error controlado, no
ceros silenciosos. Sin valores
reales disponibles (no subir máscaras): `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `POSTGRES_*`,
`SUPABASE_URL`/`SUPABASE_SECRET_KEY`, `SEQURA_MERCHANT_REFERENCE`, `SENTRY_AUTH_TOKEN` —
pedirlas a Alex / dashboard Supabase.

**Fase 1 de optimización Vercel ejecutada (27-sep tarde, con ok explícito de Alex):** borrado el
proyecto huérfano `go-prod` (creado 19-sep, 0 deployments en toda su vida, sin git, solo su dominio
automático — verificado vacío en el mismo comando del DELETE) y purgados los 32 deployments
muertos de `growthops-preview-3003` (28 CANCELED + 4 ERROR, 32/32 borrados, guard de ningún READY).
Quedan los 72 READY (casi todo de ayer/hoy). **Política de retención a partir de ahora:** los
CANCELED/ERROR se pueden purgar sin preguntar; los READY de producción viejos (>14 días) y los
previews de PRs ya cerradas son candidatos a purga; nunca borrar el deployment con el dominio
asignado (comprobar alias antes). Verificado tras la limpieza: dominio 200, deployment que sirve
intacto, solo queda 1 proyecto en el equipo.

**Crons verificados en vivo (27-sep 14:40 UTC, tras el build de las 13:36 que ya horneó las envs
nuevas):** `cron-stripe-payments` → **HTTP 200** `{ok:true}` con informe por subcuenta (omitidas
honestamente: "Stripe no está configurado en esta subcuenta" — las credenciales cifradas son
indescifrables hasta regrabarlas); `cron-sequra-morosos` → ya no 401, sino **HTTP 500** con
`{"error":"Falta configurar SEQURA_MERCHANT_REFERENCE"}` (fallo ruidoso esperado; credencial de
negocio pendiente de Alex). El resto de crons usan la misma cadena CRON_APP_URL + CRON_SECRET.
Verificado también: el deployment vigente es el build de GitHub de `2d8e18c` (READY/PROMOTED,
alias en app.scalixsystems.com) y el DSN de Sentry sigue horneado en su chunk.

## INCIDENTE PRODUCCIÓN RESUELTO — app.scalixsystems.com caída por envs borradas de Vercel — 26-sep (Freebuff/Buffy)

**Síntoma:** tras borrar Alex un deployment bloqueado por Function Storage (10 GB), el dominio servía
HTML pero toda ruta caía en el `global-error` ("No se ha podido abrir la aplicación").

**Causa raíz:** el proyecto Vercel `growthops-preview-3003` quedó **sin NI UNA variable de entorno**
(los borrados en masa del storage las eliminaron). Los builds desde GitHub se hacen sin `.env`
local, así que el cliente de Supabase (`lib/supabase/client.ts`) se construía con `undefined` y
lanzaba `supabaseUrl is required` al hidratar en cada ruta. El SSR no tocaba ese módulo: por eso el
HTML llegaba bien y el crash era solo cliente. El último deployment funcional (aliasado desde 33
min antes) ya estaba roto: la app llevaba caída desde el build de GitHub de esa tarde.

**Cierre (verificado en navegador):** 8 variables restauradas en Production+Preview vía API Vercel
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `CRON_SECRET`, `TRACKING_INGEST_KEY`;
valores del `.env.local` del clon `/tmp/growthops-preview-3003` tras verificar que sus
package-lock coincidían byte a byte con HEAD). Dos redeploys: el primero horneó la URL pero la anon
key aún no estaba (CLI de Vercel traga el valor de `NEXT_PUBLIC_*` en un prompt interactivo — usar
la API REST v10 para esas); el segundo (`s9rlinuu0`) dejó URL + anon key horneadas en el bundle,
sin refs runtime restantes, y el login y la raíz renderizan. **Ojo:** si un build limpio de GitHub
vuelve a salir roto, revisar primero que las envs siguen ahí.

**Pendiente del incidente:** falta de paridad un puñado de variables runtime de servidor
(GEMINI_API_KEY, ADMIN_SESSION_SECRET, CC_SESSION_SECRET, CONFIG_ENC_KEY, GHL_WEBHOOK_SECRET,
APIFY_API_TOKEN/APIFY_WEBHOOK_SECRET, POSTGRES_*, SUPABASE_URL/SUPABASE_SECRET_KEY y otras que
enumera `.env.local.example`) — la app funciona con lo crítico, pero los flujos que las lean
devolverán undefined. Completarlas en Vercel es la Fase 1.1 del encargo de optimización.

## Buffy (Freebuff) — merge de origin/main + PR #224 + auditoría de dashboards — 25-sep

**Hecho (pedido de Alex: fusionar PR #224 con merge commit, borrar rama remota, actualizar main local).**

- **PR #224 fusionada** con merge commit `c60f7cb` (checks todos en verde: Build, Quality, gitleaks, Smoke E2E, Vercel). Rama remota `feat/e2e-seed-canonica` **eliminada** (verificado con `ls-remote`: 0 refs).
- **`main` local actualizado a `origin/main`** con merge commit propio `c4bfb9a` (resuelve la serie local sin pushear con 30 commits upstream). Conflictos resueltos: `pays_commissions` por la implementación canónica upstream (`usuariosSinComision`), conservando el **desglose nuevo-vs-recurrente** local en `commissions/future` y el listado de exentos con importe 0 (contrato de la UI). `tests/commissions-exencion.test.mjs` eliminado a petición de Alex (probaba la implementación descartada). **HUECO ABIERTO: upstream no tiene tests de `pays_commissions`; añadir cobertura sobre `usuariosSinComision`.** Validado: tsc 0, prettier CI OK, 948 unit + 752 metrics pass / 0 fail (sobre el árbol del merge, en clon aislado).
- **NO pusheado** (no se pidió): `main` local va 10 commits por delante de `origin/main`; pushear es el siguiente paso natural cuando toque.
- **Auditoría de dashboards/métricas** (encargo previo de Alex, siguiendo su brief de 58 puntos): entregables en `docs/DASHBOARD_AUDIT.md` (matriz + scorecards) y `docs/DASHBOARD_CORRECTION_PLAN.md` (P1→P4). Hallazgo principal **P1**: cash dividido — `collections` congelada desde 19-sep vs espejo `stripe_payments` completo; la capa canónica `lib/canonical/cash.ts` solo la consume unit-economics → Dashboard/Embudo/Ranking/Resumen/P&L subcuentan septiembre. Fix commiteado en local como `45f7710` (25-sep tarde; Quality Gate completo + build en verde, validados en arnés aislado `/tmp/qa-gate` por la degradación EPERM del sandbox — el repo sigue sin poder ejecutar node en su cwd): cohortes «Clientes» = contactos únicos (`lib/finance/cohortes.ts` + `tests/cohortes.test.mjs`, 5/5, adaptado al predicado `cuentaComoVenta` post-#221) y `tenant_id` en los 2 inserts de gastos (bug 23502 verificado en preview). Sigue sin pushear: `main` local va 11 commits por delante de `origin/main`. Respaldo completo del estado pre-merge en rama `backup-pre-merge-20260925` (`e784fbe`), borrar cuando se confirme.
- **USER ACTION**: decidir P1-1 del plan (consumir `canonicalCash` en las pantallas) ANTES de leer números de septiembre; marcado `result`/`offered` en Agenda sigue a 4/610 y 3/610 (NOT_TRACKED, no bug).

## Relevo 25-sep — hebra Freebuff 194f9eda (preview 3003)

## ✅ RESULTADO (27-sep): taste lote 2 — /ver-como a zinc y veredicto audit de marketing (PR #248)

Fusionada en `main` (`31d18da`), quality/gitleaks/build/Smoke E2E de la PR en verde (quality 1m45s,
build 2m49s, Smoke E2E 4m59s). La petición fue «/ver-como y pantallas de marketing": audit-first de
las 8 pantallas de `marketing/**` (~5.100 líneas) + `/ver-como/entrar` + banner/shim de ver-como.

- **Veredicto «preservar» en marketing (decisión documentada, no omisión):** el esmeralda que
  aparece es la convención de la casa para datos positivos/dinero (dashboard, finanzas y métricas lo
  usan igual) y rotación deliberada de color en data-viz; los `uppercase tracking` son labels de
  formulario y cabeceras de tabla funcionales, no eyebrows decorativos; cero emojis; las flechas de
  CTA son el idioma de la casa (misma gramática que la landing). Reescribirlo rompería el vocabulario
  visual de la app (redesign-preserve, §11).
- **Banner «Ver como»:** ámbar como señal coherente de sesión de suplantación (color de estado, no
  acento de página) — preservado.
- **Fix real: `/ver-como/entrar`** — era la ÚNICA página de la app en la familia `neutral-*` (§4.2:
  una paleta de grises); alineada a `zinc-*` y con anillo de foco visible en el botón Volver. La
  página usa botón nativo (fuera del shell de shadcn), por eso le faltaba.
- **`global-error.tsx` auditado:** limpio (zinc-950, un acento, foco visible, copy español).
- **Test:** `tests/taste-public-pages.test.mjs` ampliado a 5 invariantes (nuevo: ver-como en zinc,
  foco visible y cero `neutral-` en `app/`).
- **Verificado:** suite focal 5/5 · quality local completo (979 unit / 0 fail / 3 skips
  preexistentes, 740 métricas) · CI de la PR verde. **Nota operativa:** el status de Vercel de la PR
  se quedó congelado en "pending" ~20 min (sin updated_at); se fusionó con los 4 jobs de CI reales
  en verde y el mismo árbol construido por el job Build (2m49s) — status de la integración, no del
  código. **No verificado:** review visual con navegador (sandbox sin sesión).

## ✅ RESULTADO (27-sep): pase de la skill taste a las superficies públicas (PR #247)

Fusionada en `main` (`8cc6966`), CI de la PR en verde (quality 1m48s, gitleaks 6s, build 2m57s,
Smoke E2E 4m43s, Vercel) y rama borrada. Petición de Alex: «todo ajustado con /taste?» — aplicación
explícita de la skill `design-taste-frontend` (#241) con Design Read y audit-first (§0/§11):

- **Audit primero:** la landing `/` ya es intencional (terminal cinematográfico, 0 eyebrows, un
  acento por tarjeta, foco visible, reduced-motion) y NO se tocó. Los dashboards de datos siguen
  fuera de la skill (§12) y los 7 ficheros de hex de REQ-UX-02 quedan en su fila (Claude Code).
- **Login:** el monograma era una `S` fija — la inicial de OTRA marca — en el login de todas las
  subcuentas; ahora se deriva de `resolveTenantBranding` (inicial real, aria-hidden).
- **`/firmar`:** la página interactiva era zinc-900 pero el checkbox de consentimiento usaba
  `accent-emerald-600` (dos sistemas de acento en una página); ahora `accent-zinc-900`, el
  esmeralda queda solo en el estado firmado. El check de texto pasa a `CheckCircle2` (lucide).
- **`/firmar-alumno`:** emoji de celebración (§3.D) → `CheckCircle2`, misma gramática de éxito que
  registro de colaborador y recover; copy «¡Ya eres un Winner!»/«la Academia» (vocabulario de una
  subcuenta concreta) → neutro.
- **Foco de teclado:** verificado en las 5 pantallas — shadcn `Input`/`Button` ya traen
  `focus-visible:ring-brand-500`; sin cambios necesarios.
- **Test:** `tests/taste-public-pages.test.mjs` (4 invariantes estáticos, patrón webhook-ghl).
- **Verificado:** suite focal 4/4 · quality local completo (978 unit / 0 fail / 3 skips
  preexistentes, 740 métricas) · CI de la PR verde · rama borrada. **No verificado:** review visual
  con navegador (sandbox sin sesión).
- **Pendiente de taste para un próximo lote:** `/ver-como`, pantallas de marketing y el resto del
  inventario R4 de Claude Code (tokens/tipografía/modales), que exige navegador.

## ✅ RESULTADO (27-sep): Paridad VSL II — carga, customización, thumbnails y métricas (PR #246)

Fusionada en `main` (`405821f`), CI en verde tras re-disparo (quality 1m32s, build 2m42s, Smoke E2E
5m18s; el primer run salió CANCELADO por la cola e2e-tenant-qa, no es fallo). Segunda pasada de la
petición de Alex — lo más importante de Wistia/PandaVideo/Vidalytics, todo SIN migración:

- **Velocidad de carga**: HLS fast-start (`startLevel 0`, ABR conservador) para el primer frame ya,
  y preload selectivo (auto solo con autoplay). Se suma al preconnect/preload del embed existente.
- **Customización**: botón play central y pantalla completa configurables por vídeo (por defecto
  visibles). Con #241: colores, barra, autoplay, lockSeek, fakeProgress, loop, prueba social,
  exit hook y CTA programado.
- **Thumbnails dinámicos**: `derivadosDeSource()` (en `lib/vsl/types.ts`, módulo puro, porque
  `bunny.ts` arrastra `node:crypto` y lo importa el dashboard en cliente) deriva thumbnail.jpg,
  preview.webp animado y storyboard.vtt de la URL de Bunny sin API ni migración; las tarjetas del
  dashboard muestran miniatura + preview animado al hover (lazy).
- **Métricas conectadas**: nuevo `/vsl/resumen` (KPIs agregados de la subcuenta, mismos criterios
  que las métricas por vídeo, `requirePantalla`, filtro tenant en todas las subconsultas) pintado
  como fila superior de KPIs del dashboard de VSL.
- **Verificado:** suite focal 11/11 (el test importa la función pura real vía alias-loader) ·
  quality completo (971 unit / 0 fail / 3 skips, 740 métricas) · CI verde · rama borrada. **No
  verificado:** review visual con navegador (sandbox sin sesión).
- **Anotado:** scrub con thumbnails en el player (storyboard ya derivado) y `cta_clicks` requieren
  migración/decisión; pendientes del próximo lote.

## ⚠️ CONCURRENCIA (27-sep, tarde): Codebuff corriendo la skill "taste" — no tocar UI sin comprobar antes

Alex tiene a **Codebuff ejecutando la skill `taste`** en paralelo a esta sesión. Esa skill es de
diseño/UX visual — el mismo terreno que el bloque de "R4 pendiente" de más abajo. **Antes de tocar
cualquier fichero de `app/**/page.tsx` o `components/ui/*` por temas de tokens de color, tipografía
o modales, comprueba primero**:

1. `git log --all --oneline -20` y `git branch -r` — si ya existe una rama de Codebuff sobre estos
   mismos ficheros, no la pises: extrae lo útil, no la sobrescribas (regla de siempre: DIFF →
   UNDERSTAND → CLASSIFY → PORT, nunca merge a ciegas).
2. Esta sección del tablero (más abajo) — si Codebuff ha reclamado fila, respétala.
3. Si no hay rastro de Codebuff en git pero Alex dice que sigue corriendo, es probable que su
   resultado llegue como PR o rama nueva DESPUÉS de que leas esto: vuelve a mirar `git branch -r`
   justo antes de empezar a escribir código, no solo al principio de la sesión.

## 📋 RELEVO (27-sep, tarde): 12 ramas de Claude Code sin PR + inventario detallado de UX R4

**Contexto:** sesión completa de Claude Code (torre.alex97) trabajando sobre el informe de auditoría
FASE A (26-sep) + puesta al día de Dependabot + arranque de UX R4. Nada de esto se ha mergeado
todavía (salvo lo que ya diga "✅ RESULTADO" más abajo) — son 12 ramas remotas, cada una con su
propio quality gate local en verde, esperando revisión/PR. Alex prefirió revisar antes de abrir PRs.

**Ramas pendientes de PR** (todas verificadas: format+lint+typecheck+tests+build en verde en su día;
re-verificar contra `main` actual antes de abrir PR, puede haber avanzado):

**Hallazgos P1 del informe FASE A (dinero/seguridad), cierran el hilo abierto en la sección de
arriba de PR-R2.2b:**

- `fix/disputed-no-es-cash` — `disputed` dejaba de tratarse como cash confirmado en
  `lib/sales/plan-cuotas.ts`, `payments/mark` y la ficha de venta (`ventas/registro/[id]`, donde
  además inflaba el importe prellenado de una devolución). Docs/MONEY.md D5.
- `fix/collections-patch-sync-cuota` — `PATCH` de `collections/[id]` con status `reversed`/`disputed`
  no llamaba a `syncInstallmentStatus` (solo lo hacía `DELETE`): la cuota quedaba `collected` para
  siempre, bloqueada para recobrarse.
- `fix/collections-approve-review-recuperable` — `approve-review` limpiaba el flag de revisión
  ANTES de garantizar la comisión; si `generateCommissionsForCollection` fallaba después, el cobro
  quedaba aprobado sin comisión y sin poder reintentar (el propio guard respondía 400). Ahora lee la
  venta primero, verifica errores, y revierte el flag si la generación falla.
- `fix/ai-tools-lectura-fallida-no-es-cero` — `getSales`/`getBusinessOverview`/`getFunnel` (tools del
  agente IA) y `detectAnomalies` presentaban un fallo de lectura como "0 ventas"/"ROAS cayó". Ahora
  devuelven `error` explícito y `detectAnomalies` se salta la comparación en vez de inventar una
  anomalía sobre un cero fabricado.

**Otros, fuera del informe FASE A pero de la misma sesión:**

- `fix/ai-agent-historial-orden` — el historial del agente mandaba los MAX_HISTORY mensajes más
  ANTIGUOS de la conversación (bug de `order(ascending:true) + limit`), no los recientes.
- `feat/port-pr225-ads-filter-nuevo-recurrente` — port manual (no rebase) de 2 de las 3 piezas de tu
  PR #225 (`feat/money-25sep`, todavía abierta, tuya): filtro de cuentas ads en `consultarMetricas`
  (agente/brief) + nuevo-vs-recurrente canónico cableado en comisiones futuras. **Queda 1/2**: el
  gráfico dual facturación-vs-cash de unit-economics (más abajo, sección propia).
- `docs/a3-alertas-deprioritizadas` — solo documentación: registra que las 5 alertas A3 (impago,
  vencimiento, lead sin contactar, no-show, onboarding/engagement) están DEPRIORIZADAS por decisión
  de Alex (no bloqueadas por canal), con el criterio para cuando se retomen (detección separada del
  envío). Sin riesgo, se puede mergear sola en cualquier momento.

**Dependabot majors — investigados de verdad (peer deps + build real), no aceptados a ciegas. Las 5
PRs de Dependabot (#227-230, #235) deberían cerrarse como CLOSED/superseded una vez esto se mergee:**

- `chore/recharts-3-major` — recharts 2.12.7→3.10.1. Sin conflicto de peer deps. Único cambio real:
  tipo de `labelFormatter` en `app/[tenant]/instagram/page.tsx` (`ReactNode` en vez de
  `string | null`). Build limpio en los 9 ficheros que usan recharts.
- `chore/eslint-9-config-next-16` — eslint 8→**9** (NO 10) + `eslint-config-next` 15→16, migrado a
  flat config (`eslint.config.mjs`, sustituye `.eslintrc.json`). **ESLint 10 crashea de verdad**:
  `eslint-plugin-react@7.37.5` (dependencia de `eslint-config-next@16`) llama a una API de contexto
  de regla que ESLint 10 quitó (`getFilename is not a function`) — verificado ejecutando `next lint`
  real, no en documentación. ESLint 9 resuelve limpio. Las 4 reglas nuevas de
  "React Compiler readiness" de `eslint-plugin-react-hooks@7` (`set-state-in-effect`, `purity`,
  `immutability`, `incompatible-library`) se desactivan EXPLÍCITAMENTE en el config con el motivo
  escrito: penalizan `useEffect(() => fetchX(), [...])`, patrón válido de React 18 en 109 sitios de
  esta app — adoptarlas es decisión de arquitectura para cuando se migre a React 19, no algo que
  deba colar en un bump de linter. **Si algún día se migra a React 19**: revisar si esas 4 reglas
  deben reactivarse antes de reescribir esos 109 sitios.
- `chore/tailwind-4-major` — tailwindcss 3.4.1→4.3.3. `postcss.config.js` → `@tailwindcss/postcss`
  (autoprefixer desinstalado, ya lo hace Lightning CSS). `globals.css`: `@tailwind base/components/
utilities` → `@import 'tailwindcss'` + `@config '../tailwind.config.ts'`. Un error real de tipos:
  `darkMode: ['class']` (sintaxis v3) no tipa en v4 (`DarkModeStrategy` exige `'class'` a secas o el
  par `['class', selector]`) — cambiado a `darkMode: 'class'`, misma semántica (la app usa
  `classList.toggle('dark', ...)`). **Verificado en el CSS COMPILADO** (no solo que el build no
  reviente — el primer intento con `| tail` ocultó un fallo real por la trampa del exit-code de
  `tail`, ojo con eso si se repite el build en background): el sistema de color de marca por tenant
  (`hsl(var(--brand-NNN) / <alpha-value>)`, 114 líneas de tokens) resuelve igual, incluidos los
  modificadores de opacidad vía el `color-mix()` nuevo de v4; `tailwindcss-animate` (usado por
  dialog/alert-dialog/sheet/popover/select, TODA la capa de overlays) sigue generando
  `animate-in/out`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`.
- **Los tres de arriba comparten la misma advertencia**: verificado el artefacto real (CSS
  compilado / build / lint ejecutado), no solo que compile — pero **sigue pendiente un vistazo
  VISUAL en preview desplegado** antes de mergear a main. Esta sesión no tuvo navegador. Mínimo:
  dashboard, finanzas, comisiones, y abrir un modal/dropdown cualquiera (Dialog/Select/Popover) para
  confirmar que la animación de entrada/salida se ve.

**UX R4 — arrancado, 1 de 4 hecho:**

- `chore/ux04-formato-moneda-fuente-unica` — HECHO. Barrido completo de la app: solo había un
  duplicado real de `formatCurrency`/`Intl.NumberFormat` inline (`ColaboradorDashboard.tsx`), ahora
  reusa `formatNumber` de `@/lib/utils`. Los otros 2 sitios con `style: 'currency'` fuera de
  `lib/utils.ts` (`components/metrics/KpiCard.tsx`, `settings/integraciones/page.tsx`) YA reusaban
  correctamente el helper — no tocar, no son duplicados.

### UX R4 — lo que queda, inventariado con precisión para no redescubrirlo

**REQ-UX-02 (paleta duplicada → tokens) — 7 ficheros con hex hardcodeado en vez de los tokens de
marca (`bg-brand-*`, `hsl(var(--...))`), grep exacto para reproducir:**
`grep -rEo "#[0-9a-fA-F]{6}\b" --include="*.tsx" app/ components/ | grep -v "components/ui/"`
→ `components/os/Sidebar.tsx` (8), `components/settings/EmailTemplatesPanel.tsx` (3),
`components/vsl/VslDashboard.tsx` (2), `app/[tenant]/layout.tsx` (2),
`components/os/MetaAdsDashboard.tsx` (1), `app/[tenant]/settings/integraciones/page.tsx` (1),
`app/[tenant]/instagram/page.tsx` (1). Antes de tocar cada uno: comprobar si el hex es intencional
(p. ej. un color de marca de un proveedor externo como Instagram/Meta que no debe seguir el sistema
de tokens propio) o si debería ser un token — no convertir a ciegas.

**REQ-UX-03 (escala tipográfica, falta `text-2xs`) — mucho más grande de lo que sugería el registro:
80 ficheros, cientos de usos de `text-[10px]`/`text-[11px]` en vez de un token. Grep exacto:**
`grep -rc "text-\[1[0-1]px\]" --include="*.tsx" app/ components/ | grep -v ":0$"` (top 10 por
volumen: `setting-ai/page.tsx` 22, `marketing/contenido/page.tsx` 22, `ContactsAllView.tsx` 11,
`recursos/testimonios/page.tsx` 11, `instagram/reels/page.tsx` 11...). Plan sugerido, NO ejecutado:
(1) añadir `text-2xs` (probablemente `0.6875rem`/`11px`, a decidir con Alex si hay dos tamaños o
solo uno) a `tailwind.config.ts` → `theme.extend.fontSize`; (2) sustituir mecánicamente
`text-[10px]`/`text-[11px]` por el token nuevo, fichero a fichero, con verificación visual — es
demasiado volumen para un solo PR, dividir en varios.

**REQ-UX-05 (migrar 6+ modales caseros a `components/ui/dialog.tsx`) — 14 candidatos encontrados
(el registro decía "6+", hay más). Grep exacto:**
`grep -rl "fixed inset-0" --include="*.tsx" app/ components/ | grep -v "components/ui/" | xargs grep -L "from '@/components/ui/dialog'\|from '@/components/ui/sheet'\|from '@/components/ui/alert-dialog'"`
→ `tasks/page.tsx`, `recursos/biblioteca/page.tsx`, `settings/subcuentas/page.tsx`,
`setting-ai/page.tsx`, `marketing/contenido/page.tsx`, `marketing/adquisicion/campanas/page.tsx`,
`instagram/page.tsx`, `instagram/competencia/page.tsx`, `csm-events/page.tsx`, `contratos/page.tsx`,
`finanzas/gastos-facturas/gastos/page.tsx`, `drops/page.tsx`, `components/os/MetaFunnelAssigner.tsx`,
`components/os/ScriptQueue.tsx`. **`components/os/Sidebar.tsx` salió en el grep pero es
probablemente un falso positivo** (drawer de navegación móvil, no un modal) — triar antes de tocar.
Cada uno: confirmar que es de verdad un overlay modal (backdrop + cierre) antes de migrar, y probar
visualmente que el foco/cierre con Esc/click-fuera sigue funcionando tras migrar a Dialog (Radix ya
lo da gratis, pero hay que confirmarlo).

**Por qué esta sesión no llegó más lejos en R4**: REQ-UX-02/03/05 exigen criterio visual (qué es
intencional vs qué debería ser un token, cómo se ve el resultado) que no se puede verificar sin
navegador — esta sesión no tuvo uno. El siguiente agente con `browser-testing-with-devtools` o un
preview desplegado puede ejecutar el plan de arriba con mucha más confianza que intentarlo a ciegas.

**Nota (post-merge de esta misma actualización):** el PR #241 de abajo (skill taste + paridad VSL)
ya se fusionó MIENTRAS se escribía este relevo — confirma que el aviso de concurrencia de arriba
era necesario, no teórico. Comprobar `git branch -r` de nuevo antes de reclamar cualquier fichero de
UI: puede haber más trabajo de Codebuff en curso que este documento todavía no registre.

---

## ✅ RESULTADO (27-sep): skill taste instalada + paridad VSL (PR #241)

Fusionada en `main` (`fef2673`), CI en verde (quality 1m49s con dead-code, gitleaks 7s, build 2m14s,
Smoke E2E 3m39s). Petición de Alex: instalar la skill taste para el diseño y completar las
funcionalidades de Vidalytics/PandaVideo/Wistia que "se avanzaron" y no están (el trabajo "VSL V1/V2"
de una hebra perdida nunca llegó a main — confirmado por el registro de peticiones).

- **Skill taste**: `.codebuff/skills/design-taste-frontend/SKILL.md` (taste-skill v2 de
  Leonxlnx/taste-skill, MIT) + puntero de uso obligatorio en `AGENTS.md` (design read, dials,
  bans anti-slop, pre-flight check; respeta #2563EB y copy en español; no reescribe dashboards).
- **CTA programado con auto-pausa** en `VslPlayer` (el clásico de Vidalytics): aparece al cruzar
  un % configurable, pausa el vídeo opcionalmente, cerrable (ctaOnce), URL saneada (solo relativa
  o http(s)), evento 'cta' en el latido, accesible (role/aria/foco/contraste).
- **Hitos de visión 25/50/75/95/100** en métricas (paridad reporting Vidalytics/Wistia),
  derivados de `max_position` de `vsl_sessions` — SIN migración: la config nueva es JSONB
  fusionada por `mergeConfig` y los vídeos existentes quedan con CTA desactivado.
- **Dashboard**: tarjeta "Hitos de visión" + editor del CTA (texto/URL/%/pausa/cerrable).
- **% VSL directo del reproductor (WISHLIST 4/REQ-WISH-04): ya existía** — `syncContactWatchPct`
  copia el % exacto a `contacts.vsl_watch_pct` en cada latido; lo que faltaba era el reporting de
  hitos, añadido. El webhook `vsl.progress` de la landing sigue como vía complementaria.
- **Verificado:** suite focal 6/6 (`tests/vsl-cta-paridad.test.mjs`) · quality local completo
  (966 unit / 0 fail / 3 skips, 740 métricas) · CI verde · rama borrada. **No verificado:** review
  visual del overlay/editor con navegador (sandbox sin sesión).
- **Anotado (requiere migración):** `vsl_sessions.cta_clicks` para contar clicks del CTA, con el
  lote de migraciones pendientes (misma lección de `20260922100000`).

## ✅ RESULTADO (27-sep): PR-R2.2b — allowlist de campos en `sales/complete-reservation` (PR #240)

Fusionada en `main` (`c8d70b2`), CI de la PR en verde (quality 1m30s con dead-code, gitleaks 8s,
build 2m47s, Smoke E2E 5m8s). Hallazgo P1 #1 del informe FASE A del 26-sep:

- **Allowlist del `patch`** (commit de Claude adoptado, verificado campo a campo contra la UI):
  exactamente los 24 campos de `ventas/registro/nueva`; campo fuera de la lista → 400 antes de
  tocar la base. Cerraba la escritura arbitraria de columnas de `sales` por service role desde
  roles no directivos (manager/closer/setter/cobros).
- **Extensión de esta unidad:** el insert del calendario de cuotas también recibía spread del
  cuerpo del cliente; ahora filas copiadas campo a campo contra `ALLOWED_INSTALLMENT_FIELDS`,
  400 ante campo no previsto y `sale_id`/`tenant_id` sellados por servidor (p. ej.
  `is_monitoring=true` escondía cuotas del motor de morosidad).
- **Delete de cuotas verificado** antes del insert (un fallo duplicaba el calendario) — parte
  del commit adoptado.
- **Test:** `tests/sales-complete-reservation-allowlist.test.mjs` (6 invariantes estáticos).
- **Verificado:** suite focal 6/6 · quality local completo (960 unit pass / 0 fail / 3 skips
  preexistentes, 740 métricas) · CI verde · rama borrada.
- **Sigue del informe FASE A (unidad siguiente):** `approve-review` (limpia el flag antes de
  garantizar la comisión y el retry responde 400), PATCH `reversed` sin devolver la cuota a
  pendiente, `disputed` tratado como cobrado (contradice D5 de MONEY.md).

## ✅ RESULTADO (27-sep): PR-R0.1 y PR-R0.2 del RECOVERY_ROADMAP fusionadas en main

- **PR-R0.1 — PR #237** (`579a379`): port de `docs/BASELINE_QUALITY_2026-09-26.md` desde la rama
  local `6160dc3` (único contenido no fusionado según la auditoría). Byte-idéntico salvo la
  realineación de la tabla por Prettier (texto verificado palabra por palabra). Docs-only, CI no
  corre por paths-ignore. La rama local NO se borra: conserva WIP ajeno sin commitear.
- **PR-R0.2 — PR #238** (`94e2a4d`): crons `monthly`/`reminders` sin escrituras silenciosas. En
  `monthly`, las lecturas de `tenant_members`/`users`/comisiones/plantillas se comían el error
  como "lista vacía" (sueldos del mes ausentes con `ok`); ahora verifican `{ error }`, el recorte
  de paginado (`truncated`) tumba el run y una subcuenta que falla responde 500 al trigger (rerun
  idempotente por `(auto_source, period)`). En `reminders`, la lectura de ventas fuera de ventana
  y la aprobación de comisiones verifican, el flag de limpieza de Calendly no se baja
  fire-and-forget y un fallo de subcuenta responde 500. Presupuesto 45 s repartidos entre
  subcuentas (lección 504 de calendly-ghl); el corte se declara (`cortado`) y no cuenta como
  fallo. Test estático nuevo: `tests/cron-monthly-reminders.test.mjs`.
- **Verificado:** suite focal 29/29 · quality local completo (946 unit pass / 0 fail / 3 skips
  preexistentes sin credenciales, 740 métricas) · CI de la PR verde (quality 1m39s con dead-code,
  gitleaks 8s, build 2m22s, Smoke E2E 5m9s, Vercel) · ramas borradas en remoto y local.
- **Siguiente unidad del patrón:** barrido del resto (recuento pendiente del próximo barrido); la
  R0.3 (drift ledger) sigue BLOCKED_USER sin credenciales Supabase.

## ✅ RESULTADO (27-sep): PR-R2.2 — borrado compensable de ventas y comisiones futuras verificadas (PR #239)

Fusionada en `main` (`cc2c021`), CI de la PR en verde (quality 1m25s con dead-code, gitleaks 6s,
build 2m54s, Smoke E2E 5m7s, Vercel), rama borrada. Criterio #231/#236/#238 aplicado a las dos
rutas del foco P2 del 26-sep:

- **`sales/delete`:** el snapshot de auditoría (única vía de reconstrucción tras borrar) se
  construía de 6 lecturas sin comprobar — un fallo daba un snapshot incompleto y un borrado
  irrecuperable; ahora verifican y un snapshot roto no llega a borrar. Los 5 desenlaces se
  comprueban uno a uno. El borrado del dinero (comisiones → devoluciones → cobros → venta)
  COMPENSA: si un paso falla, se restauran las filas completas del snapshot en orden inverso
  (respetando la FK `commissions.collection_id`); si la compensación también falla, el 500 ordena
  NO repetir el borrado y apunta al snapshot en `audit_logs`.
- **`commissions/future`:** las 7 lecturas se tragaban el error como "lista vacía" — fallback del
  % a 5/10, veto `pays_commissions` (MONEY D9) saltado y previsión FIFO falsa; ahora responden
  500 con motivo. Sin cambios de cálculo (`comisiones-futuras-desglose.test.mjs` en verde).
- **Test estático nuevo:** `tests/sales-delete-atomico.test.mjs` (snapshot íntegro, orden inverso
  de restauración con filas completas, mensaje anti-reintento ciego, guards de las 7 lecturas).
- **Verificado:** suite focal 24/24 · quality local completo (954 unit pass / 0 fail / 3 skips
  preexistentes, 740 métricas) · CI verde · rama borrada.
- **Anotado como unidad propia (no incluido):** `repNetCash`/`loadTramoContext` del motor de
  comisiones tragan errores por dentro; `resolverScopeColaborador` es fail-open ante fallo de BD
  (contradice el fail-closed declarado en `scope.ts`), 9 llamadores.

## PROJECT RECONCILIATION — auditoría total 27-sep-2026 (Freebuff/Buffy)

Auditoría de reconciliación completa (236 PRs, todas las fuentes de petición históricas, ramas, CI y
código). **Entregables**: `PROJECT_RECONCILIATION.md`, `FEATURE_REQUEST_REGISTER.md`,
`BRANCH_RECONCILIATION.md` y `RECOVERY_ROADMAP.md` en la raíz del repo. Resumen de estado:

### VERIFIED COMPLETE

Multi-tenancy/RLS · money path (ventas/reservas/cobros/Stripe/comisiones/socios) · F1+F2 (event core +
conectores) · webhook GHL endurecido · Calendly · funnels · Fathom + cola · grabaciones · GA4 ·
facturas IA · contratos · colaboradores · RAG/skills · aprovisionamiento · Data Health · Smoke E2E CI.

### PARTIAL

Escrituras silenciosas (crons #238 y `sales/delete`+`commissions/future` #239 cerrados el 27-sep;
queda el barrido del resto + helpers compartidos anotados) · F3 resto de fases · rename
Afiliados→Colaboradores · filtros globales (pnl/finanzas/cohorts) · deuda UX (tokens, tipografía,
formatos, modales) · Sequra monitorización · clasificación canónica de llamadas.

### BROKEN

Nada bloqueante en main (CI success 27-sep). Crons `ai-insights`/`stripe-payments` fallan en schedule
(preexistente, ajeno). `sequra-morosos` 500 por `SEQURA_MERCHANT_REFERENCE` (USER).

### IMPLEMENTED NOT MERGED

PR #225 (`feat/money-25sep`, 9 commits, 34 ficheros — del propio Alex): base 14 commits atrás con
solapes (#207–#236). NO fusionar a ciegas: rebase + resolución + quality (PR-R2.1). Doc único sin
fusionar: `docs/BASELINE_QUALITY_2026-09-26.md` (rama local) → SAFE TO PORT (PR-R0.1).

### LOST / REGRESSED

Nada perdido en ramas remotas (no existe ninguna aparte de main). Los 40 PRs CLOSED sin merge:
Dependabot superado + `codex/qa-fixes` #4 (superseded, contenido llegado por otras vías) + #210 duplicado.

### NOT IMPLEMENTED

Rate limiting login · restore drill/PITR · alertas A3 (necesitan canal) · tipado Database Supabase ·
crear usuarios desde Subcuentas · auditoría visual completa (167 reglas).

### USER ACTION REQUIRED

1. Credenciales Supabase read-only en el entorno (desbloquea drift-ledger + 3 tests) · 2) decisión sobre
   PR #225 · 3) rotaciones (Anthropic/GROQ/Management/GHL secret) · 4) SEQURA_MERCHANT_REFERENCE en Vercel ·
2. pixel + UTMs en la web real · 6) reconexiones de proveedores y workflows GHL · 7) Railway worker ·
3. retención legal (F6) · 9) majors Dependabot. Detalle: `RECOVERY_ROADMAP.md`.

### NEXT PRS IN ORDER

PR-R0.1 (port baseline doc) → PR-R0.2 (crons monthly/reminders fail-ruidoso) → PR-R0.3 (drift ledger,
BLOCKED_USER credenciales) → PR-R2.1 (port #225 con Alex) → PR-R2.2/2.3 → R3 (datos) → R4 (UX).

### CONCURRENCY NOTES

⚠️ **27-sep (Buffy): 6 ramas `claude/*` remotas son linajes HUÉRFANOS** (`git merge-base origin/main <rama>`
vacío: `claude/{comisiones-reservas-fix, app-continuation-lpbupf, socios-reparto-beneficio,
ltgp-cac-aproximado, objetivos-prevision-f65, growth-context-coste-entrega}`). Sus puntas describen
trabajo que YA ESTÁ en main vía #201/#208/#211–#213 (anterior al repunto del 19-sep). **NO fusionar
NI rebasar** (regla «sin merge-base no hay merge», caso #210); verificado contenido a contenido.
Solo `claude/socios-flecos-finales` tiene base legítima (`5114973`) — pero su hermana
`socios-reparto-beneficio` (mismo tema) ya llegó a main por #213: tratarla como superseded salvo
verificación inversa. El clon del worktree tiene refspec de rama única (`origin/main`): para
inspeccionar ramas remotas, fetch con refspec explícito.

Checkout raíz (`fix/money-path-silent-writes`) conserva WIP ajeno sin commitear (informe FASE A del
26-sep en `docs/ACTIVE_HANDOFF.md`, +176 líneas: sus hallazgos de crons/sales-delete/commissions-
future/Correo-Drops ya están resueltos por #238/#239/#233 — cerrarlos en el doc antes de publicarlo;
stash@{0} del checkout raíz es copia redundante del mismo diff): NO tocado, NO borrado.
Rama local conservada por contener ese WIP (borrar la ref no borra el working tree). `gh run list
--commit` usado para diagnóstico de CI (un run cancelled no es fallo). Sin migraciones, sin deletes,
sin merges de ramas antiguas durante la auditoría.

## ✅ RESULTADO (27-sep): webhook GHL sin escrituras silenciosas — PR #236 fusionada en main

La unidad «Escrituras silenciosas — webhook GHL» está FUSIONADA: PR #236 (merge `a595298`), CI de la
PR en verde (quality 1m54s con dead-code incluido, gitleaks, build 2m47s, Smoke E2E 4m18s, Vercel) y
rama borrada en remoto y local. El bloqueo de credencial GitHub de la tarde del 26-sep se resolvió
solo: la App volvió a mintear credenciales y la rama se publicó sin intervención manual.

- **Qué entró:** update de `appointments`, `lead_status` (ambos caminos), insert/update de
  `contact_attributions`, cualificación y `audit_logs` de citas del webhook GHL verifican ahora el
  `{ error }` y responden 500 para que GHL reintente la entrega idempotente; `last_seen_at` y
  `set_source` se degradan a warn a propósito (reintentar no los arregla). Tests estáticos nuevos
  en `tests/webhook-ghl.test.mjs` fijan el criterio: ninguna escritura de estado de negocio
  fire-and-forget.
- **Verificado:** tests dirigidos de la ruta y su capa raw 131/131; suite completa 937 pass (3 skip
  sin credenciales Supabase, preexistente) + 740 métricas; CI de la PR en verde.
- **Siguiente unidad del patrón (~76 escrituras restantes):** crons `monthly`/`reminders` (confluyen
  con los P1 del relevo del 26-sep), después `commissions/future` y `sales/delete`.

## Revisión integral: bugs de dinero (fase 1) — 2026-09-26 (Freebuff/Buffy)

**PUBLICADO: PR #231 (`fix/money-path-silent-writes`, commit `fcb6457`) abierta contra `main` con CI
en verde (quality 1m47s, gitleaks, build 2m18s, Smoke E2E 4m54s, Vercel). Fila de tablero cerrada al
publicar; el barrido de los ~88 escritos restantes queda como siguiente relevo.**

**Fila de tablero (CERRADA — publicada en #231):** Freebuff/Buffy — revisión integral de bugs y
seguridad; carril producto (cobros/comisiones/gastos). Ficheros: `app/api/[tenant]/
evergreen/collections/[id]/route.ts`, `app/api/[tenant]/evergreen/payments/mark/route.ts`,
`app/api/[tenant]/evergreen/afiliados/registro/route.ts`.

**Hallazgo estructural confirmado (el backlog lo avisaba, sin fila):** los inserts/updates de
supabase-js que no comprueban `{ error }` siguen siendo el patrón dominante — contados ~92 escrituras
`await` sin comprobar en `app/api`+`lib`. Los más caros ya corregidos (todo de dinero):

1. **DELETE de cobro (`collections/[id]`)**: el borrado de comisiones y del cobro se hacía con `await`
   plano. Un fallo silencioso dejaba **comisiones huérfanas apuntando a un cobro ya borrado** — el
   invariante exacto que S0-5 cerró. Ahora: se comprueba el error del delete de comisiones, se
   verifica con `.select('id')` que el cobro realmente se borró, y el `audit_logs` de update/delete
   ya no es fire-and-forget (un cambio de dinero sin rastro de auditoría devuelve 500 con motivo).
2. **`payments/mark`**: las tres escrituras de `sale_expected_installments` (paid/monitoring/delinquent/
   unflag) iban sin comprobar; "marcar pagada" devolvía `ok` aunque la cuota no quedara cobrada.
   Ahora cada escritura se verifica y devuelve 500 con el motivo.
3. **`afiliados/registro` (alta pública)**: el upsert de `users` tras invitar al usuario en Auth iba
   sin comprobar; un fallo dejaba **cuenta huérfana en Auth con correo enviado y sin perfil, ni código
   de tracking, ni forma de cobrar comisiones**. Ahora revierte con `deleteUser` (mismo patrón que la
   ruta de invitación) y avisa.

**Verificado local:** typecheck OK · format:check OK · 928/928 unit (3 skips de credenciales, como
en el baseline) · 740/740 métricas · 21/21 y 46/46 en suites focales de aislamiento/comisiones/
webhook GHL. E2E Playwright no ejecutable en este sandbox (sin `E2E_PASSWORD`); corre en CI.

**Seguridad (spot-check, inspeccionado no probado en vivo):** webhooks GHL/contract/onboarding
comparan secreto con `timingSafeEqual` (`lib/webhooks/verifySecret.ts`); Stripe verifica firma sobre
el body crudo; Resend svix fail-closed; `ver-como` exige OTP + coincidencia de sesión y audita. Sin
nuevo hallazgo P0. El invariante de esquema vivo (`esquema-tenant-invariante.test.mjs`) corre en CI;
aquí se salta sin credenciales.

**Desfase confirmado (no corregido, fila de Claude Code):** `lib/types/database-generated.ts` NO
contiene las 9 columnas de `20260922100000` (invoice__, paid_at, paid_from_account,
payment_reference, counterparty__). La pantalla de gastos usa tipos a mano en la propia página, por
eso typecheck no lo caza: es otra señal de que **la migración sigue sin aplicar en producción**.

**Queda (priorizado):** (1) el barrido de los ~88 escritos sin comprobar restantes, empezando por
webhook GHL (`contact_attributions`, updates de citas) y crons; (2) smoke con navegador cuando haya
preview/credenciales E2E; (3) regenerar tipos tras aplicar la migración pendiente; (4) pulido UX/UI
global (F3/Taste) — explícitamente DESPUÉS de estabilizar.

## MONEY.md v1 en main + relevo de la PR #210 — 2026-09-25 (Freebuff/Buffy)

**Estado real del vocabulario financiero (F3):** `MONEY.md` v1 está en `main` desde #209 (`43f78e5`):
booked/collected mapeados a Contracted Revenue y Cash Collected; billed y recognized declarados
abiertos (A1/A2) sin cálculo a medias; mecánica bruto/atribuible SIN modo oficial (D1); EUR por
tenant con FX a la fecha del hecho (D2); IVA bruto para negocio (D3); fees solo en P&L (D4);
refunds cuando ocurren y disputas a cola de revisión (D5); cash manual deduplicado por
`payment_reference` (D6); comisiones, cuotas y financiación neta (D7). La auditoría de Claude Code
(#212/#213) añadió encima D8 (reservas no comisionan hasta completar), D9 (`pays_commissions` veto
absoluto) y D10 (token compartido nunca sincroniza "todas" sin selección) — compatible, no conflicto.

**PR #210 cerrada como sustituida (no fusionada).** Su rama `docs/money-v1-cierre` era un linaje
huérfano (sin merge-base con `main`, exactamente el caso de las reglas de trabajo del 21-sep): lo
único exclusivo que contenía era este texto de relevo, que entra ahora por esta PR. Verificado antes
de cerrarla: ni `MONEY.md` ni ningún otro fichero del linaje tenía contenido que no estuviera ya en
`main` (comparado commit a commit).

**Pendiente de Alex:** validar las decisiones y desbloquear las que quiera (sobre todo A3 — el modo
oficial del consolidado — y A5 clawback). Ninguna bloquea código hoy. El tablero queda con la
migración `20260922100000` como única fila activa (prioridad 1 de Claude Code).

## Auditoría financiera: reservas, comisiones, socios y gasto de Meta — 2026-09-25 (Claude Code)

**Fusionado en `origin/main`:** PR #211 (`1bb4e5b`), #212 (`5114973`), #213 (`2d73520`). Origen: Alex pidió auditar comisiones/reservas/gastos tras sospechar errores reales (no una tarea de roadmap). Se encontraron y corrigieron 4 bugs de negocio distintos, todos con impacto real en producción:

- **Reservas comisionaban al instante.** `saleNeedsCommissionReview` (`lib/commissions/generate.ts`) ahora bloquea la comisión de un cobro de reserva (`plan.method === 'reserva'`) mientras `reservation_completed_at` siga null; se reabre y reconcilia al completar la reserva. Una reserva abierta tampoco cuenta ya como venta/cliente (`esReservaAbierta`, `lib/metrics/agregados.ts`).
- **`users.pays_commissions` existía en producción (sin migración en el repo) pero ningún código la leía.** Ahora se respeta en `calculateCommissionsForCollection`, en el Dashboard de Comisiones y en `commissions/future` (proyección). Un socio marcado así puede seguir comisionando por error si algo nuevo genera comisiones sin pasar por estos puntos — grep de `pays_commissions` antes de tocar el motor de comisiones.
- **`resolveMetaConfigs` trataba "sin cuenta seleccionada" como "sincroniza todas las que vea el token."** Un token de Meta Business Manager que ve cuentas de OTRO negocio mezclaba 164 campañas / ~190.081 € de gasto / 16.552 € ya en `expenses` de este tenant. Corregido: exige selección explícita o `META_AD_ACCOUNTS_ALL` puesto a propósito. Datos ya limpiados en producción.
- **No existía ningún sitio para ver las ganancias reales de un socio en €** (solo el % configurado en `/settings/socios`, que además no estaba enlazada en el menú). Nuevo `/finanzas/socios` + `lib/finance/socios.ts` (puro): reparte el Pre-Tax Profit del periodo entre socios activos. Un socio vinculado por `partners.user_id` (columna nueva) ve su propia ganancia en el Sidebar sin necesitar rol de dirección.

**Corrección de datos en producción (con confirmación explícita de Alex en cada decisión):** reclasificada una venta de 50€ importada mal desde Stripe como la reserva que era; eliminadas 3 comisiones de reserva nunca completada; **eliminadas las 43 comisiones históricas de closer de una socia marcada `pays_commissions=false`** (1.992,20€, decisión explícita: nunca representaron dinero transferido, su compensación es el reparto de socios); limpiados los 164 campañas/gasto ajeno de Meta.

**Documentado para que no se repita:** `docs/MONEY.md` D8 (reservas no son venta ni comisionan hasta completar), D9 (`pays_commissions` es veto absoluto, en generación y lectura), D10 (integración con token compartido nunca sincroniza "todas" sin selección explícita). `PROJECT_CONTEXT.md` §14 tiene el resumen operativo de los 4 patrones de bug (regla de negocio "a medias", columna sin migración que nadie lee, "vacío" como default peligroso, fix de código que no repara datos ya escritos).

**Verificado:** CI de las 4 PRs en verde (quality, build, Smoke E2E — un fallo de Smoke E2E en #211 confirmado como flake ajeno, tests/e2e/contacto-ficha, re-run verde). Local: typecheck exit 0, 902/905 unit (3 fallos preexistentes de esquema Supabase en vivo, sin relación), 719/719 métricas (incluye tests nuevos de `lib/finance/socios.ts` y los de Meta reescritos a la nueva política de selección de cuentas).

**Queda pendiente, no abordado en esta auditoría:** claridad de pagos/impagos por cliente y KPIs personales en tiempo real — revisados (`ventas/pagos`, `ventas/registro/[id]`, Dashboard de Comisiones) y ya cubren bien lo pedido, no se tocó código ahí.

## F3 trozo 1: contrato de métrica versionado — 2026-09-24 (Freebuff/Buffy)

**Fusionado en `origin/main`:** PR #202 (squash `48e32be`, rama `feat/f3-metric-definitions` borrada). `lib/metrics/definiciones.ts`: `DefinicionVersionada` (version, grain period/cohort, ventana de maduración, muestra mínima, lineage) construida DESDE el registro canónico, y `evaluarDefinicion` que etiqueta cada resultado (`muestra_insuficiente`, `en_maduracion`) sin sustituir el valor. MER y refund_rate declaradas con fórmula y motivo, sin cálculo a medias. 14 tests con golden fixtures deterministas (show_rate 70.59, close_rate 25, CAC 1249.99, ROAS) en `tests/metrics/f3-definiciones.test.mjs`.

**Verificado:** CI de la PR y de `main` (run 36069960953) en verde; local: 693/693 métricas, 894/897 unit, typecheck exit 0.

**Queda de F3:** `MONEY.md` (decisión financiera: booked/billed/collected/recognized, bruto vs atribuible, FX, IVA, fees — requiere validación de Alex; el plan dice "si bruto vs atribuible no está decidido, implementar ambos y NO marcar ninguno como oficial") y cablear `MetricaPublicada` en consumidores de UI/API. Conectado con #201 (anotaciones, más abajo): las marcas describen periodos, no fechas — el grain del contrato ahora lo hace declarable por métrica.

**Incidente CI en `main` (2026-09-25):** el run del squash de #203 (`67d3ae5`, run 36070984980) falló SOLO en Smoke E2E: `TimeoutError: page.waitForURL` en `tests/e2e/global-setup.mjs:48` — el login del global-setup no navegó a `**/qa-e2e/dashboard` en 30s tras crear el tenant. No es regresión de código: el mismo árbol pasó el mismo E2E en la PR #204 (cuyo HEAD incluía #203 vía merge). Sin permiso para `gh run rerun`, la validación verde del árbol idéntico quedó en la PR #205 (run 36098777163, Smoke E2E 4m52s). Ojo con el mecanismo: los pushes docs-only a `main` no crean run (paths-ignore) — un commit de docs NO re-lanza el CI de main; el commit vacío solo funciona como workaround en ramas de PR. Conclusión: flakiness transitorio del login del global-setup; si se repite, añadir reintento/timeout ahí, no revertir #203. Hallazgo añadido al diagnosticar el incidente: la concurrencia del workflow es GLOBAL (un solo run a la vez en todo el repo, no por rama) — un push de cualquier PR cancela los runs en marcha de las demás (pasó con esta misma nota: su primer run fue cancelado a mitad de build por el push de `claude/growth-context-coste-entrega`; cancelled ≠ fallo). Al coordinar en paralelo: no pushear encima del run ajeno en marcha y re-disparar con commit nuevo cuando la ventana esté libre.

## Anotaciones en gráficos + limpieza de tipos — 2026-09-24 (Claude Code)

**Fusionado en `origin/main`:** PR #201 (squash `72fe57b`). Cierra tres pendientes de la sesión
anterior:

- **#66** — tabla `annotations` (fecha, título, descripción, categoría, autor) para marcar
  picos/valles en `TrendChart`. Migración `20260924222339_annotations.sql` con RLS calcada de
  `ai_business_facts` (el equipo lee y anota, el autor o admin/director corrige o borra,
  aislamiento por tenant vía `auth_tenant_ids()`). API en `/anotaciones` y `/anotaciones/[id]`,
  componente `AnotacionesInspector`, wiring de ejemplo en `analitica/embudo`.
- **#54** — eliminados los `any` restantes de `setting-ai`, `carruseles/*` y `VslPlayer`. De paso
  corrigió un bug real: el contador `convo` de las correcciones automáticas de setting-ai nunca se
  guardaba (el panel mostraba "CNaN" en vez del número de conversación).
- **#53** — verificado que ya estaba resuelto por trabajo previo (`cascada-sesion.test.mjs`,
  17/17). Sin cambios de código, solo confirmación.

**Migración aplicada y verificada en producción** vía el conector MCP de Supabase, sin depender de
red local (ver "Puedo hacer mejor que Freebuff" más abajo): 5 políticas RLS confirmadas por SQL
directo contra `pg_policies`, `get_advisors` sin hallazgos nuevos.

**CI se puso rojo, causa raíz encontrada y arreglada sin reabrir el PR**:
`tests/esquema-tenant-invariante.test.mjs` falló porque `lib/types/database-generated.ts` no traía
la tabla nueva. `npm run tipos:bd` no pudo correr en este sandbox (sin red real a Supabase,
`.env.local` con placeholders); se añadió el bloque `Annotations` a mano siguiendo el patrón
mecánico del generador (todo opcional/nullable, igual que el resto del artefacto) y se verificó
1:1 contra las 111 tablas reales del esquema vivo vía el conector — 0 faltan, 0 sobran. CI en
verde tras el push; PR mergeado.

**Extra — `CRON_SECRET` creado en Preview** (Vercel, proyecto `growth-ops`). Llevaba desde el
21-sep como bloqueo abierto ("CRON_SECRET existe solo en Production... bloquea el staging que F1
necesita") sin que nadie lo tocara; verificado hoy que seguía faltando. Es aditivo, no toca
Production ni sustituye ningún valor existente: cualquier disparo manual de cron sobre un preview
deja de devolver 401 por falta de secreto.

**Verificado hoy — estado real de los bloqueos de hace 3 días (nada ha cambiado salvo lo de
arriba)**:

- `RESEND_API_KEY` sigue marcada `readable-secret` en Vercel. No se puede rotar desde aquí: hace
  falta que Alex regenere la clave en el dashboard de Resend primero.
- El repo sigue público (decisión ya tomada, no es una regresión).
- El proyecto `go-prod` de Vercel sigue existiendo, vacío (`live: false`). No lo he borrado sin
  confirmación explícita de hoy — es una acción destructiva sobre infraestructura compartida y la
  aprobación de la sesión del 21-sep no cuenta como vigente.
- `growth_context` (bloqueo de #57): **parcialmente relleno, no vacío como se creía**. Tiene
  `business_type` = "Formación B2C", `offer_price_eur` = 1996.97, `target_monthly_revenue_eur` =
  30000, `target_cash_roas` = 4.00. **Faltan**: `target_ltgp_cac`, `capacity_calls_per_week`,
  `capacity_active_clients` — sin esos tres, el motor de objetivos/previsión (#65, en curso) sigue
  sin poder calcular ritmo ni capacidad aunque el código (`lib/metrics/series.ts`) ya esté listo.

## F2 completa: Stripe sobre el contrato — 2026-09-24 (Freebuff/Buffy)

**Fusionado en `origin/main`:** PR #199 (squash `9f8ba50`, rama `feat/stripe-conector-f2` borrada). El conector de Stripe completa el alcance de F2 (GHL #185, Meta #187, Stripe #199). Envuelve el webhook y el sync ya probados sin reescribir semántica económica: `normalize` delega en `derivarStripe` (`lib/eventos/stripe.ts`), `backfill` en `syncStripePayments`, salud con `GET /v1/balance` del cliente existente. Fixture sanitizado + 7 tests nuevos en la suite de contrato; el marcador `pendientesDeMigrar` ya no lista Stripe.

**Verificado:** CI de la PR en verde (quality 1m28s, gitleaks, build 2m54s, Smoke E2E 4m40s, Vercel) y CI de `main` en verde sobre el squash (run 36061066607, los 4 jobs). Validación local previa: 30/30 en contrato+arquitectura, 894/897 unit (0 fallos, 3 skips), 679/679 métricas, typecheck exit 0.

**Queda de F2:** nada de código. Los conectores restantes del catálogo (Calendly y demás) no formaban parte del alcance declarado del plan ("solo GHL, Stripe y Meta"); migrarlos sería decisión de relevo, no deuda.

## Lote facturas IA + comisiones lote + contratos externos — 2026-09-23 (Freebuff 7a08c143)

**Hecho y dónde está.** La unidad **desglose nuevo vs recurrente en comisiones futuras** está
commiteada en local como `d219974` (pathspec, 7 ficheros: route `commissions/future`,
`comisiones/page.tsx`, `ColaboradorDashboard`, `% efectivo` en `CommissionsTable`,
`lib/finance/nuevo-vs-recurrente.ts` y 2 ficheros de tests). Vive en la **serie local sin pushear**
(`1ec1447 … d219974`, 7 commits) montada sobre una base vieja de `origin/main` — no pushear tal
cual, ver "siguiente acción".

**Qué se validó de verdad.**

- **Verificado en preview** con la sesión QA WDC (fixture de pruebas): pestaña Futuras con **48
  cuotas, todas `recurrente`** (correcto: ninguna venta activa queda sin cobros recogidos), KPI
  "Futuras (por cobrar)" **6.777,13 € = desglose del endpoint al céntimo** (`nuevo 0 · recurrente
6.777,13`), badges emerald/sky por fila y desglose respetando filtros. El badge "Nuevo" no tiene
  caso en los datos actuales; aparecerá con la próxima venta sin cobrar.
- **Probado** vía arnés `/tmp/qa-gate` (árbol exacto local reconstruido con `git archive` + parche
  del WIP): format, lint y typecheck **verdes**; **881/882 tests**. El único fallo
  (`esquema-tenant-invariante`, tipos generados vs BD viva: falta `Annotations`) es **preexistente
  y ambiental** — la unidad no toca `database-generated.ts` ni ese test.

**Hallazgos que el relevo debe conocer.**

1. **`origin/main` avanzó y SOLAPA** (`b27edac` → `949637f`, ≥15 commits: #208–#221). El **#211 ya
   implementa la exención** `pays_commissions` con su migración `_repo_sync` (el `1ec1447` local es
   probablemente descartable al rebase, comparar diffs) y el **#213 tocó comisiones futuras**
   (conflicto esperado en el route con `ce57c3b`+`d219974`).
2. **Doble sesión QA en el navegador de preview**: una cookie httpOnly heredada de otra cuenta QA
   de un hilo anterior convivió con el login browser-side; los APIs server-side resolvían el
   usuario equivocado → 404 "Subcuenta no encontrada" en endpoints correctos. Diagnosticado
   comparando el `sub` del JWT de la cookie server-side con el usuario del email en `auth.users`.
   Lección: antes de diagnosticar la app (o declarar una anomalía de datos como Adspend=0),
   verifica que la sesión que ve el server es la cuenta que crees — un 0 pintado puede ser solo
   una página que no llegó a cargar sus datos.
3. **El clon `/tmp/growthops-preview-3003` está disputado**: un agente Claude Code trabajaba en él
   durante esta sesión (escribió ficheros en vivo) y mezcla `origin/main` avanzado con
   experimentos — **no es fuente de verdad**. La validación se hizo en `/tmp/qa-gate` (efímero,
   borrable; su `node_modules` está enlazado al del clon).
4. **Sandbox degradado**: node/npm no arrancan con cwd en el repo (EPERM `uv_cwd`, degradación
   progresiva hasta bloqueo casi total); git/tar/sed/launchd sí funcionan. Receta que funcionó:
   `git archive HEAD | tar -x -C /tmp/qa-gate`, `git diff > /tmp/wip.patch` + `git apply` en el
   arnés, `node_modules` enlazado y Quality Gate vía job launchd efímero (ya retirado).

**Siguiente acción exacta**: rebase de la serie local sobre `origin/main` — (a) comparar `1ec1447`
con el #211 y descartarlo si es equivalente; (b) adaptar el desglose nuevo/recurrente (`ce57c3b` +
`d219974`) al route de futuras que dejó #213; (c) regenerar tipos (`npm run tipos:bd`) para calmar
el invariante; (d) Quality Gate verde → push y PR.

**Hipótesis Adspend=0 en unit-economics: CERRADA Y REFUTADA (25-sep).** Sonda SQL de solo-lectura
(`.claude/tmp/ref-adspend-cero.mjs`, consolidada y re-ejecutable): las 3 campañas de septiembre de
`act_2204892919779781` EXISTEN en `campaigns` (3/3) con el `account_id` bien guardado, la cuenta
está seleccionada en `META_AD_ACCOUNT_ID`, hay gasto real (919,68 € en la daily de sept;
3.711,50 € acumulado en `campaigns.adspend`, 10/10 campañas del tenant en esa cuenta), el JOIN
diario↔campaña cuadra y nada se trunca (160 filas vs cap 49.999; daily al día). Si la UI llega a
pintar 0, la causa es de entorno de visualización (sesión/auth equivocada — ver hallazgo 2 — o
preview con código/`env` desfasado), no de datos. Siguiente comprobación natural: ver el CAC en
unit-economics con sesión limpia de QA WDC (≈919,68 € de gasto sept).

**Sigue pendiente** (backlog en `PENDIENTES.md`): dual facturación vs cash en unit-economics
(CAC solo donde haya adspend del periodo, sin inventar ceros).

**WIP sin commitear**: `.freebuff/run.md`, `.gitignore` y este documento.

## Cierre de consolidación — 2026-09-22

**Estado publicado:** `origin/main` está en `c2c3e6a33a847b9d3220b9783a01106dc87f73c8`, commit squash de la PR #173 (`docs: consolidate handoff and user blockers`). Contiene la PR #172 (`269754f`) de custom fields/hardening y la PR #171 (`24a9646`) de coordinación. Las tres ramas remotas fueron eliminadas. Los checks de código de #171 y #172 (quality, gitleaks, build y Smoke E2E) terminaron en verde; #173 solo cambió documentación y no generó un workflow nuevo por `paths-ignore`. No se aplicó manualmente ninguna migración en producción.

**Regla de verdad:** el checkout compartido `claude/constitucion-y-fases` sigue en `2af651a` y conserva WIP local de varias áreas; no se ha publicado ni mezclado automáticamente. No debe afirmarse que "todo" el trabajo de las hebras está en `main` hasta separar cada bloque, probarlo y fusionarlo como PR atómico. No hacer `git reset`, `git clean`, `git add -A` ni copiar desde `/tmp` sobre esa carpeta.

**Aprendizajes incorporados:** verificar siempre `origin/main` y el merge-base antes de editar; una sola rama/PR por unidad; pathspec explícito al commitear; diagnosticar CI por SHA final y no por runs cancelados; comprobar esquema vivo antes de escribir SQL o queries; ejecutar `BEGIN … ROLLBACK` funcional antes de aplicar migraciones; no convertir fallos de fuente en ceros; no guardar PII, tenants, clientes o credenciales en código/documentación; y distinguir inspeccionado, probado y verificado en producción.

**Bloqueo conocido:** sigue pendiente el dry-run SQL en QA de `cleanup_custom_field_values()` tras revocar `EXECUTE` público: comprobar trigger, limpieza JSONB y rechazo de RPC directa. La migración no se ha aplicado manualmente en producción.

**Trabajo de las hebras referenciadas que NO se puede declarar publicado sin un PR/SHA verificable:** integraciones Hotmart/TikTok/Instagram DM, VSL V1/V2, callback OAuth de YouTube, trazabilidad IA de facturas, comisiones por lote, adjuntos de contratos, custom fields del WIP compartido y cualquier migración creada localmente. Revisar cada bloque contra `git log origin/main`, no confiar en mensajes de sesiones anteriores.

**Siguiente relevo:** trabajar únicamente desde un checkout limpio de `origin/main`; reclamar el área en el tablero; separar primero seguridad/migraciones, después integraciones con credenciales reales y por último UX; cada bloque debe incluir regresión, quality/build proporcional, CI por SHA y evidencia de deploy si aplica.

## Candidato aislado de custom fields — 2026-09-22

Checkout creado desde `origin/main` (`2ec86f5`), sin commit ni push. El diff intencionado contiene únicamente: aislamiento de cuotas/cobros/comisiones por `sale_id` y `tenant_id` en la ficha, regresiones focales de custom fields, y la migración `20260922130000_revoke_custom_field_cleanup_execute.sql`. La migración canónica `20260921200000_contact_custom_fields.sql`, la API y los tipos ya existen en `origin/main`; no se duplican.

Quedan expresamente fuera contratos, colaboradores, RAG, facturación, IA, integraciones, dashboards, archivos generados y secretos. Validación pendiente: ejecutar tests, typecheck, formato y un dry-run QA de la revocación antes de abrir PR. No afirmar que la revocación está aplicada en producción hasta verla en la lista de migraciones y confirmar que el trigger sigue limpiando `contacts.custom_fields`.

> **Lee esto entero antes de tocar nada.** Este documento es el punto de coordinación entre los
> agentes que trabajan en el proyecto (Claude Code, Freebuff, Codex, Copilot). Debajo de la sección
> "Estado" hay un histórico por hebras que se conserva como registro; lo vigente es lo de arriba.

## CODEX — DASHBOARD & METRIC AUDIT

**2026-09-25 — EN CURSO, NO CERTIFICADA.** Base `7a150cc`; rama única `codex/dashboard-metric-audit`. Matriz: [DASHBOARD_AUDIT.md](../DASHBOARD_AUDIT.md). Plan: [DASHBOARD_CORRECTION_PLAN.md](../DASHBOARD_CORRECTION_PLAN.md). No confundir inspección de código con revisión visual completa.

### COMPLETED

- Skills de marketing/copywriting y sales-engineering del proyecto, MONEY/METRICS y contratos existentes revisados.
- Inventario por rutas; trazabilidad de métricas críticas de dashboard, analytics, funnels, marketing, CRM, ventas, comisiones, finanzas, delivery y Ask.
- Consultas de producción de solo lectura: cobertura, asignación, estados, monedas y jobs. Evidencia real comunicada privadamente; documentos sin datos de tenant.
- Prueba de lectura RLS con rol autenticado de colaborador y rollback: scope excesivo demostrado (F01). Endpoints privilegiados revisados (F02); HTTP por rol pendiente.
- Reproducciones sintéticas: reserva abierta, cobro pendiente, moneda ignorada y refund de cobro antiguo. No se modificaron datos, roles, políticas ni integraciones.
- Quality local PASS: format/lint/typecheck, unit 902 pass / 3 skipped / 0 fail, métricas 729 pass. Build PASS; knip informativo ejecutado. Sin E2E ni browser del build modificado. Producción aún anterior.
- Browser admin: paneles principales, campañas/Meta, Instagram, CRM/ventas/comisiones, finanzas/cohortes, alumnos/CSM/bajas, Data Health, contenido/Setting AI. Interacciones y pendientes exactos en DASHBOARD_AUDIT.md.
- Incidente Ver como: contrato ocultó retorno; salida dejó cookie auth HttpOnly. Se eliminó únicamente sesión local defectuosa, usuario volvió a iniciar sesión y dashboard admin verificado. No repetir impersonación. F21 código pendiente.

### SAFE FIXES APPLIED

- `lib/ai/agent/tools.ts`: HEAD de contactos devuelve count, no filas; Ask ahora conserva total/0/null. Test nuevo `tests/metrics/agent-overview-count.test.mjs` falló en 12 y 0 antes, pasa después.
- F19: filtros tenant en dashboard/unit-economics/finanzas resumen,P&L,cohortes,proyección; usuarios por membresía. F20: CTR multiplicado por 100. Regresiones en tests/metrics/dashboard-tenant-scope.test.mjs (dos tenants y n=0).
- Documentos actualizados F01–F25. Correcciones en rama, sin despliegue. CRM/alumnos/selectores globales y seguridad siguen pendientes.

### USER ACTION REQUIRED

- Admin ya operativo. Roles restantes requieren acceso existente de prueba; no firmar contratos ni ampliar permisos.
- Confirmar setters y mapping real de citas/ventas sin asignar; confirmar enlaces venta-cita y asistencia provisional con evidencia. Preparar lotes privados, jamás IDs reales en Git.
- Indicar inicio esperado de histórico por fuente/cuenta para poder cuantificar huecos; primer registro importado no demuestra completitud.

### EXTERNAL BLOCKERS

- Colaborador bloqueado en UI por contrato; no omitirlo. Mobile, exports y otros roles siguen sin validar.
- Conversaciones orgánicas sujetas a acceso del proveedor. Logs de timeout y éxito mezclados requieren revisión por job, no un diagnóstico global de integración rota.

### BUSINESS DECISIONS REQUIRED

- Pendientes de MONEY (modo bruto/atribuible y fuente FX, billed/recognized/clawback cuando se activen).
- Grano clientes únicos vs ventas en cohortes, close rate total vs cualificado y ventanas de maduración por oferta/canal. No sustituir definiciones por benchmark.

### FINDINGS BY PRIORITY

- **P0 F01–F02:** colaborador lee equipo por RLS; APIs Funnels/VSL usan privilegio sin scope de rol suficiente. Coordinar carril de seguridad antes de migrar.
- **P1 F03–F10,F13:** reservas contadas de forma distinta; FX ausente; refunds/fechas y cash heterogéneos; filtros del resumen; población del funnel; diagnóstico sin gates; cohortes inmaduras; capa AI divergente; errores como cero financiero.
- **P2 F11–F12,F14–F18:** mapping/asistencia/histórico; fronteras temporales; proyección/morosidad; filtros atribución; control Data Health usa name no seleccionado; delivery no acredita retención.
- **P0 F19:** datos de otra subcuenta en panel seleccionado, fix local parcial. **P1 F20:** CTR, fix local. **P2 F21–F23:** retorno de sesión, ratios sin muestra, webhook sin actividad.
- **P3:** desktop revisado parcialmente; gastos tiene etiquetas recortadas y dashboard prioriza tabla de comisiones sobre KPIs. Responsive pendiente.

### DATA GAPS

Asignaciones y enlaces incompletos, notas provisionales, fuentes de vídeo/conversaciones sin datos y fecha histórica esperada sin acreditar. Alcance exacto en plan. **Ningún hallazgo clasificado como problema real de negocio fuera de KPI.** Orden obligatorio: definición → fuente → completitud → periodo → maduración → asignación → cálculo → benchmark orientativo.

### NEXT RECOMMENDED WORK

1. Resolver P0 con dry-run y contrato por rol; no confiar en UI.
2. Funnels desktop/móvil ya observado: F24 ancho=1 cuando primera etapa cero; F25 HTTP400 con sintaxis NOT sospechosa. Sin fix aún. Unit-economics móvil solo cabecera/filtros (sin overflow); viewport restaurado. Continuar eventos/socios/Brief/integraciones/recursos/Person360, roles/exports. Sesión admin activa, no Ver como.
3. Corregir P1 en unidades pequeñas, comparar UI/API/AI con mismo scope y datos sintéticos.
4. Obtener mappings/fechas humanas y ejecutar backfill auditado en unidad separada.
5. Actualizar scorecard y cerrar solo al verificar todos los módulos/roles críticos. La auditoría permanece abierta.

### CONCURRENCY NOTES

Checkout alternativo antiguo conservado intacto: WIP de comisiones, dashboard de colaborador, clasificación nuevo/recurrente y documentación de otros agentes. Migración/gastos `20260922100000` y tipos BD reclamados por Claude Code: no tocados. No reset, stash, rebase ni force push. No se desplegó ni fusionó este trabajo.

## Tablero de reclamaciones (en curso AHORA)

**CODEX — DASHBOARD & METRIC AUDIT (25-sep):** Ampliación tras browser: reclama filtros tenant en `dashboard/page.tsx`, `unit-economics/page.tsx`, `finanzas/analitica/{resumen,pnl,cohortes,proyeccion}/page.tsx`, CTR en `marketing/adquisicion/campanas/page.tsx` y tests asociados. No toca RLS ni motor financiero. auditoría transversal solicitada por el usuario; rama `codex/dashboard-metric-audit`. Reclama `DASHBOARD_AUDIT.md`, `DASHBOARD_CORRECTION_PLAN.md`, sección propia de relevo y fix acotado del conteo HEAD de contactos en `lib/ai/agent/tools.ts` con `tests/metrics/agent-overview-count.test.mjs`. Inspección de código y producción de solo lectura; ningún cambio de datos. No tocar el WIP del checkout Documents ni las migraciones/gastos reclamados por Claude Code. Regla KPI: definición → fuente → completitud → periodo → maduración → asignación → cálculo → benchmark orientativo.

Carriles y reglas en `AGENTS.md` › "Trabajo en paralelo". **Antes de empezar, añade tu fila; al
fusionar, bórrala.** Si lo que vas a tocar está aquí a nombre de otro, no lo toques.

| Agente              | Qué                                                                                                                                                                                            | Rama | Toca | Desde |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ----- |
| (sin filas activas) | Tablero vacío tras el relevo del 2-oct: migración `20260922100000` ya aplicada (verificado por SQL) y ramas de worktree auditadas — véase «Relevo de los carriles codex / Claude Code» arriba. | —    | —    | 2-oct |

## Reglas de trabajo (2026-09-21)

Se escribieron tras encontrar una carpeta local que llevaba días trabajando sobre un linaje de git
**sin ancestro común** con `origin/main`: todo lo hecho ahí era irrecuperable por merge. Existen
para que no vuelva a pasar.

1. **Una sola carpeta local y un solo repo.** El repo es
   `github.com/torrealex97-star/Growth-Ops-App`. La carpeta de trabajo es
   `~/GIT HUB/Growth-Ops-App`. No se crean clones paralelos "para probar".
2. **Al empezar sesión, comprueba que no has derivado**:
   ```
   git fetch --prune && git rev-list --left-right --count main...origin/main
   ```
   Cualquier cosa que no sea `0 0` (o un simple "detrás") se investiga **antes** de escribir código.
   Si `git merge-base main origin/main` no devuelve nada, la carpeta no sirve: para y avisa.
3. **Rama corta, PR, merge.** Una rama por unidad de trabajo, PR en cuanto haya algo coherente y
   merge a `main` con CI en verde. Nada de acumular días sin pushear: lo que no está en `main` es
   invisible para los demás agentes y para Alex desde el móvil.
4. **Ramas vivas, las mínimas.** Tras mergear se borra la rama. Una rama que sobrevive a su PR es
   trabajo que otro agente rehará sin saberlo.
5. **Antes de empezar algo, mira si ya está hecho.** Lee esta sección y `git log origin/main`. Si
   dos agentes pueden tocar lo mismo, decláralo aquí primero.
6. **Actualiza este documento al terminar**, aunque quede a medias: qué tocaste, qué validaste de
   verdad y qué queda. Un relevo que no se escribe no existe.
7. **Nada de PII ni credenciales en commits.** El repositorio es **público**: `docs/SECURITY_PRIVACY.md`.

## Estado (2026-09-21, tarde — hebra Freebuff 4250bf8e)

**Citas (Calendly/GHL) arregladas — #108 + #110 + #112 fusionados.** Síntoma: la semana mostraba
1 agenda con muchas más en Calendly/GHL. Causa raíz: la sync de citas solo existía como botón
manual (history-sync), la importación del 12-sep jamás tuvo planificador y ni un run de estos
proveedores en `integration_sync_runs` desde entonces. Ahora: **cron diario de Calendly**
(04:20 UTC, ventana 14 días, upsert idempotente, presupuesto 35 s) por GitHub Actions; **GHL va
SOLO por botón** — su API lista todos los contactos de la ubicación antes de tocar eventos y no
cabe en los 60 s de Vercel Hobby (dos pasadas en producción: 504 y run colgado en 'running'; el
webhook cubre el tiempo real). Implementación única en `lib/integrations/citas-sync.ts`
(botón + cron comparten código; test prohíbe duplicarla). `SYNC_DEFS` declara `calendly-citas`
y `ghl-citas` (route: null + manualReason). Resultado verificado en BD: 1 → **16 citas esta
semana** (+19 importadas, 67 actualizadas; 0 duplicados GHL↔Calendly en 30 días).

**Ops extra de la misma sesión**: migración `20260918140000` (meta_actions/meta_action_values de
`campaign_daily`) estaba SIN aplicar en producción — el cron `meta-daily` llevaba días en error
"schema cache". Aplicada, registrada en `schema_migrations` y `NOTIFY pgrst 'reload schema'`
verificado vía REST. También se cerró a mano el run de GHL que quedó colgado en 'running'.

Tests: 519 → 568 (la otra hebra añadió los suyos); `tests/cron-calendly-ghl.test.mjs` fija los
invariantes (auth CRON_SECRET, config por subcuenta, idempotencia, no-colisión de horarios,
GHL prohibido en el cron, una sola implementación).

## Estado (2026-09-21)

`main` al día, sin PRs abiertos ni ramas de trabajo vivas.
**582 tests, 579 pasan, 0 fallan** (3 se auto-saltan sin credenciales y sí corren en CI) ·
**666 de métricas, todos pasan** · `typecheck` exit 0 · 68 migraciones.

### Fases

| Fase | Entregable                                                                                                                                                            | Estado                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| S0.1 | `docs/S0-1-INVENTARIO-CAPACIDADES.md`                                                                                                                                 | cerrada                               |
| S0.2 | `docs/S0-2-JOURNEYS-CRITICOS.md`                                                                                                                                      | cerrada                               |
| S0.3 | `tests/webhook-ghl.test.mjs`                                                                                                                                          | cerrada                               |
| A0   | `docs/A0-CIERRE-AUDITORIA.md`                                                                                                                                         | cerrada                               |
| F-1  | `tests/agente-contenido-hostil.test.mjs`, `tests/invariante-tenant-negativo.test.mjs`, `lib/seguridad/invariante-tenant.ts`, fixtures A/B, 2 migraciones de seguridad | cerrada salvo lo de Alex              |
| F6   | `docs/F6-MAPA-PII.md`, `lib/privacidad/{plan-borrado,erase-person}.ts`                                                                                                | implementada y probada; **no gradúa** |
| S0.5 | `docs/S0-5-CONSISTENCIA-DATOS.md`, `scripts/consistencia-cash.sql`                                                                                                    | cerrada                               |
| S0.8 | `docs/S0-8-GRADUACION.md` + `CAPABILITIES.md` — **S0 GRADÚA**: ningún P0 abierto, P1/P2 con dueño y fase                                                              | cerrada                               |
| S0.6 | `docs/S0-6-RENDIMIENTO-FRONTEND.md`, `scripts/rendimiento-baseline.sql` — baseline medido + el fallo de lectura ya no se pinta como 0 €                               | cerrada                               |
| S0.7 | `docs/S0-7-INTEGRACIONES.md` — baseline de las 13 integraciones + 2 arreglos de webhook                                                                               | cerrada                               |
| S0.4 | `docs/S0-4-BARRIDO.md` — 6 resueltos (1 P0 pendiente de aplicar), resto con dueño                                                                                     | cerrada salvo aplicar el P0           |

El plan completo vive en `docs/plan/`. Empieza por su README.

### Lo siguiente, en este orden

1. **Resolver lo pendiente listado abajo.**
2. **F1 en curso** (event core), por trozos:
   - **Trozo 1 (#180, fusionado):** el webhook de GHL guarda el sobre en bruto ANTES de procesar, con
     identidad estable (id de GHL o huella determinista), propiedades sin PII y cierre del sobre en
     las ocho salidas.
   - **Trozo 2:** `canonical_events` derivado del sobre al terminar (con los vínculos de contacto y
     cita ya conocidos), correcciones como hecho nuevo que apunta al original —nunca reescritura— y
     tabla `event_types` sembrada desde `lib/eventos/canonico.ts`.
   - **Trozo 3:** reprocesado (`lib/eventos/replay.ts` + `POST /api/[tenant]/evergreen/eventos/replay`).
     Simula por defecto (hay que pedir `simulacion: false` a propósito), es reanudable por cursor
     `(received_at, id)`, idempotente, no toca el sobre y no reasigna contacto ni cita. Acceso:
     admin/director o `Bearer CRON_SECRET`.
   - **Trozo 4:** Stripe por el mismo camino. Su webhook ya guardaba el sobre; ahora deriva el hecho
     conservando la clase que decide `lib/stripe/webhook.ts` (de los tres eventos por pago, solo uno
     es dinero). **No escribe en `collections`: la semántica financiera no cambia.**
   - `event_types` **aplicada** el 23-sep con los 10 tipos (5 de GHL, 5 de Stripe).
   - **Falta para graduar F1:** evidencia de convergencia con datos reales (hoy 0 sobres de GHL: el
     último evento entró el 22-sep a las 08:09, antes del despliegue) y el shadow/compare del cutover.
3. **S0 CERRADA** (tramos 1 y 2). Acta en `docs/S0-8-GRADUACION.md`; estado por área en
   `CAPABILITIES.md`. Ledger P0–P4 consolidado ahí: ningún P0 abierto.
4. **F1 — event core.** Es donde van tres cosas ya diagnosticadas: el webhook de GHL no escribe capa
   raw (sin replay), un contacto sin nombre tumba el lote entero de GHL (`23502`), y `raw_events` no
   permite localizar a una persona (bloquea el borrado de F6).

### Por qué F6 no gradúa

Dos motivos, ninguno es código:

- Las tres decisiones de retención (`docs/F6-MAPA-PII.md` §7): raw, transcripciones y hechos
  financieros. Son de negocio y base legal.
- **`raw_events` no tiene `contact_id`** ni forma de localizar los payloads de una persona. No es
  una decisión pendiente: es una limitación real que decidir la retención NO desbloquea. **Requisito
  para F1**: cuando el webhook de GHL escriba en la capa raw, debe dejar los payloads localizables
  por persona.

### Migraciones escritas y NO aplicadas

El plan prohíbe que un agente toque producción por su cuenta. Espera confirmación:

- ~~P0 del RAG~~ **APLICADA el 2026-09-21** con aprobación de Alex, como
  `20260921172046_s0_4_match_knowledge_chunks_gate_subcuenta.sql` (renombrada a su versión real).
  Verificado: las 3 firmas sin EXECUTE para `anon`; la de 6 argumentos exige pertenencia.
- `20260921100000_f6_fathom_match_review_contact_id.sql` — vincula 69 de 177 filas de
  `fathom_match_review` a su contacto. Las otras 108 son correos de personas que no son contactos:
  ningún borrado por `contact_id` las alcanza, y `erase_person` las cubre borrando por correo.

`contacts.lifecycle` **ya está en producción** (PR #115, nullable TEXT sin constraint). Se eliminó
la migración duplicada `20260921110000_f6_contacts_lifecycle.sql`, que la declaraba
`NOT NULL DEFAULT 'identified'` con CHECK: habría dejado el repo con una restricción que producción
no tiene. **Deuda para F7**: `docs/plan/01-arquitectura-datos.md` §3 quiere el enum completo y
`NOT NULL`; endurecerla exige backfill de las 996 filas vivas.

### Dos fallos míos que encontró el gate de columnas fantasma (PR #115)

Se anotan porque la lección vale más que el arreglo: **escribí contra columnas que no comprobé**.

- El audit de `erase_person` usaba `entity` y `metadata`; las columnas reales son `entity_type` y
  `new_values`. El insert habría fallado en el primer borrado real.
- `contacts.lifecycle` no existía cuando el ejecutor ya la escribía.

La regla de `CLAUDE.md` —"BD antes que código: consulta el MCP de Supabase, no infieras el esquema
leyendo código"— existe exactamente para esto, y no la seguí. El auditor de columnas fantasma lo
cazó; conviene no gastar esa red dos veces.

### Incidencias abiertas

- **Agenda (22-sep, con GHL ya en uso).** Arreglados dos fallos y un backfill:
  1. La traducción de estados de GHL estaba duplicada (webhook y cron) y se había separado: la del
     cron no normalizaba separadores, así que `no-show` se guardaba como `scheduled`, e `invalid`
     también. Ahora es una sola función (`lib/appointments/status.ts`).
  2. Nadie marcaba la asistencia al llegar la grabación de Fathom: **107 citas grabadas y solo 3
     marcadas**. Ahora el emparejado marca `show` si la cita está sin resolver (nunca pisa un
     `no_show` ni una cancelada) y se hizo el backfill: **99 citas marcadas**, shows 3 → 102, tasa de
     asistencia de 30 días **28,4 %**. Las 8 grabaciones sobre citas canceladas se dejaron intactas.
  3. **Marcado provisional (decisión de Alex, 22-sep, SOLO esta vez y sin automatizar):** las **249**
     citas pasadas que seguían en `scheduled`/`confirmed` se marcaron como `show`. Cada una lleva en
     `notes` "PENDIENTE de que el closer confirme si asistió o no" y su fila en `audit_logs`
     (`origen` = `2026-09-22: marcado provisional…`), así que se puede revertir o listar. **No se
     tocaron** las 17 futuras, las 225 canceladas ni ningún `no_show`.
     ⚠️ **La tasa de asistencia deja de ser fiable hasta que los closers revisen esas 249**: hoy
     figuran 351 asistidas, de las cuales 249 son provisionales. Para saber cuáles son:
     `select id from appointments where notes like '%PENDIENTE de que el closer confirme%'`.
  - **Queda:** citas pasadas sin grabación cuyo resultado real nadie ha confirmado (ver punto 3) y
    **ninguna cita de GHL trae setter** — depende de que GHL mande UTMs (bloqueo de Alex).
  - **Ojo:** 362 de 968 contactos de GHL no tienen ni correo ni teléfono (335 son de la importación
    del 12-sep, pero sigue pasando: 10 de 19 el 21-sep). Sin ninguno de los dos no se pueden
    deduplicar ni enlazar con pagos: hay 26 nombres repetidos entre ellos. Va a F1.

- **Instagram: token caducado el 14-sep** (26 ejecuciones en error). **Meta: cuenta publicitaria no
  reconocida** en 22 de 52 ejecuciones. Las dos dependen de que Alex reconecte. Detalle y resto de
  hallazgos en `docs/S0-7-INTEGRACIONES.md`.
- **GHL: un contacto sin nombre tumba el lote entero** de la sincronización (`23502` sobre
  `contacts.full_name`, 5 ejecuciones). Va a F1, que rehace esa ingesta.

- **12 pagos de Stripe sin cobro registrado: 5.095,41 €** — **CAUSA ENCONTRADA (S0.4, 2026-09-21)**.
  No es el sync (funciona: 69 pagos leídos a diario por GitHub Actions). El cobro de Stripe se
  registra A MANO y por lotes (mediana: 33 días de retraso; último lote 14-sep), y el único aviso
  existente (`pago_stripe_sin_venta`) mira CLIENTES, no pagos: se le escapaban las **cuotas de
  quien ya tiene venta** (748,50 y 332,83 repetidos) y los **pagos sin cliente en Stripe** (los
  cinco de 50 €). Arreglo: controles `pago_stripe_sin_cobro` y `cobro_de_pago_devuelto` en Ajustes ›
  Salud de datos, que dicen a dónde ir en cada caso. Además el sync guardaba el correo solo de
  `receipt_email` (vacío en los 59): ahora cae al de facturación (resincronizado: ya tienen correo).

  **Registro de los 12 — HECHO el 2026-09-21** con aprobación de Alex (incluido el de julio). Una
  transacción; cada fila lleva la nota `S0.4 2026-09-21`. Resultado verificado: **0 pagos sin cobro;
  Stripe 27.029,46 € = cobros de esos pagos 27.029,46 €**. 8 ventas nuevas, 2 cobros añadidos a
  ventas existentes (2.ª cuota de un 1997/6; julio a la venta 1497/4 de la misma clienta), 4
  contactos nuevos, plan nuevo `WDC — Reserva (50 €)` (método `reserva`) para las 3 reservas sueltas.
  Precio por fecha: 1497 € hasta julio, 1997 € desde agosto.

  **Comisiones**: las genera el motor en código (`reconcileSaleCommissions`), no la base.
  `sales/reconcile-all` acepta ahora `{ saleIds }` y hay un workflow manual
  (`reparar-comisiones.yml`) para lanzarlo sobre ventas concretas sin tocar el resto.
  **Lanzado el 2026-09-21** sobre las 10 ventas afectadas: 18 comisiones pendientes para los 12
  cobros (closer 12 = 480,18 €; colaborador 6 = 249,64 €), 0 duplicadas, 0 cobros sin comisión.
  Ojo: ya existían antes de lanzarlo (algo las generó tras el registro; total de la subcuenta 91
  antes y después) y la reparación las rehízo idénticas. Si alguien sabe qué proceso fue, anótelo.

- **Un cobro de 50 € contra un pago que Stripe devolvió**, con `refunds` a 0 filas: el camino de
  devolución no está cerrado.
- **GHL**: el webhook YA FUNCIONA (contacto de prueba recibido el 21-sep a las 13:56). Falta
  confirmar que entran CITAS: el workflow de prueba era de contacto y no traía datos de agenda.

### Cambios de identidad aplicados en producción (2026-09-21)

- La app se llama **GrowthOps**, en una palabra.
- La subcuenta de Scalix: slug `evergreen` → **`scalix`**, nombre → **Scalix Systems**.
  Su URL es `https://app.scalixsystems.com/scalix/login`. No tiene ni debe tener credenciales
  propias: es la plataforma. Todas las integraciones (23 claves) viven en `women-digital-closer`.
- `RESEND_FROM` a nivel de plataforma: `GrowthOps <soporte@scalixsystems.com>`. WDC conserva el suyo.
- **No se ha renombrado** el segmento literal `evergreen` de las 168 rutas de API: está dentro de la
  URL del webhook de WDC. Va antes de F8, con las rutas nuevas conviviendo con las viejas.

### Lo que NO hay que volver a auditar

Verificado y cerrado. Repetirlo es trabajo perdido:

- Cash: cuando un cobro se registra, se registra bien — 0 desvíos de importe en los 47 pares
  conciliados, 0 referencias duplicadas, 0 comisiones huérfanas (`docs/S0-5-CONSISTENCIA-DATOS.md`).
- Aislamiento: `requireTenant()` en 149 de 168 rutas; las 19 restantes son legítimamente sin sesión.
- El esquema vivo cumple el invariante entero: 107 tablas, todas con RLS y al menos una política.
  Las únicas 5 sin `tenant_id` están declaradas en `lib/seguridad/invariante-tenant.ts`.
- El RAG contiene **solo** skills de plataforma, no PII. La línea roja de F6 no se ha cruzado.
- Los crons no se solapan: 2 en Vercel, 8 en GitHub Actions.
- El linaje huérfano de `~/GIT HUB/Growth-Ops-App` se repuntó y sus 20 ramas se borraron tras
  verificar por `patch-id` y por contenido que todo estaba en `main`. Queda
  `rescate/linaje-viejo-20260913` como red de seguridad; se puede borrar.

### Bloqueos que dependen de Alex

Solo lo que ningún agente puede hacer:

| Bloqueo                                                                                          | Bloquea                 |
| ------------------------------------------------------------------------------------------------ | ----------------------- |
| Rotar `RESEND_API_KEY` (guardada como valor legible en Vercel) y confirmar Google, GHL y staging | Graduación de F-1       |
| Activar leaked-password protection en Supabase Auth                                              | Graduación de F-1       |
| Decidir retención de raw, transcripciones y hechos financieros                                   | Graduación de F6        |
| Configurar UTMs y `source` en el webhook de GHL (`contact_attributions` a 0)                     | F7 y F4 de raíz         |
| Reconectar el token de Meta de WDC (`#10 Application does not have permission`)                  | Sync de Meta            |
| Rellenar los `[definir]` de la etapa A (`docs/plan/00-constitucion.md` §2)                       | Arranque de F1          |
| Comprobar que `https://app.scalixsystems.com` está en Supabase → Auth → URL Configuration        | Enlaces de recuperación |
| Commitear el WIP del checkout de `~/Documents` y retirarlo                                       | Carpeta única           |
| Configurar Bunny en Integraciones › Bunny Stream (guía en la propia pantalla)                    | Subida de VSL           |

Puedo hacer, con su visto bueno: poner el repo privado, borrar el proyecto `go-prod` de Vercel
(vacío), crear `CRON_SECRET` en Preview, borrar la rama de rescate.

---

## Histórico

Las entradas por hebra anteriores al 2026-09-21 se han compactado. El detalle está en el historial
de git (`git log --follow docs/ACTIVE_HANDOFF.md`) y, sobre todo, en los documentos y tests que
produjeron, que son la memoria durable.

Resumen de lo que cubrían: barrido data-viz con tokens de diseño en Recharts (19-sep) · base neta
de comisión de pasarela (19-sep) · copy del embudo de analítica (16-sep) · filtros de fecha
unificados, embudo de ventas e Instagram (15-sep) · endurecimiento multi-tenant e invitaciones
(15-sep) · observabilidad de navegador y cascada de sesión (15-sep) · brief de
Integraciones/Stripe/Métricas/Funnels (14-sep) · barridos de bugs (13 y 14-sep).

Dos lecciones operativas de esas hebras que siguen vigentes:

- **CI usa `cancel-in-progress`**: un run "cancelled" no es un fallo. Valida el ÚLTIMO commit con
  `gh run list --commit <sha>`, no el precedente.
- **No afirmes lo que no has verificado.** Se construyó un panel manual de crons sobre la creencia
  falsa de que Vercel Hobby solo permitía 3, y se recortó CI sobre la creencia falsa de que el repo
  era privado. Las dos premisas eran inventadas.

Tres más del 25-sep (codificadas también en `AGENTS.md`, con el caso que las originó):

- **Arnés canónico o nada**: suites solo por los scripts de `package.json`. Lanzar specs de
  Playwright o `tests/metrics/` con `node --test` a mano produce fallos falsos — el 25-sep costó
  dos diagnósticos equivocados antes de mirar el arnés.
- **Sin merge-base no hay merge**: la PR #210 (rama `docs/money-v1-cierre`) era un linaje huérfano.
  Se cerró como sustituida tras verificar commit a commit que su único contenido exclusivo era el
  texto de relevo (relevado en #216). Fusionarla habría revertido el tablero.
- **La fila del tablero es un contrato de relevo**: el trabajo sin commitear de esta hebra (fix E2E
  - cron) fue recogido, commitado y publicado por otro agente siguiendo la fila — así funciona el
    tablero cuando funciona; si un trabajo no debe continuarse, no se deja sin commitear.

### Correcciones de auditoría: Correo, Drops, Documentos y Apify — 2026-09-26

**Estado FINAL (26-sep): entregado y fusionado en `main` vía PR #233 (merge `ae98914`); CI del merge SUCCESS (run 36256579445) y `npm run quality` re-verificado PASS sobre `main` fusionada; rama borrada en remoto y local.** No se ejecutaron migraciones ni se consultó/escribió producción.

- **Correo:** las rutas de configuración, plantillas, historial, detalle y envío de prueba exigen rol funcional de gestión (`admin`, `director`, `manager`) ya acotado al tenant por `requireTenant`, o `super_admin` de plataforma. El control del frontend no es el permiso.
- **Drops:** las consultas/actualizaciones/alta llevan `tenant_id` explícito desde el contexto; contactos y nombres de responsables se cargan limitados a la subcuenta. La UI también informa fallos de lectura y revierte el cambio optimista si falla el update.
- **Documentos:** el handler comprueba venta y contacto dentro del tenant y rechaza discrepancia con el `contact_id` canónico de la venta antes de subir; Storage y fila de verificación derivan de ese ID canónico. Se valida tipo/nombre/base64 y límite de 10 MiB antes de reservar el buffer.
- **Apify:** errores de lectura/upsert/finalización ya no se convierten en `completed`; webhook devuelve 500 ante fallos para solicitar retry. La persistencia normalizada usa upserts y payload raw se consulta antes de insertar. Se añadió claim CAS con lease de cinco minutos para que webhooks concurrentes no procesen dos veces y un fallo deje el job reintentable. **Prueba del escenario con fallo/reintento aún por ejecutar.**
- **Prefijos de migración:** se mantienen los pares `20260919230000` y `20260921100000`; su duplicidad de nombre local no demuestra conflicto del ledger vivo. No se renombró ni aplicó DDL; verificar el ledger de Supabase de forma read-only/QA sigue pendiente.

**Validación local final (26-sep):** `npm run quality` completo PASS (exit 0) sobre los 13 ficheros modificados: `format:check` PASS, lint PASS con cinco avisos preexistentes (`<img>` en páginas instagram y dependencia de hook en ContactsAllView), typecheck integral `tsc --noEmit` PASS (653 fuentes TS/TSX, sin errores), `npm test` PASS (933 pass, 3 saltados por falta de credenciales Supabase) y `npm run test:metrics` PASS (740). `git diff --check` PASS. Tests focalizados de documentos/email/Apify: 38/38 PASS en ejecución previa al formateo final. La configuración temporal `tsconfig.audit.json` se borró tras su prueba y no está versionada.

**Bloqueo de memoria RESUELTO — causa raíz identificada (26-sep):** tsc no moría por el preview gestionado sino por un `next-server` huérfano de una gestión anterior escuchando en `:3000` (~1,7 GiB RSS, 8 h en pie); `freebuff-preview restart` recicló el preview nuevo (`:3001`, verificado sirviendo) pero no limpió el huérfano. Se terminó ÚNICAMENTE el árbol huérfano de `:3000` (SIGTERM y SIGKILL al PID confirmado como huérfano, no al preview). Además, el pico de tsc supera 2,2 GB de heap incluso con ~2,4 GB disponibles, así que se activaron 2 GB de swap dentro del contenedor (`fallocate -l 2G /swapfile; mkswap; swapon /swapfile`) y el typecheck se lanzó con `NODE_OPTIONS='--max-old-space-size=3584'`: pasó integralmente. No se cambió `tsconfig.json` ni se excluyó ruta alguna. La rama tiene base común directa con `origin/main` (`b87ab41`).

**Cierre de la unidad (26-sep):** commit del fix `b6f85d2` + relevo `7a24627`, push, PR #233, CI de PR verde (run 36255945786) y run cancelado posterior por `cancel-in-progress` (no es fallo), merge `ae98914`, CI de `main` SUCCESS (run 36256579445), `npm run quality` PASS sobre `main` fusionada, rama remota y local eliminadas, fila del tablero retirada. De los pendientes de producto, el escenario Apify con fallo/reintento quedó CERRADO el 26-sep vía PR #234 (merge `1cb7659`): congelado en `tests/apify-retry-scenario.test.mjs`, que ejecuta `processRunResults` real con un mini-DB en memoria (CAS genuino, upserts idempotentes) y `fetch` interceptado — sin red ni credenciales; CI de PR run 36263193522 success y quality PASS sobre `main` fusionada. Reserva honesta: en el run del merge sobre `main` (36263667257) quality/build/secretos pasaron y el job Smoke E2E salió CANCELADO por la cola de concurrencia `e2e-tenant-qa` ("higher priority waiting request"), no por fallo; el E2E del mismo árbol pasó en el run de la PR. La credencial gestionada de GitHub no permite `gh run rerun` ("not accessible by integration"): quien fusione a continuación o Alex debe relanzar ese job (Re-run failed jobs) o validar el E2E con el próximo push de código a `main`. Sigue pendiente además la verificación read-only del ledger de migraciones de Supabase (requiere credenciales). Nota de entorno para próximos agentes: el typecheck integral necesita >2,2 GB de heap; si el sandbox arranca sin swap, recrearlo con `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` y lanzar con `NODE_OPTIONS='--max-old-space-size=3584'` (verificado en esta sesión; no debilitar cobertura).

## En curso: bloque financiero Unit Economics

Codex, rama codex/dashboard-consistency: gastos y resultado canónico por rango, cobros por primer pago y mes de venta. Archivos pnl.ts, componente financiero y unit-economics. Sin escrituras de datos. Quality PASS (1133 unit, 3 skip; 769 métricas). Mes completo coincide con P&L anterior; filtro diario conserva fecha de comisión vinculada al cobro; comisión con fecha solo mensual impide un resultado exacto en mes parcial. Desglose del libro interno explícitamente bruto, distinto del cash consolidado Stripe. Smoke autenticado local: gastos, resultado firmado y origen de cobros visibles. Build final PASS tras endurecer la granularidad mensual de liquidation_month. Smoke final autenticado y captura visual PASS: gastos, signo del resultado, margen, desglose por mes de venta y aviso de cobertura visibles. Servidor local activo en 3100; sesión 60974. No desplegado; no certificar resultado consolidado Stripe: el resultado corresponde al libro interno.

## Ajustes de KPI y reconciliación solicitados (en curso)

Codex, misma rama/PR: Cash Collected medio por ventas del periodo, gráfico dual, filtro Marketing, asistencia deduplicada y comisiones por función registrada. Reclama dashboard principal y resumen financiero además de Unit Economics: tarjetas de Cash Collected reutilizan canonicalCash; series del dashboard usan serieCanonicaCash. P&L y gastos siguen computeMonthlyPnl; no cambia asientos. Auditoría SQL de solo lectura confirma cobros de ventas anteriores y pagos de Stripe sin referencia interna; no suponer ventas nuevas ni crear ventas para cuadrarlos. Sin publicar cifras ni datos de tenant en este repositorio público. Quality PASS (1133 unitarias, 3 skip; 771 métricas). Smoke autenticado: total Cash Collected coincide en Unit Economics, dashboard principal y resumen financiero; promedio coincide en los dos dashboards; selector Marketing cambia/restaura aria-pressed. Build final PASS; smoke final verifica Asistencia, No shows, dos tarjetas de promedio y desglose de comisiones. Servidor local 3100, sesión 94017. No declarar coherencia global de todas las rutas: persisten conciliaciones de datos, fuentes de objetivos/brief y granularidad histórica de devoluciones. Clientes fuera del alcance a petición del usuario.

## Aclaración del primer pago medio (28-sep)

El usuario aclara que Cash Collected medio debe medir la primera transacción de la venta nueva, no el cash total del periodo. Helper compartido `promedioPrimerPago` en `lib/finance/nuevo-vs-recurrente.ts`, consumido por Negocio/Ventas y dashboard principal. Historial completo de cobros, una primera transacción por venta activa del periodo, sin cuotas posteriores ni ventas antiguas; corte a fin del periodo y ausencia explícita si falta un pago o el primero es ambiguo. Documento METRICS actualizado con la definición corregida. Quality PASS (1133 unit, 3 skip; 774 métricas), build PASS y dead-code informativo. Smoke autenticado confirma que el promedio corregido coincide entre Unit Economics y dashboard principal. Local 3100 activo, sesión 19536. No cambia cobros ni cash total. Producción pendiente de PR #278.
