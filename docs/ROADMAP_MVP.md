# Hoja de ruta MVP — funnels, integraciones y aprovisionamiento

Última actualización: 2026-09-13 (Claude Code).
Sustituye a `PLAN_FUNNELS_INTEGRACIONES.md` (rama `claude/plan-funnels-integraciones`), cuyo §3.4
contenía dos recomendaciones erróneas ya corregidas aquí.

**Criterio acordado con el usuario: MVP funcional de todo antes que una sola cosa perfecta.**
Cada fase entrega algo usable de punta a punta, y se mejora después. Este documento es el sitio
donde se ve "cómo va" y "qué sigue" — parte del avance la continúa Codex, así que se mantiene al
día en cada PR.

## 1. Decisiones tomadas (usuario, 2026-09-13)

| Pregunta           | Respuesta                                                  |
| ------------------ | ---------------------------------------------------------- |
| Clarity            | Versión **limitada y honesta**: nada de simular histórico  |
| Orden              | El más eficiente — lo decide Claude Code                   |
| GA4 / Google Cloud | **No existe** proyecto OAuth todavía: hay que crearlo      |
| Buzón de facturas  | **Solo Gmail**                                             |
| Fusiones de UX     | A criterio de Claude Code                                  |
| Alcance            | **Subconjunto priorizado**, con avance visible y reportado |

## 2. Límite externo que condiciona el alcance: Microsoft Clarity

Data Export API, límites **no ampliables**: 10 peticiones por proyecto y día, solo los últimos 1–3
días de datos, 1.000 filas y 3 dimensiones por petición; métricas Traffic, Engagement Time y Scroll
Depth. Sin histórico y con 10 llamadas al día no hay sync incremental, ni backfill, ni series
temporales, ni cruce por landing con leads y ventas.

Consecuencia: **Clarity no alimenta Funnels.** Lo que sí se hará (decisión del usuario: versión
limitada y honesta):

- Instalación del script por subcuenta (grabaciones y heatmaps se ven en el panel de Clarity).
- Widget de solo lectura con los últimos 1–3 días, con su límite escrito en pantalla.
- En Funnels, Clarity aparece como **"fuente no apta para histórico"**, nunca como 0.

GA4 sí sirve: rango de fechas arbitrario, dimensiones de source/medium/campaign/landing/dispositivo
y eventos de conversión. Es la fuente correcta para Web/SEO.

## 3. Estado y orden de ejecución

Leyenda: ✅ hecho · 🚧 en curso · ⛔ bloqueado por el usuario · ⬜ pendiente

| #   | Fase                                          | Estado | Nota                                                       |
| --- | --------------------------------------------- | ------ | ---------------------------------------------------------- |
| A   | Desbloquear PR #30                            | ⛔     | Requiere acción del usuario (ver §5)                       |
| B   | Reordenación de navegación y Configuración    | ✅     | Commit `f4f028a`                                           |
| C   | Capa canónica de funnels (sin UI)             | ⬜     | Siguiente. No necesita credenciales                        |
| E   | Sección Funnels con lo que ya hay en base     | ⬜     | MVP sin GA4: VSL, Webinar y Profile ya tienen datos        |
| F   | CRM → Agenda, detalle de cita legible, Fathom | ⬜     | Mejora diaria, barata                                      |
| D   | GA4 (OAuth multi-tenant)                      | ⛔     | Bloqueada: hay que crear el proyecto de Google Cloud       |
| G   | Banco de testimonios y de grabaciones         | ⬜     |                                                            |
| H   | Facturas por email (**solo Gmail**)           | ⬜     | También necesita el proyecto de Google Cloud               |
| I   | Backfill de Stripe y diagnóstico de Meta      | ⬜     | Empieza por dry-run, sin escribir                          |
| J   | Aprovisionamiento                             | ⬜     | Al final: el blueprint solo puede incluir lo que ya existe |

**Por qué este orden y no el del plan original:** D (GA4) estaba antes de E (UI de Funnels), pero
GA4 está bloqueada por una acción del usuario en Google Cloud. Hacer C+E primero entrega una
sección de Funnels **funcionando con las fuentes que ya tienen datos en base** (VSL, webinar,
perfil), y GA4 entra después como una fuente más cuando exista el proyecto OAuth. Así el MVP no
depende de un bloqueo externo.

## 4. Regla que aplica a todas las fases

Una métrica nunca colapsa a 0 por un fallo de fuente. El tipo canónico es
`{ value, status: 'ok' | 'sin_datos' | 'error_fuente', source, lastSync }`, y la UI distingue los
tres casos. Es la misma lección que ya costó un falso "0 filas" en la cobertura de datos del agente.

Y: ninguna integración se marca como lista si solo existe la interfaz; ningún dato simulado se
presenta como real; ningún DDL fuera de migraciones versionadas; aislamiento por `tenant_id` y RLS
en todo lo nuevo.

## 5. Bloqueado esperando al usuario

1. Aplicar dos migraciones ya escritas y revisadas:
   `20260913100000_storage_tenant_policies.sql` y `20260913110000_partners_profit_guard.sql`.
   (El MCP de Supabase de esta sesión necesita reautenticación, así que no puedo aplicarlas yo.)
2. Confirmar la reparación del historial de migraciones — ver `MIGRATION_RECONCILIATION.md`.
3. Crear el proyecto de Google Cloud con pantalla de consentimiento OAuth (desbloquea D y H).

Sin 1 y 2, cualquier migración nueva se apila sobre un historial ya inconsistente.

## 6. Revisión de UX: qué se hizo y qué se descartó

Hecho en la fase B (commit `f4f028a`):

- El bloque "Negocio" sale de Integraciones y se fusiona en **Datos de empresa**. No es una
  integración: no hay credencial ni conexión que probar. La persistencia no cambió.
- **Fuera la barra de pestañas** de Configuración: Integraciones y Data Health son dos tarjetas más
  de la rejilla. Un solo nivel de navegación.
- **Auditoría** baja del primer nivel a Configuración. No se borra: es la única trazabilidad de
  quién tocó una venta, un cobro, una cita o una comisión.

Descartado, y por qué — dos de estas eran errores míos, por haber leído el listado de directorios
en vez del mapa de navegación real:

| Propuesta original                      | Veredicto                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Mover `pnl` dentro de Finanzas          | **Ya estaba hecho.** `/pnl` es un stub que redirige a Finanzas                                                                  |
| Fusionar `cohorts`                      | **Ya estaba hecho.** `/cohorts` redirige a Finanzas › Analítica                                                                 |
| Fusionar `analitica` + `unit-economics` | **No.** Embudo/ranking de ventas y unit economics no son la misma pregunta                                                      |
| Fusionar `kpi` con `dashboard`          | **No hay nada que fusionar.** `kpi` no es una sección: su única pantalla es el editor de plantillas, ya dentro de Configuración |

No se toca `drops`, `csm-events`, `students`, `recursos`, `tasks`, `instagram` ni `setting-ai`:
fusionarlas sin datos de uso sería peor que dejarlas.
