-- ============================================================================
-- Índices para FKs sin índice (95) — advisor de rendimiento de Supabase
-- Fecha: 2026-09-18 · Origen: get_advisors(performance) → unindexed_foreign_keys
--
-- Cada FK sin índice de cobertura penaliza:
--   · los DELETE/UPDATE en cascada y la verificación de integridad referencial
--   · los JOIN por esa columna cuando el planner no reordena
--
-- Convenciones:
--   · Nombre de índice: idx_{tabla}_{columna} (columna derivada del nombre de
--     la constraint {tabla}_{columna}_fkey; verificado contra las migraciones).
--   · Idempotente: CREATE INDEX IF NOT EXISTS — puede relanzarse sin efecto.
--   · Sin CONCURRENTLY: con el volumen actual de datos (tablas de miles de
--     filas) el lock de escritura es despreciable. Si alguna tabla crece a
--     millones de filas ANTES de aplicar, sustituir el statement por
--     CREATE INDEX CONCURRENTLY (fuera de transacción, uno por uno).
--
-- Verificación tras aplicar en producción:
--   Supabase MCP → get_advisors(performance) → el hallazgo
--   `unindexed_foreign_keys` debe bajar de 95 a 0.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Alta frecuencia de consulta (CRM / ventas / atribución)
-- ---------------------------------------------------------------------------

-- appointments (7 FKs sin índice)
CREATE INDEX IF NOT EXISTS idx_appointments_setter_id    ON public.appointments (setter_id);
CREATE INDEX IF NOT EXISTS idx_appointments_closer_id    ON public.appointments (closer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_contact_id   ON public.appointments (contact_id);
CREATE INDEX IF NOT EXISTS idx_appointments_cold_caller  ON public.appointments (cold_caller_id);
CREATE INDEX IF NOT EXISTS idx_appointments_triager_id   ON public.appointments (triager_id);
CREATE INDEX IF NOT EXISTS idx_appointments_affiliate_id ON public.appointments (affiliate_id);
CREATE INDEX IF NOT EXISTS idx_appointments_origin_appt  ON public.appointments (origin_appointment_id);

-- sales (10 FKs sin índice)
CREATE INDEX IF NOT EXISTS idx_sales_product_id     ON public.sales (product_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment_plan   ON public.sales (payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_sales_affiliate_id   ON public.sales (affiliate_id);
CREATE INDEX IF NOT EXISTS idx_sales_appointment_id ON public.sales (appointment_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_by     ON public.sales (created_by);
CREATE INDEX IF NOT EXISTS idx_sales_updated_by     ON public.sales (updated_by);
CREATE INDEX IF NOT EXISTS idx_sales_origin_sale    ON public.sales (origin_sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_docs_verified  ON public.sales (documents_verified_by);
CREATE INDEX IF NOT EXISTS idx_sales_docs_override  ON public.sales (documents_override_by);
CREATE INDEX IF NOT EXISTS idx_sales_conv_reservation ON public.sales (converted_from_reservation_id);

-- contacts (2 FKs sin índice)
CREATE INDEX IF NOT EXISTS idx_contacts_campaign_id ON public.contacts (campaign_id);
CREATE INDEX IF NOT EXISTS idx_contacts_referred_by ON public.contacts (referred_by);

-- canonical_events (8 FKs sin índice, pixel first-party)
CREATE INDEX IF NOT EXISTS idx_canonical_events_session    ON public.canonical_events (session_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_visitor    ON public.canonical_events (visitor_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_touchpoint ON public.canonical_events (touchpoint_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_contact    ON public.canonical_events (contact_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_appointment ON public.canonical_events (appointment_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_sale       ON public.canonical_events (sale_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_site       ON public.canonical_events (site_id);
CREATE INDEX IF NOT EXISTS idx_canonical_events_raw_event  ON public.canonical_events (raw_event_id);

-- raw_events (2 FKs sin índice)
CREATE INDEX IF NOT EXISTS idx_raw_events_site     ON public.raw_events (site_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_canonical ON public.raw_events (canonical_event_id);

-- analytics (pixel)
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_visitor   ON public.analytics_sessions (visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_touchpoints_session ON public.analytics_touchpoints (session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_touchpoints_visitor ON public.analytics_touchpoints (visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_visitors_contact   ON public.analytics_visitors (contact_id);

-- ---------------------------------------------------------------------------
-- IA (conversaciones, tool calls, facts)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user   ON public.ai_conversations (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_message   ON public.ai_tool_calls (message_id);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_tenant    ON public.ai_tool_calls (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_business_facts_creator   ON public.ai_business_facts (created_by);
CREATE INDEX IF NOT EXISTS idx_ai_business_facts_outcome_of ON public.ai_business_facts (outcome_of);

-- ---------------------------------------------------------------------------
-- Comisiones y contratos
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_commissions_user_id     ON public.commissions (user_id);
CREATE INDEX IF NOT EXISTS idx_commissions_approved_by ON public.commissions (approved_by);
CREATE INDEX IF NOT EXISTS idx_commission_rules_user_id ON public.commission_rules (user_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id           ON public.users (role_id);

CREATE INDEX IF NOT EXISTS idx_contracts_contact_id    ON public.contracts (contact_id);
CREATE INDEX IF NOT EXISTS idx_contracts_created_by    ON public.contracts (created_by);
CREATE INDEX IF NOT EXISTS idx_contracts_template_id   ON public.contracts (template_id);
CREATE INDEX IF NOT EXISTS idx_contract_templates_creator ON public.contract_templates (created_by);

CREATE INDEX IF NOT EXISTS idx_products_next_product   ON public.products (next_product_id);
CREATE INDEX IF NOT EXISTS idx_payment_plans_product   ON public.payment_plans (product_id);

CREATE INDEX IF NOT EXISTS idx_document_verifications_verifier ON public.document_verifications (verified_by);

-- ---------------------------------------------------------------------------
-- Cobros, devoluciones, gastos
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_refunds_collection_id ON public.refunds (collection_id);
CREATE INDEX IF NOT EXISTS idx_refunds_created_by    ON public.refunds (created_by);
CREATE INDEX IF NOT EXISTS idx_email_invoices_expense_id    ON public.email_invoices (expense_id);
CREATE INDEX IF NOT EXISTS idx_email_invoices_validated_by  ON public.email_invoices (validated_by);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses (created_by);
CREATE INDEX IF NOT EXISTS idx_expenses_person_id  ON public.expenses (person_id);
CREATE INDEX IF NOT EXISTS idx_payment_follow_ups_creator ON public.payment_follow_ups (created_by);
CREATE INDEX IF NOT EXISTS idx_manual_platform_records_matched_coll ON public.manual_platform_records (matched_collection_id);
CREATE INDEX IF NOT EXISTS idx_manual_platform_records_creator ON public.manual_platform_records (created_by);

-- ---------------------------------------------------------------------------
-- Marketing / afiliados / contenido / Instagram
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_campaigns_created_by        ON public.campaigns (created_by);
CREATE INDEX IF NOT EXISTS idx_campaign_targets_updated_by ON public.campaign_targets (updated_by);
CREATE INDEX IF NOT EXISTS idx_affiliate_campaign_members_creator ON public.affiliate_campaign_members (created_by);
CREATE INDEX IF NOT EXISTS idx_affiliate_campaigns_creator  ON public.affiliate_campaigns (created_by);

CREATE INDEX IF NOT EXISTS idx_content_items_assigned_to ON public.content_items (assigned_to);
CREATE INDEX IF NOT EXISTS idx_content_items_created_by  ON public.content_items (created_by);
CREATE INDEX IF NOT EXISTS idx_ig_competitors_created_by ON public.ig_competitors (created_by);
CREATE INDEX IF NOT EXISTS idx_reel_drafts_created_by    ON public.reel_drafts (created_by);
CREATE INDEX IF NOT EXISTS idx_carrusel_projects_creator ON public.carrusel_projects (created_by);

CREATE INDEX IF NOT EXISTS idx_link_templates_created_by        ON public.link_templates (created_by);

-- ---------------------------------------------------------------------------
-- CRM auxiliares: notas, actividades, tareas, drops, rolplays, biblioteca
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_activities_person_id   ON public.activities (person_id);
CREATE INDEX IF NOT EXISTS idx_contact_notes_author   ON public.contact_notes (author_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id      ON public.tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by       ON public.tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_drops_contact_id       ON public.drops (contact_id);
CREATE INDEX IF NOT EXISTS idx_drops_created_by       ON public.drops (created_by);
CREATE INDEX IF NOT EXISTS idx_drops_handled_by       ON public.drops (handled_by);
CREATE INDEX IF NOT EXISTS idx_roleplays_created_by   ON public.roleplays (created_by);
CREATE INDEX IF NOT EXISTS idx_roleplays_participant  ON public.roleplays (participant_id);
CREATE INDEX IF NOT EXISTS idx_call_recordings_uploaded_by ON public.call_recordings (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_call_recordings_reviewed_by ON public.call_recordings (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_csm_events_csm_id      ON public.csm_events (csm_id);
CREATE INDEX IF NOT EXISTS idx_csm_events_created_by  ON public.csm_events (created_by);
CREATE INDEX IF NOT EXISTS idx_identity_matches_event   ON public.identity_matches (event_id);
CREATE INDEX IF NOT EXISTS idx_identity_matches_contact ON public.identity_matches (contact_id);
CREATE INDEX IF NOT EXISTS idx_identity_matches_reviewer ON public.identity_matches (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_fathom_match_review_resolved_appt ON public.fathom_match_review (resolved_appointment_id);
CREATE INDEX IF NOT EXISTS idx_fathom_match_review_resolved_by   ON public.fathom_match_review (resolved_by);
CREATE INDEX IF NOT EXISTS idx_deleted_appointments_log_deleted_by ON public.deleted_appointments_log (deleted_by);

-- ---------------------------------------------------------------------------
-- Settings / misc
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_saved_dashboard_views_user ON public.saved_dashboard_views (user_id);
CREATE INDEX IF NOT EXISTS idx_targets_created_by   ON public.targets (created_by);
CREATE INDEX IF NOT EXISTS idx_targets_scope_user   ON public.targets (scope_user_id);
CREATE INDEX IF NOT EXISTS idx_google_oauth_connected_by ON public.google_oauth_connections (connected_by);
CREATE INDEX IF NOT EXISTS idx_growth_context_updated_by ON public.growth_context (updated_by);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor     ON public.audit_logs (actor_user_id);

-- ---------------------------------------------------------------------------
-- Tablas creadas FUERA del directorio de migraciones (no verificables contra
-- el repo): columna derivada solo por convención {tabla}_{columna}_fkey.
-- Al final a propósito: si el nombre real difiere, el error no bloquea las
-- 93 sentencias anteriores (revisar el mensaje y ajustar esta sección).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_resource_links_created_by       ON public.resource_links (created_by);
CREATE INDEX IF NOT EXISTS idx_resource_link_divisions_creator ON public.resource_link_divisions (created_by);
