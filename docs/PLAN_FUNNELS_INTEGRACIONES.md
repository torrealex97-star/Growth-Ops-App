# Plan por fases — Funnels, integraciones y aprovisionamiento

Estado: **propuesta, nada implementado todavía.** Redactado tras la investigación obligatoria
(AGENTS.md, relevo, rama/PR actual, arquitectura existente y documentación vigente de las APIs).

## 0. Punto de partida real

- Rama activa: `claude/financial-constraints-handoff` (PR #30, correcciones de seguridad).
  Árbol limpio, sin cambios sin commitear.
- PR #31 abierto: fondo animado WebGL, separado de #30 a propósito.
- **#30 sigue bloqueado** por dos acciones del usuario: aplicar dos migraciones y confirmar la
  reparación del historial (`docs/MIGRATION_RECONCILIATION.md`).
- No existe ni una línea de GA4 ni de Clarity en el repo: esto es terreno virgen, no un arreglo.
- Sí existe base reutilizable: `lib/ads/funnel.ts` (fórmulas canónicas), `docs/METRICS.md`,
  `lib/vsl/` + `lib/tracking.ts` (eventos de VSL), `lib/analytics.ts` (`isActiveSale`).

## 1. Hallazgo que cambia el alcance: la API de Microsoft Clarity no sirve para funnels

Límites vigentes de la Data Export API, **no ampliables** (confirmado en la documentación oficial y
en el hilo de soporte de Microsoft):

| Límite                        | Valor                                  |
| ----------------------------- | -------------------------------------- |
| Peticiones por proyecto y día | **10**                                 |
| Antigüedad de los datos       | **solo los últimos 1–3 días**          |
| Filas por petición            | 1.000                                  |
| Dimensiones por petición      | 3                                      |
| Métricas                      | Traffic, Engagement Time, Scroll Depth |

Consecuencia honesta: **Clarity no puede alimentar la sección de Funnels.** Sin histórico y con 10
llamadas al día no hay sincronización incremental, ni backfill, ni series temporales, ni cruce por
landing con leads y ventas. Construir esa integración "completa" sería vender humo.

Lo que sí se puede ofrecer, y es lo que propongo:

- Instalación del script de Clarity por subcuenta (grabaciones y heatmaps en el panel de Clarity).
- Un widget de solo lectura con Traffic / Engagement Time / Scroll Depth de los últimos 1–3 días,
  con su límite escrito en pantalla.
- En la sección de Funnels, Clarity aparece como **"fuente no apta para histórico"**, no como cero.

GA4 sí sirve: la Data API permite rango de fechas arbitrario, dimensiones de source/medium/campaign/
landing/dispositivo y eventos de conversión. Es la fuente correcta para Web/SEO y para las visitas.

## 2. Fases propuestas

Cada fase es un PR independiente y desplegable. El orden está elegido para que ninguna dependa de
algo que todavía no exista.

### Fase A — Desbloquear #30 (no es trabajo nuevo)

Aplicar las dos migraciones pendientes y reparar el historial. Sin esto, cualquier migración nueva
de las fases siguientes se apila sobre un historial ya inconsistente.

### Fase B — Reordenación de navegación y Configuración

Barata, sin riesgo, y mejora la base sobre la que se añaden pantallas nuevas. Detalle en §3.

### Fase C — Capa canónica de funnels (sin UI)

`lib/funnels/` con la definición de las cuatro familias (VSL, Webinar, Profile, Web/SEO) y **una
sola** implementación de cada métrica, extendiendo `lib/ads/funnel.ts` en vez de duplicarlo.
Incluye el tipo `MetricValue = { value, status: 'ok' | 'sin_datos' | 'error_fuente', source, lastSync }`
para que un error de fuente nunca pueda colapsar a 0. Tests de denominadores y de aislamiento.

### Fase D — Integración GA4 (OAuth multi-tenant)

Tabla de conexiones por tenant con tokens cifrados, scopes mínimos (`analytics.readonly`),
refresh seguro, selección de propiedad, sync incremental con cursor, backfill por rango y estado
(último éxito, último error, filas importadas). Normalización de source/medium/campaign/landing/
dispositivo/eventos.

### Fase E — Sección Funnels (UI)

Consume C y D. Filtros, comparación con periodo anterior, desglose por etapa, y "abrir los registros
que componen la métrica" (drill-down al CRM filtrado).

### Fase F — CRM → Agenda + detalle de cita legible + Fathom

Redirección canónica server-side de `/crm` a `/crm/agendas`. Respuestas de formulario con etiquetas
legibles (payload crudo solo para super_admin y fuera de la UI normal). Matching determinista de
Fathom por identificador externo, con fallback email + ventana temporal y **cola de revisión** para
los ambiguos. Reconciliación histórica idempotente con dry-run.

### Fase G — Banco de testimonios y banco de grabaciones

Bulk upload con progreso y reintento, categoría por MIME (no IA), dedupe por hash, Storage privado
bajo `tenant_id/`, estados con aprobación manual. Clasificación de llamadas ganada/perdida/pendiente
**derivada de datos canónicos**, nunca de la IA por sí sola.

### Fase H — Facturas por email (Gmail / Microsoft Graph)

OAuth con scopes mínimos de solo lectura, dedupe por `provider + messageId + attachmentId + hash`,
Storage privado, extracción a estado `pendiente_validacion`. Nada entra en contabilidad solo.

### Fase I — Backfill de Stripe y diagnóstico de Meta

Stripe: dry-run primero, con el informe de conciliación que pides. Regla clave ya acordada: cliente
sin pagos exitosos **no es venta**. Idempotencia por identificadores externos + índices únicos.
Meta: pantalla de salud de sincronización y dry-run para encontrar la causa real, sin asumirla.

### Fase J — Aprovisionamiento

Ampliar el blueprint para que todo lo anterior nazca configurado y vacío en cada subcuenta nueva.
Va al final a propósito: el blueprint solo puede incluir lo que ya existe.

## 3. Reordenación de UX propuesta (lo que pediste revisar)

### 3.1 Sacar "info de negocio" de Integraciones — de acuerdo, y con matiz

El bloque `negocio` de Integraciones no es una integración: son **datos públicos de marca y assets
(logos)**. Ya existe `Configuración → Datos de empresa`, cuya descripción es literalmente "Datos que
se mapean en contratos y emails". Propongo **fusionarlo ahí**, no crear una pantalla nueva: si no,
quedan dos sitios distintos para los datos de la misma empresa.

### 3.2 Integraciones y Data Health dejan de ser pestañas

Hoy `SettingsNav` pinta General / Integraciones / Data Health como pestañas por encima de la rejilla
de Configuración, lo que crea dos niveles de navegación para lo mismo. Pasan a ser **dos tarjetas
más** de la rejilla, y se elimina `SettingsNav`. Un solo nivel, como el resto.

### 3.3 Auditoría: tiene sentido, pero no como sección de primer nivel

`/audit` es el registro forense de cambios sobre ventas, cobros, reembolsos, citas, contactos,
comisiones y usuarios. Es la **única** trazabilidad de quién tocó un dato financiero, así que
borrarla sería un error. Pero es una pantalla de consulta puntual y solo para admin/director: no
merece un hueco permanente en la navegación principal. **Propuesta: moverla a Configuración**
(gobernanza), no eliminarla.

### 3.4 Otras fusiones que recomiendo

| Hoy                                      | Propuesta                             | Motivo                                                                        |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `analitica`, `cohorts`, `unit-economics` | Una sola **Analítica** con pestañas   | Tres sitios para responder a la misma pregunta; el usuario no sabe cuál abrir |
| `pnl`                                    | Dentro de **Finanzas**                | El P&L es finanzas, no una sección hermana                                    |
| `audit`                                  | Dentro de **Configuración**           | Ver 3.3                                                                       |
| `kpi` y `dashboard`                      | Revisar solapamiento antes de decidir | Ambas son "cómo va el negocio"; hay que ver datos de uso antes de fusionar    |

No propongo tocar `drops`, `csm-events`, `students`, `recursos`, `tasks`, `instagram` ni `setting-ai`
sin antes mirar uso real: no conozco su frecuencia de uso y fusionarlas a ciegas sería peor.

## 4. Decisiones que necesito de ti

1. **Clarity**: ¿acepto la integración limitada y honesta descrita en §1, o la dejo fuera del alcance
   hasta que Microsoft amplíe la API?
2. **Orden**: ¿empiezo por B (navegación, barata y visible) o directamente por C+D+E (Funnels, que es
   el grueso de valor pero tarda más en verse)?
3. **GA4**: ¿hay ya un proyecto de Google Cloud con pantalla de consentimiento OAuth, o hay que
   crearlo? Sin eso no se puede probar la conexión de verdad.
4. **Buzón de facturas**: ¿Gmail, Microsoft 365 o ambos? Cada uno es un OAuth y un modelo de
   sincronización distinto; hacer los dos a la vez duplica la fase H.
5. **Fusiones de UX de §3.4**: ¿te valen las cuatro, o prefieres que toque solo las tres primeras y
   deje `kpi`/`dashboard` como están?
6. **Alcance realista**: esto son nueve fases. ¿Las quieres todas en secuencia, o prefieres que
   priorice un subconjunto para tener valor antes?

## 5. Lo que no voy a hacer sin decírtelo

- Ninguna escritura en producción ni merge sin tu autorización.
- Ninguna integración marcada como "lista" si solo existe la interfaz.
- Ningún dato simulado presentado como real.
- Ningún DDL fuera de migraciones versionadas.
