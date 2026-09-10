// ==================== ENUMS ====================
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'show' | 'no_show' | 'cancelled' | 'rescheduled' | 'completed' | 'cancelled_admin' | 'cancelled_lead' | 'seguimiento' | 'reserva'
export type SaleStatus = 'active' | 'refunded' | 'partial_refund' | 'chargeback' | 'cancelled'
export type CollectionStatus = 'collected' | 'reversed' | 'disputed'
export type CommissionStatus = 'pending' | 'approved' | 'liquidated' | 'cancelled'
export type CommissionDirection = 'positive' | 'negative'
export type ParticipantType = 'setter' | 'closer' | 'affiliate'
export type TargetScopeType = 'company' | 'role' | 'user'
export type TargetPeriodType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'
export type KpiFieldType = 'number' | 'text' | 'textarea' | 'boolean' | 'select' | 'date'
export type UserRole = 'admin' | 'director' | 'setter' | 'closer' | 'affiliate'

// ==================== ROLES ====================
export type Role = {
  id: string
  key: string
  name: string
  description: string | null
  created_at: string
}

export type InsertRole = Omit<Role, 'id' | 'created_at'>

// ==================== USERS ====================
export type User = {
  id: string
  full_name: string
  email: string
  // v23 — correo personal (solo para el contrato: firma + copia). El de login/
  // calendarios/todo lo demás sigue siendo `email` (correo de empresa).
  personal_email: string | null
  phone: string | null
  role_id: string
  is_active: boolean
  default_affiliate_commission_percent: number | null
  avatar_url: string | null
  data_scope: 'own' | 'team'
  // v3 — Equipo
  start_date: string | null
  base_salary: number | null
  commission_percent: number | null
  monthly_goal: number | null
  assigned_channel: string | null
  member_status: 'activo' | 'inactivo' | 'prueba'
  // v12 — afiliado + acceso por departamento
  affiliate_code: string | null
  dept_overrides: string[] | null
  // v14 — código de tracking para enlaces (utm_term setter / utm_content afiliado)
  tracking_code: string | null
  // v17 — datos personales (se completan al firmar contratos)
  dni: string | null
  address: string | null
  created_at: string
  updated_at: string
}

export type InsertUser = Omit<User, 'created_at' | 'updated_at' | 'data_scope'>

export type UserWithRole = User & {
  roles: Role
}

// ==================== CONTACTS ====================
export type Contact = {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string
  email: string | null
  phone: string | null
  country: string | null
  company_name: string | null
  notes: string | null
  instagram: string | null
  lead_status: 'registrado' | 'whatsapp_enviado' | 'llamado' | 'agendado' | 'no_contesta' | 'descartado' | 'cliente' | 'en_seguimiento' | 'reserva' | 'venta'
  lead_channel: 'whatsapp' | 'llamada' | 'email' | 'otro' | null
  first_seen_at: string | null
  last_seen_at: string | null
  vsl_watch_pct: number | null
  vsl_watched_at: string | null
  // v3 — Leads
  lead_score: number | null
  first_contact_at: string | null
  contact_attempts: number
  discard_reason: string | null
  referred_by: string | null
  campaign_id: string | null
  set_source: 'closer' | 'setter' | 'cold_caller' | 'affiliate' | null
  optin_date: string | null
  gender: string | null
  age: number | null
  // v3 — Alumnos (post-venta)
  engagement_score: 'bajo' | 'medio' | 'alto' | null
  ttfv_date: string | null
  nps: number | null
  nps_date: string | null
  promise_fulfilled: 'si' | 'no' | 'en_proceso' | null
  // v4 — enlace con GHL
  ghl_contact_id: string | null
  created_at: string
  updated_at: string
}

export type ContactNote = {
  id: string
  contact_id: string
  author_id: string | null
  note: string
  pinned: boolean
  created_at: string
}

export type InsertContactNote = Omit<ContactNote, 'id' | 'created_at'>

export type InsertContact = Omit<Contact, 'id' | 'created_at' | 'updated_at' | 'vsl_watch_pct' | 'vsl_watched_at'>

// ==================== CONTACT ATTRIBUTIONS ====================
export type ContactAttribution = {
  id: string
  contact_id: string
  source: string | null
  funnel: string | null
  landing_url: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  first_touch_at: string | null
  last_touch_at: string | null
  is_primary: boolean
  // v7 — UTMs de primer y último contacto
  first_utm_source: string | null
  first_utm_medium: string | null
  first_utm_campaign: string | null
  first_utm_content: string | null
  first_utm_term: string | null
  last_utm_source: string | null
  last_utm_medium: string | null
  last_utm_campaign: string | null
  last_utm_content: string | null
  last_utm_term: string | null
  created_at: string
  updated_at: string
}

export type InsertContactAttribution = Omit<ContactAttribution, 'id' | 'created_at' | 'updated_at'>

// ==================== APPOINTMENTS ====================
export type Appointment = {
  id: string
  external_source: string
  external_id: string | null
  contact_id: string
  appointment_datetime: string
  status: AppointmentStatus
  setter_id: string | null
  closer_id: string | null
  source: string | null
  pipeline_name: string | null
  pipeline_stage: string | null
  calendar_name: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  raw_payload: Record<string, unknown> | null
  notes: string | null
  recording_url: string | null
  duration_minutes: number | null
  // v49 — flag de seguimiento independiente del status
  needs_followup: boolean
  // v58 — etapa del pipeline interno de seguimiento comercial (recontacto/pago/reagenda),
  // independiente de `status` y del `pipeline_stage` de las integraciones externas
  followup_stage: 'pendiente_recontacto' | 'en_seguimiento_pago' | 'reagendado_pendiente' | 'cerrado' | 'descualificado' | null
  last_contacted_at: string | null
  // v61 — status que tenía la cita justo antes de reagendarla (para distinguir en el historial
  // si la reagenda viene de un no_show o de un show)
  rescheduled_from_status: string | null
  // v3 — Citas
  result: string | null
  appointment_type: 'primera' | 'follow_up_1' | 'follow_up_2' | 'follow_up_3' | null
  origin_appointment_id: string | null
  event_type: 'demo' | 'sales_call' | 'follow_up_call' | null
  grade: number | null
  triager_id: string | null
  cold_caller_id: string | null
  affiliate_id: string | null
  pipe_value: number | null
  offered: boolean | null
  payment_deal: string | null
  qualification: Record<string, unknown> | null
  // v4 — transcripción + análisis IA
  transcript: string | null
  transcript_drive_url: string | null
  transcript_status: string | null
  ai_call_score: number | null
  ai_lead_score: number | null
  ai_suggested_stage: string | null
  ai_summary: string | null
  ai_analysis: Record<string, unknown> | null
  ai_analyzed_at: string | null
  // v14 — Calendly
  meeting_url: string | null
  reschedule_url: string | null
  calendly_event_uuid: string | null
  created_at: string
  updated_at: string
}

export type InsertAppointment = Omit<Appointment, 'id' | 'created_at' | 'updated_at'>

// ==================== LINK TEMPLATES (enlaces con UTM por usuario) ====================
export type LinkTemplate = {
  id: string
  name: string
  base_url: string
  applies_to: string[]
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InsertLinkTemplate = Omit<LinkTemplate, 'id' | 'created_at' | 'updated_at'>

// ==================== RESOURCE LINKS (enlaces varios por tipología, SIN UTM) ====================
// Enlaces fijos que el admin comparte por categoría: pagos de productos, playbook,
// acceso a plataformas (Sequra), etc. No llevan tracking; solo copiar/abrir.
// División / carpeta creada por el admin para agrupar enlaces de forma ordenada.
export type ResourceLinkDivision = {
  id: string
  name: string
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InsertResourceLinkDivision = Omit<ResourceLinkDivision, 'id' | 'created_at' | 'updated_at'>

export type ResourceLink = {
  id: string
  division_id: string | null // división/carpeta a la que pertenece (null = Sin división)
  category: string // etiqueta libre (legacy / respaldo); la agrupación usa division_id
  name: string
  url: string
  description: string | null // mini descripción
  applies_to: string[] // roles que lo ven; vacío = todos los que ven Enlaces
  is_active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InsertResourceLink = Omit<ResourceLink, 'id' | 'created_at' | 'updated_at'>

// ==================== PROGRAMA DE AFILIADOS (v18) ====================
export type AffiliateCampaignType = 'evento' | 'lanzamiento' | 'vsl' | 'otro'

export type AffiliateCampaign = {
  id: string
  name: string
  type: AffiliateCampaignType
  base_url: string
  is_active: boolean
  registration_slug: string | null // token del enlace público de registro/alta a esta campaña
  created_by: string | null
  created_at: string
  updated_at: string
}
export type InsertAffiliateCampaign = Omit<AffiliateCampaign, 'id' | 'created_at' | 'updated_at'>

export type AffiliateCampaignMember = {
  id: string
  campaign_id: string
  affiliate_id: string
  created_by: string | null
  created_at: string
}

export type AffiliateProfile = {
  user_id: string
  instagram: string | null
  audience_size: string | null
  niche: string | null
  source: string | null
  motivation: string | null
  extra: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// Un campo del formulario público de registro (configurable por admin)
export type AffiliateFormField = {
  key: string
  label: string
  enabled: boolean
  required: boolean
  fixed?: boolean // full_name / email: no se pueden desactivar (crean la cuenta)
}

export type AffiliateProgramSettings = {
  id: number
  default_commission_percent: number
  program_name: string
  intro: string
  success_message: string
  form_fields: AffiliateFormField[]
  updated_at: string
}

export type AppointmentWithRelations = Appointment & {
  contacts: Contact
  setter: User | null
  closer: User | null
}

// ==================== PRODUCTS ====================
export type Product = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  // v3 — Programas (escalera de valor)
  level: number | null
  next_product_id: string | null
  max_capacity: number | null
  // v6 — duración del programa (meses) para control de renovación
  duration_months: number | null
  created_at: string
  updated_at: string
}

export type InsertProduct = Omit<Product, 'id' | 'created_at' | 'updated_at'>

// ==================== PAYMENT PLANS ====================
export type PaymentPlan = {
  id: string
  product_id: string
  name: string
  code: string | null
  gross_price: number
  number_of_payments: number
  financing_provider: string | null
  cash_collection_ratio: number
  // v10 — método y costes
  method: string | null
  fee_percent: number
  financing_surcharge_percent: number
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type InsertPaymentPlan = Omit<PaymentPlan, 'id' | 'created_at' | 'updated_at'>

export type PaymentPlanWithProduct = PaymentPlan & {
  products: Product
}

// ==================== SALES ====================
export type Sale = {
  id: string
  contact_id: string
  appointment_id: string | null
  product_id: string
  payment_plan_id: string
  sale_date: string
  refund_deadline_at: string
  gross_amount: number
  expected_commissionable_amount: number | null
  setter_id: string | null
  closer_id: string | null
  affiliate_id: string | null
  affiliate_commission_percent: number | null
  status: SaleStatus
  created_by: string
  updated_by: string | null
  notes: string | null
  // v3 — Matrículas
  cash_day1: number | null
  reservation_amount: number
  converted_from_reservation_id: string | null
  // v15 — Pagos: entrada + cuotas + completar reserva en la misma venta
  down_payment_amount: number
  installments_start_date: string | null
  installments_count: number | null
  reservation_completed_at: string | null
  payment_method: string | null
  is_upsell: boolean
  origin_sale_id: string | null
  from_follow_up: boolean
  discount: number
  processing_fee: number
  onboarding_date: string | null
  // v40 — tracking de onboarding vía webhooks de GHL
  onboarding_scheduled_at: string | null
  onboarding_session_at: string | null
  first_coaching_date: string | null
  graduation_date: string | null
  // v18 — conflicto de atribución (first vs last touch): último toque prevalece, admin revisa
  attribution_conflict: boolean
  attribution_meta: Record<string, unknown> | null
  // v29 — justificante de pago + plan de pagos personalizado
  payment_proof_url: string | null
  custom_plan: Record<string, unknown> | null
  // v38 — comprador (tomador) distinto del agendador
  buyer_is_scheduler: boolean
  payer_data: PayerData | null
  access_email: string | null
  created_at: string
  updated_at: string
}

// Datos del tomador/pagador cuando compra alguien distinto del alumno (v38)
export type PayerData = {
  name: string
  dni?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  relation?: string | null // relación con el alumno: madre, padre, empresa, socio…
}

export type InsertSale = Omit<Sale, 'id' | 'created_at' | 'updated_at'>

export type SaleWithRelations = Sale & {
  contacts: Contact
  products: Product
  payment_plans: PaymentPlan
  setter: User | null
  closer: User | null
  affiliate: User | null
}

// ==================== SALE EXPECTED INSTALLMENTS ====================
export type SaleExpectedInstallment = {
  id: string
  sale_id: string
  installment_number: number
  due_date: string | null
  expected_gross_amount: number
  expected_commissionable_amount: number
  status: 'pending' | 'collected' | 'overdue' | 'cancelled'
  // v11 — cuota de monitorización (p.ej. alumno→Sequra): NO es cash nuestro
  is_monitoring: boolean
  created_at: string
  updated_at: string
}

export type InsertSaleExpectedInstallment = Omit<SaleExpectedInstallment, 'id' | 'created_at' | 'updated_at'>

// ==================== COLLECTIONS ====================
export type Collection = {
  id: string
  sale_id: string
  expected_installment_id: string | null
  collected_at: string
  gross_amount: number
  commissionable_amount: number
  payment_method: string | null
  payment_provider: string | null
  payment_reference: string | null
  is_confirmed: boolean
  is_eligible_for_commission: boolean
  eligible_at: string | null
  status: CollectionStatus
  notes: string | null
  // v3 — Pagos
  recovered: boolean
  recovered_at: string | null
  processing_fee: number
  extra_fee: number
  payment_channel: 'online' | 'presencial' | 'automatico' | null
  from_follow_up: boolean
  vat: number
  invoice_link: string | null
  billing_info: string | null
  // v46 — revisión de comisiones (cuotas 2+ de un plan personalizado)
  needs_commission_review: boolean
  created_at: string
  updated_at: string
}

export type InsertCollection = Omit<Collection, 'id' | 'created_at' | 'updated_at'>

export type CollectionWithRelations = Collection & {
  sales: SaleWithRelations
}

// ==================== REFUNDS ====================
export type Refund = {
  id: string
  sale_id: string
  collection_id: string | null
  refund_date: string
  gross_refund_amount: number
  commissionable_refund_amount: number
  reason: string | null
  status: 'processed' | 'pending' | 'rejected'
  created_by: string
  notes: string | null
  created_at: string
  updated_at: string
}

export type InsertRefund = Omit<Refund, 'id' | 'created_at' | 'updated_at'>

// ==================== COMMISSION RULES ====================
export type CommissionRule = {
  id: string
  participant_type: ParticipantType
  percent: number
  active_from: string
  active_to: string | null
  is_active: boolean
  // v6 — tramos por cash collected + rep concreto
  user_id: string | null
  min_cash: number
  max_cash: number | null
  label: string | null
  // v30 — enlace opcional a un Tramo/nivel de gamificación (sales_tramos).
  // Si está definido, el % aplica cuando el rep está en ese nivel (en vez de por cash collected).
  tramo_id: string | null
  created_at: string
  updated_at: string
}

export type InsertCommissionRule = Omit<CommissionRule, 'id' | 'created_at' | 'updated_at'>

// ==================== COMMISSIONS ====================
export type Commission = {
  id: string
  sale_id: string
  collection_id: string | null
  refund_id: string | null
  user_id: string
  participant_type: ParticipantType
  percent: number
  base_amount: number
  commission_amount: number
  direction: CommissionDirection
  status: CommissionStatus
  liquidation_month: string
  approved_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type InsertCommission = Omit<Commission, 'id' | 'created_at' | 'updated_at'>

export type CommissionWithRelations = Commission & {
  users: User
  sales: Sale
  collections: Collection | null
}

// ==================== KPI FORM TEMPLATES ====================
export type KpiFormTemplate = {
  id: string
  role_key: string
  field_key: string
  field_label: string
  field_type: KpiFieldType
  placeholder: string | null
  help_text: string | null
  is_required: boolean
  is_active: boolean
  sort_order: number
  select_options: unknown | null
  default_value: unknown | null
  created_at: string
  updated_at: string
}

export type InsertKpiFormTemplate = Omit<KpiFormTemplate, 'id' | 'created_at' | 'updated_at'>

// ==================== KPI DAILY REPORTS ====================
export type KpiDailyReport = {
  id: string
  user_id: string
  role_key: string
  report_date: string
  data: Record<string, unknown>
  submitted_at: string | null
  created_at: string
  updated_at: string
}

export type InsertKpiDailyReport = Omit<KpiDailyReport, 'id' | 'created_at' | 'updated_at'>

// ==================== TARGETS ====================
export type Target = {
  id: string
  name: string
  scope_type: TargetScopeType
  scope_user_id: string | null
  scope_role_key: string | null
  metric_key: string
  period_type: TargetPeriodType
  period_start: string
  period_end: string
  target_value: number
  is_active: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export type InsertTarget = Omit<Target, 'id' | 'created_at' | 'updated_at'>

// ==================== SAVED DASHBOARD VIEWS ====================
export type SavedDashboardView = {
  id: string
  user_id: string
  name: string
  scope: 'private' | 'shared'
  filters: Record<string, unknown>
  widgets: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type InsertSavedDashboardView = Omit<SavedDashboardView, 'id' | 'created_at' | 'updated_at'>

// ==================== AUDIT LOGS ====================
export type AuditLog = {
  id: string
  actor_user_id: string | null
  entity_type: string
  entity_id: string
  action: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  created_at: string
}

// ==================== CAMPAIGNS (Marketing) ====================
export type Campaign = {
  id: string
  name: string
  channel: string
  type: string | null
  start_date: string | null
  end_date: string | null
  budget: number
  adspend: number
  impressions: number
  clicks: number
  leads_generated: number
  status: 'activa' | 'pausada' | 'finalizada'
  ad_source: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // v19 — integración Meta Marketing API
  provider: string | null // 'meta' cuando la campaña se vuelca desde Meta
  external_id: string | null // id de la campaña en Meta
  account_id: string | null // v27 — cuenta publicitaria de Meta (act_XXX) de origen
  account_name: string | null // v28 — nombre legible de la cuenta de Meta
  reach: number
  meta_leads: number // leads que reporta Meta
  funnel_leads: number // leads reales registrados en la app (cruce por UTM)
  synced_at: string | null
  // v28 — métricas de funnel de ads
  link_clicks: number // clics en el enlace (inline_link_clicks)
  landing_views: number // visitas a la página (landing_page_view)
  appointments_count: number // Agendas atribuidas (por UTM del contacto)
  shows_count: number // Llamadas / show up (agendas con status show/completed)
  sales_count: number // Cierres (ventas active/partial_refund)
  sales_revenue: number // Facturación atribuida (gross)
  // v29 — seguidores atribuidos por Meta (0 si no es campaña de captación)
  followers: number
}

export type InsertCampaign = Omit<Campaign, 'id' | 'created_at' | 'updated_at'>

// ==================== CAMPAIGN ADS (v29 — nivel anuncio) ====================
export type CampaignAd = {
  id: string
  external_id: string // ad id de Meta
  campaign_external_id: string | null // campaign id de Meta
  campaign_id: string | null // FK a campaigns.id
  account_id: string | null // act_XXX
  account_name: string | null // nombre legible de la cuenta
  name: string
  adset_name: string | null
  status: 'activa' | 'pausada' | 'finalizada' | null
  spend: number
  impressions: number
  clicks: number
  reach: number
  link_clicks: number
  landing_views: number
  leads: number
  followers: number
  synced_at: string | null
  created_at: string
}

// ==================== EXPENSES (Finanzas) ====================
export type Expense = {
  id: string
  concept: string
  category: 'publicidad' | 'sueldos' | 'comisiones' | 'herramientas' | 'eventos' | 'cogs' | 'impuestos' | 'otros'
  subcategory: string | null
  amount: number
  expense_date: string
  recurring: boolean
  frequency: 'mensual' | 'trimestral' | 'anual' | 'puntual' | null
  payment_method: string | null
  status: 'pagado' | 'en_revision' | 'pendiente'
  counterparty: string | null
  person_id: string | null
  notes: string | null
  created_by: string | null
  // v4 — factura + extracción IA
  invoice_url: string | null
  needs_review: boolean
  ai_extracted: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type InsertExpense = Omit<Expense, 'id' | 'created_at' | 'updated_at'>

// ==================== ACTIVITIES (Ventas) ====================
export type Activity = {
  id: string
  contact_id: string
  person_id: string | null
  type: 'llamada' | 'whatsapp' | 'email' | 'dm_instagram' | 'sms'
  activity_datetime: string
  direction: 'saliente' | 'entrante'
  result: string | null
  duration_min: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type InsertActivity = Omit<Activity, 'id' | 'created_at' | 'updated_at'>

// ==================== CSM EVENTS (Producto / Alumnos) ====================
export type CsmEvent = {
  id: string
  contact_id: string
  sale_id: string | null
  csm_id: string | null
  type: 'onboarding' | 'coaching' | 'revision' | 'graduacion' | 'soporte' | 'otro'
  event_datetime: string
  status: 'agendado' | 'confirmado' | 'completado' | 'no_show' | 'cancelado_admin' | 'cancelado_alumno' | 'reagendado'
  grade: number | null
  success: 'si' | 'no' | 'parcial' | null
  reminder: 'enviado' | 'no_enviado' | 'no_aplica' | null
  recording_url: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InsertCsmEvent = Omit<CsmEvent, 'id' | 'created_at' | 'updated_at'>

// ==================== DROPS / CANCELACIONES (Producto / Alumnos) ====================
export type Drop = {
  id: string
  sale_id: string | null
  contact_id: string
  request_date: string | null
  effective_date: string | null
  reason: string | null
  reason_detail: string | null
  type: 'voluntaria' | 'impago' | 'refund' | 'pausa'
  handled_by: string | null
  retention_action: string | null
  result: 'perdida' | 'recuperada' | 'en_proceso' | 'pausada'
  refund_amount: number
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InsertDrop = Omit<Drop, 'id' | 'created_at' | 'updated_at'>

// ==================== PARTNERS (socios / reparto de beneficios) ====================
export type Partner = {
  id: string
  name: string
  user_id: string | null
  profit_percent: number
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type InsertPartner = Omit<Partner, 'id' | 'created_at' | 'updated_at'>

// ==================== CONTRACTS ====================
export type Contract = {
  id: string
  sale_id: string | null
  contact_id: string | null
  title: string | null
  url: string | null
  status: 'pendiente' | 'enviado' | 'firmado'
  signed_at: string | null
  notes: string | null
  created_by: string | null
  // v16 — contratos de equipo con firma digital nativa
  kind: 'venta' | 'equipo'
  user_id: string | null
  template_id: string | null
  signing_token: string | null
  terms: Record<string, unknown> | null
  body_snapshot: string | null
  sent_at: string | null
  signer_name: string | null
  signer_ip: string | null
  signer_user_agent: string | null
  signed_hash: string | null
  signed_pdf_url: string | null
  // v17 — datos del firmante + rol elegido + email
  signer_data: Record<string, unknown> | null
  contract_role: string | null
  email_sent_at: string | null
  // v29 — tracking de alumno + onboarding
  read_at: string | null
  accesos_enviados_at: string | null
  accesos_abiertos_at: string | null
  onboarding_webhook_ok: boolean | null
  // v38 — reserva (no dispara accesos) + parte del contrato (alumno vs tomador)
  is_reservation: boolean
  contract_party: 'alumno' | 'tomador'
  created_at: string
  updated_at: string
}

export type InsertContract = Omit<Contract, 'id' | 'created_at' | 'updated_at'>

// v16 — plantillas de contrato (cuerpo con variables {{...}})
export type ContractTemplate = {
  id: string
  name: string
  role_key: string | null
  body: string
  is_active: boolean
  created_by: string | null
  // v29 — tipo de plantilla + mensaje de bienvenida (alumno)
  kind: 'equipo' | 'alumno' | 'tomador'
  welcome_message: string | null
  // v38 — plantilla asociada a un método de pago (null = por defecto / cualquiera)
  payment_method: string | null
  created_at: string
  updated_at: string
}

export type InsertContractTemplate = Omit<ContractTemplate, 'id' | 'created_at' | 'updated_at'>

export type InsertAuditLog = Omit<AuditLog, 'id' | 'created_at'>

// v21 — sugerencias y mejoras de la plataforma enviadas por los usuarios
export type SuggestionType = 'mejora' | 'error' | 'comentario'
export type SuggestionStatus =
  | 'nueva' | 'en_revision' | 'planificada' | 'en_progreso' | 'resuelta' | 'descartada'

export type Suggestion = {
  id: string
  user_id: string | null
  type: SuggestionType
  title: string
  message: string
  status: SuggestionStatus
  admin_notes: string | null
  page_url: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null // v53 — fecha en la que pasó a 'resuelta' (ranking Kaizen)
}

export type SuggestionWithUser = Suggestion & {
  users: { full_name: string | null; email: string | null } | null
}

// v53 — Kaizen: agregados de sugerencias por miembro del equipo (para el
// dashboard de reconocimiento). Solo contadores, nunca el contenido.
export type SuggestionTeamStat = {
  user_id: string
  full_name: string | null
  email: string | null
  total: number
  by_status: Record<SuggestionStatus, number>
  resolved_total: number
  resolved_this_month: number
}

// v38 — Roleplays de entrenamiento (biblioteca de llamadas → pestaña Roleplays)
export type Roleplay = {
  id: string
  title: string
  description: string | null
  participant_id: string | null
  participant_name: string | null
  recording_url: string | null
  transcript_url: string | null
  transcript: string | null
  score: number | null
  notes: string | null
  shared: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type InsertRoleplay = Omit<Roleplay, 'id' | 'created_at' | 'updated_at'>
