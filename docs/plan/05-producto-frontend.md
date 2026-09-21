# 05 — Producto, frontend y UX

Cuándo cargarlo: S0, F4 (UX de producto) y F9, y cualquier tarea de UI, navegación, filtros, notificaciones, ficheros, imports o consola de admin.

## 1. Arquitectura de frontend

Un único producto coherente. No permitir que cada feature creada con IA construya su propio mini design system. Antes de crear UI, buscar el sistema existente.

Componentes centralizados: Button, Input, Select, MultiSelect, DateRange, Table, DataGrid, Card, Metric, Badge, Tabs, Dialog, Drawer, Tooltip, Popover, Toast, Skeleton, EmptyState, ErrorState, primitivas de gráficos, PageHeader, Filters. Una única semántica visual para acción primaria, secundaria, peligrosa, éxito, aviso, error, deshabilitado y carga.

Arquitectura: UI → Application/Domain Service → Repository/Connector. Nunca UI → SDK de proveedor. Así se podrán exponer después una API pública, IA, automatizaciones o app móvil sin duplicar lógica.

## 2. Principios de UX

Cada pantalla responde rápido: dónde estoy, qué veo, de qué periodo, de qué tenant, qué puedo hacer, qué requiere atención. Priorizar información → diagnóstico → acción, no 50 cards y 10 tablas que el usuario interpreta. La aplicación intenta responder: qué pasó, por qué, dónde, cuánto importa, qué puedo hacer.

## 3. Navegación

Estable; no añadir módulos aleatorios al sidebar. Estructura conceptual: HOME · GROWTH (Acquisition, Funnels, Content, VSL) · CRM (Contacts, Pipeline, Appointments, Conversations) · SALES (Performance, Calls, Closers, Commissions) · CUSTOMERS (Delivery, Progress, Support, Reviews) · FINANCE (Revenue, Collections, Expenses, Profitability) · INTELLIGENCE (Ask, Constraints, Insights, Weekly Brief) · DATA (Integrations, Data Health, Tracking) · SETTINGS. Los nombres no son obligatorios; la regla sí.

## 4. Filtros globales, búsqueda y estados

Filtros compartidos: tenant, periodo, source, funnel, oferta, campaña y miembro del equipo. Default temporal: MES ACTUAL. Un filtro afecta de forma coherente a todas las métricas relacionadas; un solo selector temporal por contexto.

Búsqueda global tenant-safe (contactos, leads, citas, ventas, campañas, llamadas, conversaciones, documentos, integraciones); nunca buscar globalmente y filtrar después. Cmd/Ctrl+K como futuro.

Estados explícitos en toda pantalla: loading, success, empty, partial, stale, error, permission denied, integration missing. Nunca mostrar 0 cuando el dato no se pudo obtener ("0 ventas" y "Stripe no sincronizado desde ayer" son estados distintos).

## 5. Responsive, accesibilidad y rendimiento

Operativa completa en portátil, usable en móvil. Prioridad móvil: Dashboard, Appointments, Pipeline, Contacts, Sales, Commissions, Ask, Notifications. No una tabla de 15 columnas en 375 px: usar progressive disclosure.

Accesibilidad mínima: navegación por teclado, focus, HTML semántico, labels, contraste, lectores de pantalla básicos, semántica correcta de botón y enlace, reduced motion. No añadir ARIA si el HTML nativo resuelve.

Rendimiento: evitar bundles enormes, lazy-load de módulos pesados, menos client components, evitar waterfalls, optimizar gráficos, paginar, virtualizar tablas grandes, no cargar 10.000 contactos en el navegador y filtrar en servidor o capa de datos. Cache tenant-scoped (ver `02-seguridad-privacidad.md` §4).

## 6. Analítica de producto y notificaciones

Medir la propia app: workspace_created, integration_connected, dashboard_viewed, constraint_opened, evidence_opened, ask_question, ai_action_proposed, ai_action_executed, weekly_brief_opened, report_exported. Métricas: activación, workspaces activos semanales, features usadas, integraciones por workspace, time-to-first-insight, time-to-value, uso de Ask y de evidencia, acciones ejecutadas. Sin PII innecesaria.

Notificaciones con fuente común y preferencias por usuario. Categorías: business, data health, integration, AI insight, approval, system. Canales potenciales: in-app, email, Slack, WhatsApp; no implementarlos todos al principio.

Feedback estructurado del propio usuario: feature request, bug, feedback de respuesta de IA, métrica incorrecta, integración ausente.

## 7. Ficheros, imports y exports

Ficheros centralizados (ver `02-seguridad-privacidad.md` §4). Imports: no todas las fuentes tendrán API; aceptar CSV, XLSX y Google Sheets con preview, mapeo, validación, deduplicación, resultado, errores y rollback o retry cuando sea razonable. Exports respetan tenant, permisos, filtros y rango de fechas.

## 8. Consola de admin

Área Platform/Admin solo para personal autorizado: organizations, tenants, usuarios, integraciones, salud de sync, jobs, feature flags, uso de IA, storage, errores, audit y herramientas de soporte. No usar Supabase Studio como interfaz operativa diaria.

## 9. Capability Map

Mantener un inventario de lo que el producto puede hacer, con estado stable, guarded, partial, beta o future (por ejemplo `contacts.read` stable, `refund.create` guarded, `messages.send` future, `ai.actions` beta). Sirve a UI, agente, permisos, integraciones y roadmap. `CAPABILITIES.md` clasifica cada área como STABLE, WORKING_WITH_ISSUES, PARTIAL, BROKEN, LEGACY, UNUSED o UNKNOWN.

## 10. Reservado para el futuro (no construir)

Contratos externos versionados cuando romper compatibilidad sea posible (webhooks, API pública, pixel de tracking, schemas de eventos, payloads de conectores, tools de IA); nunca reinterpretar en silencio un evento antiguo. API pública (contacts, appointments, sales, metrics, events, commands), webhooks salientes (sale.closed, appointment.booked, payment.received, constraint.detected, con firmas, reintentos, idempotencia y logs) y automation engine (trigger, condition, action sobre eventos, servicios de dominio y commands) solo con demanda real. Se preserva la posibilidad manteniendo bien diseñados Domain Services, Event Core y Command Engine.
