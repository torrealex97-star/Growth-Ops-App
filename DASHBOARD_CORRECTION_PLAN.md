# Plan de corrección de dashboards

Fecha: 2026-09-25. Estado: propuesta basada en evidencia; auditoría browser/roles todavía abierta. Referencias F01–F23: [DASHBOARD_AUDIT.md](DASHBOARD_AUDIT.md). No se han aplicado cambios de datos ni RLS en producción.

## P0 — proteger acceso antes de ampliar analítica

### P0.1 — F01: colaborador / CRM / ventas / Stripe

- **Métrica/pantalla:** todos los hechos personales y financieros accesibles por colaborador.
- **Problema/causa:** scope team y políticas permisivas conceden lectura ajena, aunque UI filtre.
- **Evidencia:** lectura autenticada en transacción con rollback: ventas visibles superiores a propias; acceso a pagos y citas de equipo. Política Stripe usa helper global de dirección.
- **Fix:** autorización por pertenencia/rol del tenant seleccionado; colaborador restringido por relación de atribución; Stripe accesible solo al rol financiero autorizado o agregado propio validado. Revisar todas las políticas permisivas juntas y preservar política restrictiva multitenant.
- **Dependencia:** coordinar carril seguridad con Claude Code. La regla solo propio ya la fijó el usuario: no volver a pedir permiso conceptual. Precisar relaciones de atribución ambiguas antes de backfill.
- **Tipo/alcance:** AUTO_FIX, migración RLS y tests de contrato por rol, alcance medio/alto. No modificar data_scope para ocultar el defecto como solución única.
- **Verificación:** dry-run BEGIN/ROLLBACK obligatorio; admin tenant A/B, miembro multitenant, colaborador con/sin atribución, usuario externo, anon, endpoints y consultas directas. Ninguna fila ajena ni conteo agregado privilegiado. Aplicación con historial de migración registrado y lectura posterior.

### P0.2 — F02: Funnels/VSL

- **Problema/causa:** requireTenant valida pertenencia, no autorización del agregado; consultas privilegiadas eluden RLS.
- **Fix:** gate de rol explícito o agregado realmente personal; minimizar datos de leads devueltos. No basta ocultar sidebar.
- **Dependencia:** P0.1 y contrato de visibilidad del módulo.
- **Tipo/alcance:** AUTO_FIX; dos endpoints y pruebas HTTP; pequeño/medio.
- **Verificación:** admin permitido; colaborador solo propio o 403 según módulo; otro tenant/anon denegado; no nombres/emails extra en respuesta.

## P1 — integridad de cifras y decisiones

| Orden / pantalla / métrica | Problema y causa | Evidencia | Fix | Dependencia | Tipo / alcance | Verificación |
|---|---|---|---|---|---|---|
| 1. Reservas en dashboard/finanzas/AI/funnels; ventas/ticket/CAC | exclusión aplicada solo a agregados | F03 C,D,R | reutilizar predicado canónico D8 y traer estado de reserva | preservar motor de comisiones de otros agentes | AUTO_FIX; varios consumidores, medio | reserva abierta=0 ventas; completada=1; mismo resultado UI/AI/export |
| 2. Cash por moneda; unit-economics | suma sin moneda/FX | F04 C,D,R | transportar currency; evitar total base si conversión desconocida; desglose por moneda | MONEY D2, proveedor FX pendiente | AUTO_FIX para unknown; BUSINESS_DECISION FX; medio | EUR y USD nunca sumados a paridad; prueba redondeo y fecha |
| 3. Cash/refunds entre módulos | fuentes, estado y fecha refund distintos | F05 C,D,R | conciliación por payment_reference; refund por ocurrencia; manual deduplicado; estado elegible | resolver modo bruto/atribuible y FX; no inventar mapping | AUTO_FIX + BUSINESS_DECISION; medio/alto | pago viejo+refund nuevo, duplicado Stripe/manual, pendiente, contracargo; suma por referencia |
| 4. Dashboard; periodo/cash/variación | prefiltrado elimina mes previo y pagos de ventas viejas | F06 C | separar población autorizada de ventana de cada hecho; comparación equivalente; agregar todo rango | contrato actividad/cash ya documentado; browser pendiente | AUTO_FIX; página+helpers, medio | venta mes A cobro mes B; mes actual parcial; rango dos meses; role/persona iguales |
| 5. Funnels; conversión | tráfico de familia vs CRM global | F07 C,D | actividad operacional explícita; cohorte enlazada solo donde hay IDs; sin atribuir visible | mappings reales de campaña/contacto/cita/venta | AUTO_FIX + USER_ACTION; medio | total=atribuido+sin atribuir; n/N trazable; cohortes inmaduras no finales |
| 6. Brief/alertas; KPI health | benchmark previo a siete gates; capacidad semanal vs periodo arbitrario | F08 C,D | evaluador de elegibilidad antes del diagnóstico; devolver motivo UNKNOWN; normalizar periodo | definiciones ya presentes; umbral contextual configurable | AUTO_FIX; capa métricas+UI+AI, medio | fuente incompleta/madurez/asignación pendiente no genera OUTSIDE KPI; benchmark no altera datos |
| 7. Cohortes; clientes/recuperación | ventas contadas como clientes, ventanas inmaduras, universos distintos | F09 C | únicos o renombrar ventas según intención; N/A hasta madurez; conjunto común | confirmar grano cliente vs venta; MONEY | AUTO_FIX + BUSINESS_DECISION grano; medio | cliente con dos ventas; cancelada; días 29/30/59/60; refund posterior |
| 8. Ask/AI; resumen periodo | acumulados campaña filtrados por inicio | F10 C | usar hechos diarios y capa semántica común; declarar cobertura/límites | P1 anteriores | AUTO_FIX; tools+contratos, medio | mismo tenant/periodo devuelve igualdad con UI/API/export |
| 9. Finanzas/socios; beneficio | errores de consulta tratados como vacío | F13 C | propagar partial/error, bloquear cifra financiera engañosa; paginar si necesario | no editar área gastos activa sin coordinación | AUTO_FIX; varios loaders, medio | fallo de una fuente no publica beneficio/reparto completo; filas más allá de límite |

## P2 — calidad, asignación y workflows

| Orden / pantalla / métrica | Problema y causa | Evidencia | Fix | Dependencia | Tipo / alcance | Verificación |
|---|---|---|---|---|---|---|
| 1. Setter/Closer/CRM | asignaciones y enlace venta-cita ausentes; asistencia provisional | F11 D | cola de mapping con fuente e ID; backfill aprobado e idempotente; historial | dueño real y evidencia del usuario | USER_ACTION + AUTO_FIX posterior; medio | ningún propietario inferido; auditoría antes/después; totales operativos conservados |
| 2. Integraciones/Data Health | no existe inicio esperado acreditado; logs por job distintos | F12 D | matriz cuenta/fuente/fecha esperada/desde/hasta/lag/backfill; freshness por job | export o ventana contratada | USER_ACTION + AUTO_FIX; medio | reconciliar proveedor vs importado por día; no confundir cero con falta |
| 3. VSL/Organic | fuentes sin sesiones/DMs y limitaciones de API | F12 C,D | instrumentación validada, consentimiento/permisos y estados sin dato | acceso proveedor si se requiere | EXTERNAL_BLOCKER + AUTO_FIX diagnóstico | prueba real play→CTA→contacto sin inventar conversiones; QoE separado |
| 4. Todas; fecha | UTC/local y ventanas inclusivas | F14 C | fronteras semiabiertas timezone negocio, presets con contrato | timezone del tenant; sin asumir multi-zona | AUTO_FIX; helper y consumidores, medio | cambio horario, medianoche, fracciones, rango 7 días exacto |
| 5. Proyección/Morosidad | cancelled/monitoring y deuda fuera de mes | F15 C | separar exigible de seguimiento y deuda total de calendario | definición deuda, MONEY | AUTO_FIX tras validar estados; medio | cuota cancelada/monitoring/overdue anterior no infla calendario ni desaparece deuda |
| 6. Atribución/Campañas | bloques históricos frente a controles de periodo | F16 C | propagar dimensiones o rotular alcance histórico independiente | prueba browser y RPC | AUTO_FIX; medio | cambiar fecha/cuenta/campaña cambia cards, tabla, chart y export compatibles |
| 7. Data Health; campañas atribuidas | name no seleccionado | F17 C | seleccionar identificador usado; test de campaña atribuida/no atribuida | revisar homónimos; no cambiar atribución real | AUTO_FIX; pequeño | fixture con utm coincidente no produce hueco; fallo de lectura=unknown |
| 8. Delivery/Bajas | recuperación solicitudes ≠ retención; scope y filtros divergentes | F18 C | etiquetas, tenant explícito, errores; export coherente con búsqueda; madurez | definición LTV/retención aún sin validar | AUTO_FIX + BUSINESS_DECISION; medio | sin filas=sin muestra; custom histórico no se cruza con hoy; solo tenant |

## P3 — visualización e interacción (browser parcial)

Se observaron desktop, branding oscuro/rosa y funnels. Pendiente responsive y build corregido:

- Mantener tipografía/branding del tenant y métricas reales. Funnel prominente solo si representa población compatible; una forma bonita no valida conversiones.
- Cards para magnitud, serie para evolución, barras/tablas para comparación, ranking con n/N, cohortes con madurez. No depender solo de color.
- Estado loading/empty/error/partial/stale/unknown visible, denominador y tooltip de definición/fuente/periodo en ratios.
- Probar desktop/mobile, keyboard, filtros, exports, paginación, modal/drawer, drilldown, enlaces y reduced motion. No añadir animación que impida leer.
- Alcance AUTO_FIX por pantalla tras evidencia; cambios visuales requieren build y comparación visual antes/después.

## SAFE FIX aplicado en esta rama

**F10-count:** `lib/ai/agent/tools.ts` lee count en la query HEAD de contactos. Conserva 0 y null; no cambia periodo, atribución ni dinero. `tests/metrics/agent-overview-count.test.mjs` reproduce 12→null y 0→null antes del cambio y valida 12/0/null después. Quality Gate local completado: format, lint, typecheck, unit y métricas; métricas 722/722. No se ha desplegado.

## USER ACTION REQUIRED — concretas

1. **Roles:** sesión admin recuperada y operativa. No repetir Ver como hasta corregir F21. Para roles restantes usar acceso de prueba existente autorizado; no pedir contraseñas por chat ni firmar contratos pendientes para pasar el gate.
2. **Asignación:** confirmar qué setter(s) reales intervinieron y entregar mapping de citas/ventas sin setter a usuario existente; indicar expresamente casos sin setter. Confirmar relación venta↔cita cuando falte. Preparar lote privado con IDs, no publicarlo en Git. No backfill hasta tener evidencia.
3. **Asistencia:** confirmar estado de citas pasadas con nota provisional o estado pendiente usando Calendly/GHL/Fathom/evidencia operacional; no inferir asistencia por venta o por KPI esperado.
4. **Histórico:** indicar fecha inicial esperada por Stripe, cuenta Meta, CRM/agendas, Instagram y vídeo; señalar fuentes/cuentas que el negocio no usa. Solo entonces cuantificar periodo faltante y solicitar export/backfill específico.

## BUSINESS DECISIONS REQUIRED

- Mantener D2 (moneda base/FX por fecha), decidir fuente de FX para transacciones ajenas a la base; hasta entonces importe separado/unknown.
- Cerrar pendientes de MONEY: modo oficial del consolidado bruto/atribuible (A3), billed/recognized si se desean (A1/A2), clawback (A5). No bloquean arreglar bugs de filtros y HEAD.
- Confirmar si cards llamadas clientes requieren únicos o ventas y si close rate contextual se basa en shows totales o llamadas cualificadas. Exponer ambas si son preguntas distintas; no reemplazar definiciones sin versión.
- Confirmar ventana de madurez y objetivos propios por canal/oferta/equipo. Benchmarks externos solo orientativos tras la validación completa.

## EXTERNAL BLOCKERS

- Acceso autorizado a conversaciones Instagram depende del proveedor; no está demostrado que otros canales sean obligatorios o falten por error.
- Timeouts de jobs requieren lectura de logs y siguiente ejecución; no equivalen automáticamente a hueco histórico.
- UI de colaborador limitada por contrato pendiente; otros roles y E2E todavía sin validar.

## Orden de ejecución y cierre

1. Resolver P0 con pruebas de permisos y coordinación de seguridad.
2. Acreditar definiciones/periodo/moneda y aplicar P1 por pequeñas unidades, preservando trabajo concurrente.
3. Completar browser y todos los roles; registrar capturas y comparaciones privadas por scope.
4. Obtener mappings/ventanas humanas y ejecutar backfills en lotes auditables separados.
5. Solo tras siete gates valorar HEALTHY/WATCH/OUTSIDE KPI; antes UNKNOWN.
6. Actualizar scorecard con evidencia y cerrar auditoría únicamente cuando no queden rutas/roles/filtros críticos sin revisar.

No fusionar esta auditoría como certificación de producción. Los documentos son un relevo de hallazgos verificables y pendientes, no una declaración de finalización.

## Relevo inmediato — prioridad y estado exactos

1. **PUBLICAR RAMA, NO DAR POR DESPLEGADO:** fixes F19/F20 y docs validados localmente; conservar en `codex/dashboard-metric-audit`. No merge mientras falte verificar consultas nuevas en app/preview y CI relevante. F10 count ya estaba en la misma rama.
2. **P0 F19 (AUTO_FIX parcial):** filtros tenant aplicados a seis paneles. Completar en carril coordinado CRM/alumnos/contenido/selectores y saved views (lectura/escritura), revisar otras consultas sin tenant. Verificar usuario con acceso A+B, vacíos, navegación y respuestas tardías; no basta RLS de membresía.
3. **P0 F01/F02 (AUTO_FIX, seguridad):** RLS de colaborador y endpoints privilegiados, coordinar antes de migrar. Alcance medio/alto; dry-run rollback y tests anon/propio/ajeno obligatorios.
4. **P2 F21 (AUTO_FIX, auth):** corregir retorno Ver como y cookie SSR, sin debilitar ticket cifrado. Sesión del usuario recuperada; no volver a usar impersonación para continuar. Pruebas contrato pendiente/chunks/login/logout/retorno admin.
5. **P1 F20 (AUTO_FIX realizado local):** CTR corregido y regresión. Verificar valor renderizado después del despliegue.
6. **P1 F03/F05/F06/F07/F09:** reservas, cash de ventas anteriores, refunds por fecha, moneda, cohortes y denominadores. Trabajar por unidades pequeñas; no tocar cifras para ajustarlas a benchmark.
7. **P2 F22/F23 (AUTO_FIX pendiente):** ratios sin muestra → desconocido; VSL sin datos no saludable; webhook silencioso no rotura demostrada. Pruebas n=0 y proveedor sin actividad/entrega fallida.
8. **COMPLETAR BROWSER:** revisar funnels (tab actual), eventos, socios, Brief, integraciones, recursos y Person360; después mobile/tablet y exports/filtros detallados. Registro exacto en auditoría. No repetir páginas ya cubiertas salvo cambio de código.
9. **USER_ACTION/BUSINESS_DECISION:** mappings reales, inicio histórico esperado, FX y decisiones MONEY. Preparar lista privada de filas afectadas; no publicar nombres/IDs/importes en Git.

**No hay diagnóstico REAL BUSINESS KPI PROBLEM demostrado.** Las alertas identificadas son de calidad/fuente/cálculo/scope/representación.
