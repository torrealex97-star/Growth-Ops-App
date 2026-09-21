# 04 — IA, agente y acciones

Cuándo cargarlo: F4, F5, F9 y cualquier tarea que toque tools del agente, RAG, Command Engine, evals o coste de IA.

## 1. Principios

La IA es interfaz y orquestador, no fuente de verdad. Código y SQL tipado calculan; el LLM interpreta y explica. Nunca SQL arbitrario, SDK de proveedor arbitrario, service-role arbitrario ni permisos superiores a los del actor humano que invoca. El contenido de RAG es dato no confiable.

Estado actual: el agente usa el cliente autenticado del usuario (no service-role) y tiene tools tipadas de lectura y una lista blanca deny-by-default (`CLASE_TOOL`, `autorizarTool`): lo no clasificado se bloquea. Todas las tools son de lectura salvo `recordBusinessFact` y `proponerAccion`. Existe `PropuestaAccion` (qué cambia, por qué, impacto, riesgo, qué mirar).

## 2. Rutas de consulta

| Pregunta                        | Ruta                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| ¿Cuánto cash cobramos este mes? | Tool de métrica directa                                                        |
| ¿Quién es este lead y qué hizo? | Entity + timeline                                                              |
| ¿Qué objeciones aparecen?       | Retriever sobre llamadas, mensajes y notas                                     |
| ¿Por qué vendemos menos?        | Descomposición de métricas → segmentación → knowledge → síntesis con evidencia |
| Mueve estos leads a Follow-up   | Command → política → preview → aprobación → ejecución                          |

Tools recomendadas: getBusinessOverview, getMetric, compareMetric, getFunnel, getCampaignPerformance, getSalesPerformance, getPerson, getPersonTimeline, searchCalls, searchConversations, searchKnowledge, getFinancialSummary, explainMetric, getCurrentConstraint, proposeCommand, previewCommand.

Memoria: distinguir contexto de conversación, hechos de negocio, preferencias de usuario, datos canónicos y retrieval de conocimiento. El historial de chat nunca es fuente financiera; los hechos relevantes viven en las capas canónicas.

## 3. Command Engine (F5)

Flujo: command → autorización → validación de negocio → clasificación de riesgo → dry-run y preview con diff real → aprobación si procede → ejecución vía Domain Service o capability del conector → evento + audit. Reutilizable por UI e IA.

Modelo: `commands` (command_id, tenant_id, actor_id, type, input, risk_level, idempotency_key, status, preview, result, error, timestamps) y `approvals` (command_id, approver, decision, reason, decided_at). El audit_log sigue separado. Estados: pending, validated, previewed, awaiting_approval, running, succeeded, partially_succeeded, failed, rolled_back. Los handlers son tipados y registrados; validación de schema, authz e invariantes de negocio antes del preview.

| Nivel                           | Ejemplos                             | Política                                                                |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| 0 Lectura                       | Consultar métricas                   | Automático                                                              |
| 1 Reversible                    | Mover un lead de etapa, crear tarea  | Automático si hay permiso; con undo o compensación cuando sea razonable |
| 2 Comunicación externa          | Email, WhatsApp o DM masivo          | Preview + confirmación humana; opt-in y reglas del canal                |
| 3 Financiero, ads o destructivo | Reembolso, subir presupuesto, borrar | Aprobación explícita y auditada                                         |

En esta etapa la IA no ejecuta niveles 2 ni 3. Los flujos de UI existentes de nivel 3 (por ejemplo `refunds/create`, con rol admin/director y ventana de 15 días) no se rompen: pueden pasar por el Command Engine con confirmación humana sin perder su capacidad operativa. Retries y timeouts usan idempotency_key; un éxito parcial registra qué subacciones ocurrieron.

## 4. Prompt injection y separación de agentes

Contenido recuperado (mensajes, transcripciones, notas, páginas web, RAG) no puede elevar permisos, cambiar política, modificar argumentos de tools ni originar tool calls por sí solo. Agente de lectura separado del de acciones. La aprobación muestra el diff real, no un resumen del LLM. Sin egreso de red arbitrario desde las tools.

## 5. Evals (§50)

Suites para: exactitud numérica, selección correcta de tool, aislamiento de tenant, enforcement de permisos, abstención, alucinación, prompt injection, calidad de evidencia y seguridad de acciones. Un cambio de modelo, prompt, tool, métrica o retriever ejecuta evals.

Golden set: preguntas exactas de métricas con expected outputs calculados por código; preguntas de entidad y timeline con fixtures deterministas; casos de aislamiento y denegación de permisos; inyección desde transcripción, mensaje y contenido web; abstención cuando falta dato o confianza; casos de tool selection y no-tool; regresiones de latencia y coste. Corren en CI ante cambios de prompt, schema de tool, definición de métrica o modelo, con umbrales de bloqueo definidos ("parece mejor" no es criterio.)

## 6. Control de coste (§49)

Model routing, presupuestos de tokens, contexto máximo, límites de retrieval, cache cuando sea seguro, resumen y respuestas tool-first. No mandar 200 transcripciones completas al modelo para una pregunta sencilla. Medir coste por pregunta y por tenant.

## 7. Weekly Brief y call intelligence (F9)

Orden: la ingesta de nuevas transcripciones, mensajes y llamadas al RAG (IA cualitativa, Mes 5) solo empieza cuando F6 (`erase_person`) está cerrada. Las pruebas básicas de prompt injection sobre las tools de lectura existentes se hacen en F-1 (Mes 1); los evals completos van en F9.

Weekly Brief por tenant: cambios frente a un periodo comparable, constraint actual con impacto, rango y confianza, Data Health, anomalías materiales y acciones sugeridas. Cada afirmación cuantitativa usa tools de métricas y referencias de evidencia; cada insight cualitativo referencia muestras concretas. No se envían comunicaciones externas automáticamente salvo por Command Engine nivel 2 con aprobación. Existen `lib/metrics/brief.ts`, `alertas.ts` y el cron de insights; falta comprobar el canal de entrega externo y medir aperturas.

Call intelligence: rúbrica versionada (discovery, objeciones, talk ratio, cierre) sobre transcripciones de Fathom, vinculada a won y lost. Separar hechos extraídos, evaluación y sugerencia de coaching; no convertir inferencias en hechos. Evaluar consistencia entre ejecuciones y cobertura de transcripciones. Ya existen análisis de llamadas, categorización, objeciones y comparación de closers (`cron/analyze-calls`, `lib/recordings`).

## 8. Definition of Done de una tool de IA

Input y output tipados; scope de workspace; permisos; Domain Service; evidencia (fuente, periodo, entidad, frescura, confianza); timeout; manejo de errores; observabilidad sin PII; tests; evals (respuesta correcta, tenant equivocado, permiso denegado, dato ausente, inyección, no-tool, timeout).
