import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getOrCreateContact } from '@/lib/contacts/resolve'
import { leerToque, registrarToque, toqueTieneDatos } from '@/lib/contacts/atribucion'
import { attributionDateBeforeCutoff, resolverRefColaborador } from '@/lib/collaborators/ref-signal'
import { firstMemberOf, resolveUserIdByTrackingCode } from '@/lib/tracking'
import { isValidWebhookSecret, diagnosticoCabeceras } from '@/lib/webhooks/verifySecret'
import { mapearEstadoExterno } from '@/lib/appointments/status'
import { NORMALIZADOR_GHL, propiedadesSinPii, sobreCrudoGhl, tipoEventoGhl } from '@/lib/eventos/ghl'
import { getTenantConfigWithFallback } from '@/lib/config'

// Webhook único de GHL (+ player VSL). Maneja, de forma IDEMPOTENTE, varios eventos:
//   - lead opt-in (solo contacto + atribución, sin agenda)
//   - agenda creada            (upsert por external_id)
//   - agenda actualizada       (show / no_show / confirmada / cancelada)  → actualiza, NO duplica
//   - progreso de VSL          (% visto)   [requiere columnas contacts.vsl_* — ver nota]
// Identificación: external_id (appointmentId de GHL) primero; email/teléfono como fallback.

const pick = <T>(...vals: (T | undefined | null)[]) => vals.find((v) => v !== undefined && v !== null) ?? null

// --- Cualificación (respuestas del formulario), igual criterio que el webhook de Calendly ---
const normQ = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const slugifyQ = (s: string) =>
  normQ(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
function mapKeyQ(q: string): string | null {
  const s = normQ(q)
  if (/telefono|whatsapp|numero de tel/.test(s)) return 'telefono'
  if (/instagram/.test(s)) return 'instagram'
  if (/\bedad\b|anos|años|que edad/.test(s)) return 'edad'
  if (/se ajusta mejor|situacion|ocupacion|estudiante|emprend/.test(s)) return 'situacion'
  if (/generando al mes|estas ganando|ingresos|cuanto estas generando/.test(s)) return 'ingresos'
  if (/escala del 1 al 10|comprometido|compromiso/.test(s)) return 'compromiso'
  if (/motivo real|motivo|por que|razon/.test(s)) return 'motivo'
  if (/invertir|capaz de invertir|inversion/.test(s)) return 'inversion'
  if (/presentarte|confirmas|puedes presentarte|faltes a la reunion/.test(s)) return 'confirma_asistencia'
  if (/vsl|entrenamiento gratuito|visto nuestro/.test(s)) return 'vio_vsl'
  return null
}
// Construye la cualificación desde un payload de GHL. Acepta:
//   - questions_and_answers: [{question, answer}]  (reenvío estilo Calendly)
//   - customFields / custom_fields: {label|name: value} o [{name/label, value}]
function buildQualification(payload: Record<string, unknown>): Record<string, unknown> | null {
  const pairs: Array<{ q: string; a: string }> = []
  const qa = payload.questions_and_answers ?? payload.questionsAndAnswers
  if (Array.isArray(qa)) {
    for (const it of qa) {
      const q = (it?.question ?? it?.q ?? '').toString().trim()
      const a = (it?.answer ?? it?.a ?? '').toString().trim()
      if (q) pairs.push({ q, a })
    }
  }
  const cf = payload.customFields ?? payload.custom_fields
  if (Array.isArray(cf)) {
    for (const it of cf) {
      const q = (it?.name ?? it?.label ?? it?.key ?? '').toString().trim()
      const a = (it?.value ?? it?.answer ?? '').toString().trim()
      if (q) pairs.push({ q, a })
    }
  } else if (cf && typeof cf === 'object') {
    for (const [q, v] of Object.entries(cf as Record<string, unknown>)) {
      if (q) pairs.push({ q, a: v == null ? '' : String(v) })
    }
  }
  if (pairs.length === 0) return null
  const qualification: Record<string, unknown> = {}
  for (const { q, a } of pairs) qualification[mapKeyQ(q) || slugifyQ(q)] = a
  qualification.respuestas = pairs.map(({ q, a }) => ({ q, a }))
  return qualification
}

// La traducción de estados vive en lib/appointments/status.ts, compartida con la sincronización por
// cron: tenerla duplicada las separó, y la del cron guardaba "no-show" como "programada".
const mapStatus = mapearEstadoExterno

// Acotado a la subcuenta: `users` es GLOBAL (la pertenencia vive en tenant_members), así que sin el
// filtro un email resolvía a cualquier usuario de la plataforma y la agenda —con su comisión— podía
// caer en el closer de otra subcuenta.
async function userIdByEmail(sb: SupabaseClient, tenantId: string, email?: string | null): Promise<string | null> {
  if (!email) return null
  const { data } = await sb.from('users').select('id').eq('email', email.toLowerCase().trim()).limit(20)
  return firstMemberOf(
    sb,
    tenantId,
    (data ?? []).map((u) => (u as { id: string }).id)
  )
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const secret = req.headers.get('x-ghl-secret')

    // MODO DIAGNÓSTICO del transporte (?diagnostico=1): eco medible de lo que GHL envía — nombres
    // de cabeceras tal como llegó, presencia/huella del secret (sha256 truncado; JAMÁS el valor) y
    // veredicto server-side contra lo configurado en el panel. No autentica, no toca datos: sirve
    // para responder "¿la cabecera llega intacta?" cuando el alta en GHL no produce entregas 200.
    if (req.nextUrl.searchParams.get('diagnostico') === '1') {
      const sbDiag = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      const { tenant: tenantDiag } = await params
      const { data: filaDiag } = await sbDiag
        .from('tenants')
        .select('id')
        .eq('slug', tenantDiag)
        .eq('status', 'active')
        .maybeSingle()
      const cfgDiag = filaDiag ? await getTenantConfigWithFallback(filaDiag.id, true) : {}
      return NextResponse.json({
        ok: true,
        modo: 'diagnostico',
        subcuenta_encontrada: Boolean(filaDiag),
        cabeceras_recibidas: [...req.headers.keys()],
        diagnostico: diagnosticoCabeceras(req.headers, cfgDiag.GHL_WEBHOOK_SECRET || process.env.GHL_WEBHOOK_SECRET),
      })
    }

    // EL SECRETO ES POR SUBCUENTA, como en el webhook de Stripe.
    //
    // Antes se leía solo de `process.env.GHL_WEBHOOK_SECRET`, pero el catálogo de integraciones
    // declara `GHL_WEBHOOK_SECRET` como campo OBLIGATORIO de GHL en el panel de cada subcuenta. Es
    // decir: la app pedía configurarlo ahí y el webhook nunca lo leía. Quien siguiera las
    // instrucciones del propio producto seguía recibiendo 401, sin ninguna pista de por qué.
    //
    // Además, un secreto global es un fallo de aislamiento: con él, el webhook de un cliente podría
    // escribir en los datos de otro sin más que cambiar el slug de la URL.
    //
    // El entorno se mantiene como respaldo para no romper una instalación que ya dependiera de él.
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { tenant } = await params
    const { data: tenantRow } = await sb
      .from('tenants')
      .select('id, status')
      .eq('slug', tenant)
      .eq('status', 'active')
      .single()

    // Subcuenta inexistente y secreto incorrecto responden IGUAL. Resolver el tenant antes de
    // autenticar permitiría, si no, distinguir 404 de 401 y enumerar slugs sin credencial alguna.
    if (!tenantRow) {
      // Obsabilidad de alta: si GHL apunta a un slug mal, aquí se ve en los logs de Vercel.
      console.warn('[ghl-webhook] 401: subcuenta inexistente o inactiva:', tenant)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = tenantRow.id

    const cfg = await getTenantConfigWithFallback(tenantId, true)
    const esperado = cfg.GHL_WEBHOOK_SECRET || process.env.GHL_WEBHOOK_SECRET
    // Fail-closed: si el secret no está configurado o no coincide, rechazamos.
    if (!isValidWebhookSecret(secret, esperado)) {
      // SE REGISTRA CUÁL DE LAS CUATRO CAUSAS ES, no solo que hubo un 401.
      //
      // "Cabecera ausente o inválida" agrupa cuatro problemas que no se parecen en nada y que se
      // arreglan en sitios distintos: que GHL no mande la cabecera, que el secreto no esté guardado
      // en el panel, que se haya pegado cortado, o que simplemente no coincida. Sin distinguirlas,
      // averiguarlo desde fuera cuesta un ciclo entero de prueba y error — ya pasó.
      //
      // La RESPUESTA sigue siendo opaca: quien llama no está autenticado y no merece pistas. El
      // motivo va al log del servidor, y nunca los valores: solo presencia y longitud, que es lo
      // que distingue "no llega" de "llega cortado" de "no coincide" sin revelar el secreto.
      const motivo = !esperado
        ? 'no hay GHL_WEBHOOK_SECRET guardado para esta subcuenta (Configuración → Integraciones → GoHighLevel)'
        : !secret
          ? 'la petición no trae la cabecera x-ghl-secret: falta añadirla en el webhook de GHL'
          : secret.length !== esperado.length
            ? `longitudes distintas (recibida ${secret.length}, esperada ${esperado.length}): copiado incompleto o con espacios`
            : 'la cabecera tiene la longitud correcta pero no coincide: son dos valores distintos'
      console.warn(`[ghl-webhook] 401 en "${tenant}": ${motivo}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await req.json()

    // GHL puede enviar los campos de 3 formas: planos, dentro de "customData",
    // o anidados en "contact"/"appointment". Normalizamos todo al nivel raíz para
    // que dé igual cómo esté configurado el webhook en GHL.
    const empty = (v: unknown) => v === undefined || v === null || v === ''
    const fill = (obj: unknown) => {
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (empty((payload as Record<string, unknown>)[k])) (payload as Record<string, unknown>)[k] = v
        }
      }
    }
    const overwrite = (obj: unknown) => {
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (!empty(v)) (payload as Record<string, unknown>)[k] = v
        }
      }
    }
    fill(payload.contact)
    fill(payload.appointment)
    fill(payload.full_contact)
    overwrite(payload.customData)
    overwrite(payload.custom_data)

    // ── CAPA EN BRUTO (F1) ──────────────────────────────────────────────────────────────────
    //
    // El sobre se guarda ANTES de procesar nada. Hasta ahora el webhook leía el payload, escribía
    // contacto y cita, y lo tiraba: si el normalizador tenía un fallo, no había nada que reprocesar.
    // Guardarlo primero es lo que hace posible el replay (docs/plan/08-fases-s0-f4.md §F1).
    //
    // NADA DE ESTO PUEDE TUMBAR LA INGESTA: si la escritura del sobre falla, se registra y se sigue.
    // Perder la capacidad de reprocesar es malo; perder la cita de un cliente, peor.
    let sobreId: string | null = null
    try {
      const sobre = sobreCrudoGhl(payload, JSON.stringify(payload).length)
      const { data: guardado, error: errorSobre } = await sb
        .from('raw_events')
        .upsert(
          {
            tenant_id: tenantId,
            ...sobre,
            payload,
            user_agent: req.headers.get('user-agent'),
            request_origin: req.headers.get('origin'),
          },
          // GHL reintenta la misma entrega ante cualquier duda: el parcial
          // (tenant, source, source_event_id) convierte el reintento en la misma fila.
          { onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: false }
        )
        .select('id')
        .single()
      if (errorSobre) console.warn('[ghl-webhook] no se pudo guardar el sobre en bruto:', errorSobre.message)
      sobreId = guardado?.id ?? null
    } catch (e) {
      console.warn('[ghl-webhook] sobre en bruto:', e instanceof Error ? e.message : e)
    }

    /**
     * Cierra el sobre con lo que de verdad pasó y responde. Todas las salidas pasan por aquí: si
     * alguna se saltara este punto, el sobre se quedaría en "recibido" para siempre y el replay no
     * sabría distinguir lo procesado de lo que se quedó a medias.
     */
    const responder = async (cuerpo: Record<string, unknown>, init?: { status?: number }) => {
      const fallo = (init?.status ?? 200) >= 400
      if (sobreId) {
        await sb
          .from('raw_events')
          .update({
            processing_status: fallo ? 'rejected' : 'normalized',
            processed_at: new Date().toISOString(),
            normalizer_version: NORMALIZADOR_GHL,
            rejection_reason: fallo ? String(cuerpo.error ?? 'error al procesar') : null,
          })
          .eq('id', sobreId)
          .then(({ error }) => {
            if (error) console.warn('[ghl-webhook] no se pudo cerrar el sobre:', error.message)
          })
      }
      return NextResponse.json(cuerpo, init)
    }

    const event = (req.nextUrl.searchParams.get('event') || payload.event || payload.type || '').toLowerCase()

    // --- Campos comunes ---
    const email = (pick(payload.email) as string | null)?.toLowerCase?.()?.trim() || null
    const phone = (pick(payload.phone) as string | null)?.trim() || null
    const fullName =
      `${pick(payload.firstName, payload.first_name) || ''} ${pick(payload.lastName, payload.last_name) || ''}`.trim() ||
      null
    const externalId = pick(payload.appointmentId, payload.appointment_id) as string | null
    const ghlContactId = pick(
      payload.contactId,
      payload.contact_id,
      payload.ghlContactId,
      payload.ghl_id,
      payload.id
    ) as string | null
    const aptRaw = pick(payload.appointmentDate, payload.appointment_date, payload.startTime, payload.start_time) as
      string | null
    const status = mapStatus(pick(payload.status, payload.appointmentStatus, payload.appointment_status))
    const source = pick(payload.source) as string | null
    // UTMs de PRIMER contacto (first-touch) — acepta utm_source_first / utmSourceFirst
    const firstUtm = {
      first_utm_source: pick(payload.utm_source_first, payload.utmSourceFirst),
      first_utm_medium: pick(payload.utm_medium_first, payload.utmMediumFirst),
      first_utm_campaign: pick(payload.utm_campaign_first, payload.utmCampaignFirst),
      first_utm_content: pick(payload.utm_content_first, payload.utmContentFirst),
      first_utm_term: pick(payload.utm_term_first, payload.utmTermFirst),
    }
    // UTMs de ÚLTIMO contacto (last-touch) — acepta utm_source_last / utmSourceLast
    const lastUtm = {
      last_utm_source: pick(payload.utm_source_last, payload.utmSourceLast),
      last_utm_medium: pick(payload.utm_medium_last, payload.utmMediumLast),
      last_utm_campaign: pick(payload.utm_campaign_last, payload.utmCampaignLast),
      last_utm_content: pick(payload.utm_content_last, payload.utmContentLast),
      last_utm_term: pick(payload.utm_term_last, payload.utmTermLast),
    }
    // UTMs "primarias" (columnas utm_*): usa las planas si vienen, si no las last, si no las first
    const utm = {
      utm_source: pick(payload.utm_source, payload.utmSource, lastUtm.last_utm_source, firstUtm.first_utm_source),
      utm_medium: pick(payload.utm_medium, payload.utmMedium, lastUtm.last_utm_medium, firstUtm.first_utm_medium),
      utm_campaign: pick(
        payload.utm_campaign,
        payload.utmCampaign,
        lastUtm.last_utm_campaign,
        firstUtm.first_utm_campaign
      ),
      utm_content: pick(payload.utm_content, payload.utmContent, lastUtm.last_utm_content, firstUtm.first_utm_content),
      utm_term: pick(payload.utm_term, payload.utmTerm, lastUtm.last_utm_term, firstUtm.first_utm_term),
    }
    const hasUtm = [utm, firstUtm, lastUtm].some((o) => Object.values(o).some(Boolean))
    // Duración de la reunión en minutos (directa, o calculada de inicio/fin)
    const aptEndRaw = pick(payload.endTime, payload.end_time, payload.appointmentEnd) as string | null
    let durationMin = pick(payload.duration_minutes, payload.durationMinutes, payload.duration) as number | null
    if (durationMin == null && aptRaw && aptEndRaw) {
      const diff = (new Date(aptEndRaw).getTime() - new Date(aptRaw).getTime()) / 60000
      if (diff > 0 && diff < 24 * 60) durationMin = Math.round(diff)
    }
    const now = new Date().toISOString()

    // --- 1) Resolver/crear contacto ---
    // Matching por prioridad: ghl_contact_id → email → teléfono. Así leads, contactos
    // y agendas comparten el MISMO contacto (fuente única) y el estado se sincroniza solo.
    // Atómico en la base de datos: el check-then-insert que había aquí creaba dos contactos para el
    // mismo lead cuando dos entregas (reintento de GHL, o GHL y Calendly a la vez) se solapaban.
    if (!email && !phone && !ghlContactId) {
      return await responder(
        { error: 'Falta email, teléfono o ID de contacto para identificar el contacto' },
        { status: 400 }
      )
    }
    const parts = (fullName || '').split(' ')
    const resolved = await getOrCreateContact(sb, tenantId, {
      email,
      phone,
      ghlContactId,
      fullName,
      firstName: parts[0] || null,
      lastName: parts.slice(1).join(' ') || null,
      seenAt: now,
    })
    if (!resolved.ok) {
      return await responder({ error: 'Error creando contacto', detail: resolved.error }, { status: 500 })
    }
    const contact = resolved.contact

    // ATRIBUCIÓN. El toque se registra conservando el PRIMERO: si alguien llega por un anuncio y vuelve
    // semanas después por un email, el anuncio es quien lo trajo, y machacarlo haría que el canal que
    // remata se llevara el mérito del que capta — y con eso se decide el presupuesto.
    //
    // Hoy esto casi nunca escribe nada, y no es un fallo de aquí: los payloads no traen UTMs porque los
    // enlaces de reserva no los llevan (0 de 559 citas tienen utm_source). El camino queda puesto para
    // cuando empiecen a llegar. Un fallo al atribuir NO tumba el webhook: la cita y el contacto valen más
    // que su procedencia.
    // COLABORADOR del enlace (?ref=CODIGO) o de un CAMPO PERSONALIZADO de GHL:
    // la señal vive en ref-signal.ts (regla en un sitio). Se resuelve server-side
    // al UUID del perfil (el código legible nunca es identidad) y entra en el
    // toque como relación estructurada (contact_attributions.collaborator_id).
    // utm_content sigue viviendo para reporting/interoperabilidad; esto es la FK
    // que usa el dinero. Regla: first-collaborator-wins — la fija registrarToque.
    //
    // CUTOFF (regla del propietario): un contacto con fecha real ANTERIOR a
    // agosto 2026 NO se atribuye a colaboradores, venga el código por donde
    // venga. De agosto para atrás, no — y ningún toque nuevo re-atribuye.
    let colaboradorId: string | null = null
    let refCode: string | null = null
    const ref = await resolverRefColaborador(sb, tenantId, payload)
    refCode = ref?.code ?? null
    // SOLO AGENDARON (regla del propietario): el código solo atribuye cuando la
    // entrega representa una CITA VIVA (creación/actualización no cancelada).
    // El lead que llegó y no pidió cita —o cuya entrega es una cancelación— no
    // es del colaborador. El cutoff de agosto 2026 sigue vigente debajo.
    const traeCitaViva = !!(externalId || aptRaw || status || event.startsWith('appointment')) && status !== 'cancelled'
    if (ref) {
      if (!traeCitaViva) {
        console.info('[colaborador] entrega sin cita viva: no se atribuye (regla solo-agendaron)')
      } else if (resolved.created) {
        // Contacto nuevo: nace hoy, siempre posterior al cutoff.
        colaboradorId = ref.id
      } else {
        // Re-entrega de un contacto existente: el cutoff se decide por su fecha
        // real (first_seen_at de GHL). Solo se consulta cuando hay código.
        const { data: fechas } = await sb
          .from('contacts')
          .select('first_seen_at, created_at')
          .eq('id', contact.id)
          .eq('tenant_id', tenantId)
          .maybeSingle()
        if (!attributionDateBeforeCutoff(fechas ?? {})) {
          colaboradorId = ref.id
        } else {
          console.info('[colaborador] contacto anterior al cutoff 2026-08-01: no se atribuye a colaboradores')
        }
      }
    }
    try {
      const toque = leerToque(payload)
      // Si el código llegó por campo personalizado (no por ?ref=), utm_content
      // no lo trae: lo relleno con el código normalizado para que la capa de
      // datos (triggers de backfill, reporting) vea la misma señal textual.
      if (refCode && !toque.utmContent) toque.utmContent = refCode
      if (colaboradorId || toqueTieneDatos(toque)) {
        await registrarToque(sb, tenantId, contact.id, { ...toque, enEl: now, colaboradorId })
      }
    } catch (e) {
      console.warn('[atribucion] no se pudo registrar el toque:', e instanceof Error ? e.message : e)
    }
    if (!resolved.created) {
      await sb
        .from('contacts')
        .update({
          last_seen_at: now,
          ...(fullName && !contact.full_name ? { full_name: fullName } : {}),
          ...(phone ? { phone } : {}),
          // Backfill del ID de GHL si aún no lo teníamos
          ...(ghlContactId && !contact.ghl_contact_id ? { ghl_contact_id: ghlContactId } : {}),
        })
        .eq('id', contact.id)
        .eq('tenant_id', tenantId)
    }

    // --- Cualificación del formulario (si GHL la reenvía) ---
    // Se vuelca al contacto para que Atribución/Dashboard puedan revisar la calidad
    // del lead. Al reprogramar/actualizar sin reenviar el formulario, no se pisa
    // (solo escribimos cuando llegan respuestas).
    const ghlQualification = buildQualification(payload as Record<string, unknown>)
    if (ghlQualification) {
      for (const { q } of ghlQualification.respuestas as Array<{ q: string; a: string }>) {
        // Mismo fallo que en el webhook de Calendly: faltaba tenant_id (NOT NULL) y el error se
        // tragaba, así que el auto-registro de preguntas no ha funcionado nunca desde que la app
        // es multi-tenant. Y el unique era global sobre slug, de modo que dos subcuentas no podían
        // registrar la misma pregunta ni queriendo.
        const { error: qqError } = await sb
          .from('qualification_questions')
          .upsert(
            { tenant_id: tenantId, slug: slugifyQ(q), question_text: q, field_key: mapKeyQ(q) },
            { onConflict: 'tenant_id,slug', ignoreDuplicates: true }
          )
        if (qqError) console.error('[ghl] no se pudo registrar la pregunta de cualificación:', qqError.message)
      }
      await sb
        .from('contacts')
        .update({ qualification: ghlQualification, qualification_updated_at: now })
        .eq('id', contact.id)
        .eq('tenant_id', tenantId)
    }

    // --- 2) Atribución (solo si llegan UTMs/source) ---
    if (hasUtm || source) {
      const { data: attr } = await sb
        .from('contact_attributions')
        .select('id, source')
        .eq('contact_id', contact.id)
        .eq('tenant_id', tenantId)
        .eq('is_primary', true)
        .maybeSingle()
      if (attr) {
        await sb
          .from('contact_attributions')
          .update({ last_touch_at: now, ...utm, ...lastUtm, source: source || attr.source })
          .eq('id', attr.id)
      } else {
        await sb.from('contact_attributions').insert({
          tenant_id: tenantId,
          contact_id: contact.id,
          source,
          ...utm,
          ...firstUtm,
          ...lastUtm,
          first_touch_at: now,
          last_touch_at: now,
          is_primary: true,
        })
      }
    }

    // --- 3) Progreso de VSL ---
    const vslPct = pick(payload.vsl_watch_pct, payload.watch_percent, payload.watchPercent, payload.progress) as
      number | null
    if (event.startsWith('vsl') || vslPct !== null) {
      // Requiere columnas: contacts.vsl_watch_pct (numeric), contacts.vsl_watched_at (timestamptz)
      const { error } = await sb
        .from('contacts')
        .update({ vsl_watch_pct: vslPct, vsl_watched_at: now })
        .eq('id', contact.id)
        .eq('tenant_id', tenantId)
      if (error) {
        return await responder({
          ok: true,
          contactId: contact.id,
          vslStored: false,
          note: 'Faltan columnas vsl_* (ejecutar migración)',
        })
      }
      return await responder({ ok: true, contactId: contact.id, vslStored: true, vslPct })
    }

    // --- 4) Asignación closer/setter ---
    const closerId = await userIdByEmail(
      sb,
      tenantId,
      pick(payload.closerEmail, payload.closer_email, payload.assignedUserEmail, payload.userEmail) as string
    )
    let setterId = await userIdByEmail(sb, tenantId, pick(payload.setterEmail, payload.setter_email) as string)
    // Si GHL no manda el setter por email, atribúyelo por el utm_term del enlace de agenda del setter
    // (utm_term → users.tracking_code), igual que en Calendly, para que su agenda se le contabilice.
    if (!setterId && utm.utm_term) {
      setterId = await resolveUserIdByTrackingCode(sb, utm.utm_term, tenantId)
    }
    // Si el lead/agenda viene de un setter, deja constancia del origen en el
    // contacto (sin pisar un origen ya asignado) → marca "De setter" en Leads.
    if (setterId) {
      await sb
        .from('contacts')
        .update({ set_source: 'setter' })
        .eq('id', contact.id)
        .eq('tenant_id', tenantId)
        .is('set_source', null)
    }

    const isAppointmentEvent = !!(externalId || aptRaw || status || event.startsWith('appointment'))
    if (!isAppointmentEvent) {
      // Solo era un lead opt-in (pre-VSL): contacto + atribución, sin agenda.
      console.log('[ghl-webhook] ok: lead', contact.id)
      return await responder({ ok: true, kind: 'lead', contactId: contact.id })
    }

    // --- 5) Upsert idempotente de la agenda ---
    let appt: { id: string } | null = null
    if (externalId) {
      const { data } = await sb
        .from('appointments')
        .select('id')
        .eq('external_id', externalId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      appt = data
    }
    // Fallback: actualización de estado sin external_id → última agenda del contacto
    if (!appt && status && !aptRaw) {
      const { data } = await sb
        .from('appointments')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('tenant_id', tenantId)
        .order('appointment_datetime', { ascending: false })
        .limit(1)
        .maybeSingle()
      appt = data
    }

    if (appt) {
      const upd: Record<string, unknown> = { updated_at: now }
      if (status) upd.status = status
      if (aptRaw) upd.appointment_datetime = new Date(aptRaw).toISOString()
      if (closerId) upd.closer_id = closerId
      if (setterId) upd.setter_id = setterId
      if (hasUtm) Object.assign(upd, utm)
      if (durationMin != null) upd.duration_minutes = durationMin
      if (ghlQualification) upd.qualification = ghlQualification
      await sb.from('appointments').update(upd).eq('id', appt.id).eq('tenant_id', tenantId)
      // El lead pasa a 'agendado' al confirmarse/actualizarse su agenda
      await sb.from('contacts').update({ lead_status: 'agendado' }).eq('id', contact.id).eq('tenant_id', tenantId)
      await sb.from('audit_logs').insert({
        tenant_id: tenantId,
        entity_type: 'appointment',
        entity_id: appt.id,
        action: 'update',
        new_values: { ...upd, via: 'ghl_webhook' },
      })
      console.log('[ghl-webhook] ok: appointment.updated', appt.id, status ?? '')
      return await responder({
        ok: true,
        kind: 'appointment.updated',
        contactId: contact.id,
        appointmentId: appt.id,
        status: status ?? undefined,
      })
    }

    const newAppt = {
      tenant_id: tenantId,
      contact_id: contact.id,
      external_source: 'ghl',
      external_id: externalId,
      appointment_datetime: aptRaw ? new Date(aptRaw).toISOString() : now,
      duration_minutes: durationMin,
      status: status || 'scheduled',
      closer_id: closerId,
      setter_id: setterId,
      calendar_name: pick(payload.calendarName, payload.calendar_name),
      pipeline_name: pick(payload.pipelineName, payload.pipeline_name),
      pipeline_stage: pick(payload.pipelineStage, payload.pipeline_stage),
      source,
      ...utm,
      ...(ghlQualification ? { qualification: ghlQualification } : {}),
      raw_payload: payload,
    }
    // Upsert por (tenant_id, external_id) en vez de INSERT plano: el SELECT de arriba no
    // encontró la cita, pero dos entregas casi simultáneas del mismo webhook (GHL reintenta)
    // pueden llegar ambas a este punto sin haberse visto la una a la otra. Con INSERT plano la
    // segunda rompía con un 500 sin explicación (ver appointments_tenant_external_id_key); con
    // upsert, la segunda actualiza la misma fila en vez de fallar — mismo patrón que Calendly.
    const { data: created, error: aptErr } = externalId
      ? await sb.from('appointments').upsert(newAppt, { onConflict: 'tenant_id,external_id' }).select('id').single()
      : await sb.from('appointments').insert(newAppt).select('id').single()
    if (aptErr) return await responder({ error: 'Error creando agenda', detail: aptErr.message }, { status: 500 })

    // El lead pasa a 'agendado' al crearse su agenda
    await sb.from('contacts').update({ lead_status: 'agendado' }).eq('id', contact.id).eq('tenant_id', tenantId)
    await sb.from('audit_logs').insert({
      tenant_id: tenantId,
      entity_type: 'appointment',
      entity_id: created.id,
      action: 'create',
      new_values: { contact_id: contact.id, source, ...utm, via: 'ghl_webhook' },
    })
    console.log('[ghl-webhook] ok: appointment.created', created.id)
    return await responder({
      ok: true,
      kind: 'appointment.created',
      contactId: contact.id,
      appointmentId: created.id,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal error', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
