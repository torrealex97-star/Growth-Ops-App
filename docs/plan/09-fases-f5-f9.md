# 09 — Prompts de fase: F5 a F9 y reglas de merge

Cuándo cargarlo: al ejecutar una de estas fases. Cada prompt hereda P0 (`07-prompts-base.md`). Un prompt = una rama = un PR.

Orden de ejecución de las fases de este documento: F7 (Mes 4, antes de F4) → F6 (Mes 5, antes de la IA cualitativa) → F5 → F8 (con F0 justo antes) → F9. F10 aplazado.

## F5 — Commands, policies y approvals

Transversales: `04-ia-agente.md` §3, `02-seguridad-privacidad.md`. El agente ya tiene tools de lectura y allowlist deny-by-default. Construir un Command Engine reusable por UI e IA; sin acceso directo del LLM a DB ni SDKs.

- Modelo: `commands`, `approvals` (audit_log separado), estados pending → validated → previewed → awaiting_approval → running → succeeded | partially_succeeded | failed | rolled_back. Handlers tipados y registrados; validación de schema, authz e invariantes de negocio antes del preview.
- Política: 0 lectura automático; 1 reversible ejecutable con permiso y con undo cuando sea razonable; 2 comunicación externa con preview y confirmación humana; 3 financiero, ads o destructivo con aprobación explícita y auditada. La IA NO ejecuta niveles 2 y 3 en esta fase.
- Migración de acciones existentes: no romper flujos de UI de nivel 3 como refunds. Pueden pasar por el Command Engine con confirmación humana y mantener su capacidad mientras la IA siga bloqueada. Cada handler usa el Domain Service o capability existente. Retries y timeouts usan idempotency_key; un éxito parcial registra qué subacciones ocurrieron.
- Frontera de prompt injection: mensajes, transcripciones, notas, páginas web y RAG son contenido no confiable; nunca elevan permisos, cambian política ni originan tool calls por sí solos. Solo el input del actor más el policy engine pueden proponer un command.

Graduación: las acciones reversibles funcionan con permisos e idempotencia; los niveles 2 y 3 no pueden ejecutarse sin el flujo humano definido; todo queda auditado.

## F6 — Privacidad y erase_person

Prerrequisito de la IA cualitativa: debe cerrarse (Mes 5) antes de ingerir nuevas transcripciones, mensajes o llamadas al RAG, para no añadir PII antes de poder borrarla.

Transversales: `02-seguridad-privacidad.md` §5, `03-operacion-fiabilidad.md`. `contacts` es el hogar de la PII salvo evidencia de que otra abstracción sea necesaria. El objetivo no es "borrar de todo backup al instante" sino un procedimiento verificable conforme a la retención. La retención de raw y transcripciones debe estar decidida antes de cerrar la fase.

- Mapa de PII: inventario de tablas, storage, vectores, raw, logs y proveedores externos. Garantizar `contact_id` en transcripciones, emails, mensajes, notas y `knowledge_chunks` cuando la relación se conozca. No añadir PII nueva a `canonical_events.properties`.
- `erase_person`: comando de dominio autorizado por tenant y contact_id, idempotente; borra o anonimiza PII de stores activos, chunks, embeddings y ficheros; conserva hechos financieros y operativos solo cuando deban persistir y sin PII directa; raw con excepciones de retención registradas; audit con identificador no reversible; lista de borrados aguas abajo en proveedores externos (no completado hasta registrar su estado); documentar la ventana de expiración de backups y evitar reintroducir PII al restaurar.
- Test con una persona en contacto, mensaje, transcripción, nota, chunk o vector, raw y storage. Tras `erase_person`: sin apariciones en búsquedas activas ni retrieval; agregados no identificables que siguen cuadrando; informe con PASS o BLOCKED por store.

Graduación: sin PII recuperable en stores activos e índices y con evidencia del borrado; backups y procesadores externos gobernados por retención y DPA, no ocultos detrás de "cero rastro".

## F7 — Funnel A (DM orgánico) de primera clase

Se ejecuta en el Mes 4, antes de F4: es el funnel real del negocio. Depende de F1 (event core) y F3 (definiciones y madurez).

Transversales: `01-arquitectura-datos.md` §3, §4 y §7. Implementar solo capacidades respaldadas por una fuente de datos real; sin scraping frágil ni simular una API.

- Identidad: sobre `contacts` + `identity_matches` (más `contact_identities`, `lifecycle`, `merge_log` del doc 01). Email y teléfono strong; IDs de proveedor strong; anonymous_id contextual; usernames de IG y TikTok weak. Nunca merge por handle solo ni entre plataformas; merges reversibles y auditables. `handle_only` cuenta como lead solo según la business_definition del funnel A.
- Eventos y tiempo: `dm.started`, `dm.qualified`, `dm.booking_link_sent`, `message.first_response` con occurred_at real y source. `speed_to_first_reply = first_response.occurred_at − dm.started.occurred_at` según definición versionada; distinguir bot y humano si la fuente lo permite.
- Atribución: `content_trigger` (reel, story, keyword) separado del hecho DM; `self_reported` separado; sin UTMs inventados en orgánico. Toda señal lleva source y confidence. Si TikTok o IG no permiten captura fiable: import, intermediario o manual con confianza baja y Data Health visible. El funnel conecta handle_only → contacto identificado → booking, show, close y cash cuando el stitching sea demostrable.

Graduación: el funnel A se mide hasta cash con cobertura y confianza visibles, sin merges inseguros ni dependencia crítica de una API no oficial.

## F8 — Segundo tenant real + consolidado

Transversales: `01-arquitectura-datos.md` §2, `02-seguridad-privacidad.md`, `03-operacion-fiabilidad.md`. Los fixtures sintéticos Tenant A y B ya existen desde F-1 y F0 (organizations) se ejecuta justo antes; F8 demuestra que un segundo tenant REAL se incorpora sin tocar el core.

- Provisioning y configuración: dar de alta el tenant B con el mismo provisioning; toda diferencia se resuelve con configuración versionada (mapeo de etapas, ofertas, funnels, moneda, zona horaria, mapeos de fuente, business definitions). Un `if tenant_id == ...` o código específico de cliente es un fallo de diseño: proponer una abstracción o configuración general antes de mergear. Comparar schemas, permisos, integration settings y flags de A y B; no copiar secretos ni datos.
- Consolidado: Organization consume `org_metric_snapshots`, nunca datos persona-level entre tenants. La UI muestra bruto y atribuible como modos explícitos; el modo "oficial" usa la decisión versionada de MONEY.md, y si no existe ninguno se etiqueta oficial. FX y participation_pct con fecha y versión trazables.

Graduación: el segundo tenant funciona con configuración, los tests entre tenants pasan y el consolidado no crea un camino de acceso a PII entre ventures.

## F9 — Weekly Brief + evals + call intelligence

La parte cualitativa (llamadas, transcripciones, mensajes, RAG, evals y control de coste) se adelanta al Mes 5, tras F6; el resto de F9 (Weekly Brief y vistas por rol) cierra el Mes 6.

Transversales: `04-ia-agente.md` §5 a §7, `05-producto-frontend.md` §6. Objetivo: cerrar el loop de uso semanal y demostrar que la IA aporta utilidad sin degradar exactitud, seguridad ni permisos.

- Weekly Brief: por tenant, cambios frente a un periodo comparable, constraint con impacto, rango y confianza, Data Health, anomalías materiales y acciones sugeridas. Cada afirmación cuantitativa usa tools de métricas y evidence refs; cada insight cualitativo referencia muestras concretas. Sin envío automático de comunicaciones externas salvo Command Engine nivel 2 con aprobación.
- Call intelligence: rúbrica versionada sobre transcripciones de Fathom; separar hechos extraídos, evaluación y coaching; evaluar consistencia entre ejecuciones y cobertura.
- Golden set y evals en CI con umbrales de bloqueo (métricas exactas, entidad y timeline, aislamiento y permisos, inyección desde transcripción, mensaje y web, abstención, tool selection y no-tool, latencia y coste).

Graduación: el Weekly Brief se usa en operación real, los evals bloquean regresiones críticas y el agente conserva exactitud y aislamiento.

## F10 — Producto (aplazado)

No ejecutar todavía. Billing, self-serve, apps públicas, onboarding wizard y pricing entran solo cuando la etapa B demuestre demanda con clientes de pago o renovación y exista un criterio de kill con fecha. Al desbloquearse, crear un plan nuevo basado en uso real; no anticipar arquitectura.

## Reglas de operación y merge

- Una fase = una rama = un PR. Sin merge con el quality gate en rojo o con criterios de graduación sin evidencia.
- El agente no ejecuta migraciones de producción automáticamente: prepara la migración, la valida en un entorno seguro y pide confirmación cuando corresponda.
- Un solo tenant REAL hasta F4; desde F-1 hay tenants sintéticos para aislamiento.
- Cada PR con cambios de datos incluye plan de migración, rollback o forward-fix y backfill con verificación.
- Cada PR actualiza solo la documentación autoritativa afectada; no se duplica conocimiento.
- Si una fase descubre deuda crítica fuera de scope, abrir un follow-up y continuar solo si no bloquea seguridad ni correctitud.
- Al cerrar una fase, compactar o eliminar `.agent/STATE.md`; Git, docs y tests son la memoria durable.
