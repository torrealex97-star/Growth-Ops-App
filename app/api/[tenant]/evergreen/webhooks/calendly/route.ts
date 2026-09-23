import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { firstMemberOf, resolveUserIdByTrackingCode } from '@/lib/tracking'
import { sql } from '@/lib/vsl/db'
import { mapKey, slugify } from '@/lib/qualification'
import { notifyCreatuagente, toZonedISO, addMinutesISO } from '@/lib/creatuagente'
import { getTenantConfigWithFallback } from '@/lib/config'
import { getOrCreateContact } from '@/lib/contacts/resolve'
import { leerToque, registrarToque, toqueTieneDatos } from '@/lib/contacts/atribucion'
import { resolverColaboradorPorCodigo } from '@/lib/collaborators/scope'

export const runtime = 'nodejs'

// Webhook de Calendly (invitee.created / invitee.canceled).
// - Encaja el contacto por email → teléfono (o lo crea).
// - Asigna CLOSER por el email del dueño del calendario (event_memberships) y SETTER por utm_term (users.tracking_code).
// - Guarda respuestas del formulario en appointments.qualification (mapeo fino + auto-registro de preguntas).
// - Guarda enlace de reunión (Meet), reschedule_url, UTMs first/last, duración.
// - Cancelación/Reprogramación sincronizadas.

function verifySignature(raw: string, header: string | null, secret: string | undefined): boolean {
  // Fail-closed: sin secret configurado no aceptamos el webhook.
  if (!secret) return false
  if (!header) return false
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=').map((s) => s.trim())))
  const t = parts['t']
  const v1 = parts['v1']
  if (!t || !v1) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
  } catch {
    return false
  }
}

const digits = (s: unknown) => (typeof s === 'string' ? s.replace(/[^\d+]/g, '') : null)

// Engancha el visionado del VSL a la cita y guarda el % visto en el contacto.
// - anon: anon_id que viaja en el enlace de Calendly (salesforce_uuid) para leads SIN optin.
// - email: si además hay email, identifica retroactivamente esas sesiones anónimas.
// Toma el MAYOR % entre las sesiones del lead (por anon y/o email). Nunca rompe el webhook.
// Usa el cliente postgres (sql) directo, igual que el resto del módulo VSL.
async function attachVslWatch(opts: {
  anon: string | null
  email: string | null
  contactId: string
  now: string
  tenantId: string
}) {
  const { anon, email, contactId, now, tenantId } = opts
  if (!anon && !email) return
  const a = anon || '__no_anon__'
  const e = email || '__no_email__'
  try {
    if (anon && email) {
      await sql`UPDATE vsl_sessions SET lead_email = ${email} WHERE anon_id = ${anon} AND lead_email IS NULL AND tenant_id = ${tenantId}`
    }
    const rows = await sql`
      SELECT max_position, duration FROM vsl_sessions
      WHERE (anon_id = ${a} OR lead_email = ${e}) AND tenant_id = ${tenantId}
    `
    let best = 0
    for (const s of rows) {
      const dur = Number(s.duration) || 0
      if (dur <= 0) continue
      const pct = Math.min(100, Math.round((Number(s.max_position) / dur) * 100))
      if (pct > best) best = pct
    }
    if (best > 0) {
      await sql`
        UPDATE contacts
        SET vsl_watch_pct = GREATEST(COALESCE(vsl_watch_pct, 0), ${best}), vsl_watched_at = ${now}
        WHERE id = ${contactId} AND tenant_id = ${tenantId}
      `
    }
  } catch {
    // tabla vsl_sessions o columnas vsl_* ausentes en algún entorno -> se ignora
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const raw = await req.text()

    // LA SUBCUENTA, ANTES DE LA FIRMA. Su secreto es suyo: Integraciones pide la "Webhook Signing
    // Key" por subcuenta y la guarda cifrada, pero esto validaba solo contra la variable global, así
    // que la clave guardada por un cliente se ignoraba y todas compartían un secreto. Con un secreto
    // compartido, el webhook de un cliente puede escribir en los datos de otro. Mismo fallo que tuvo
    // GHL (#127). La variable de entorno se conserva como respaldo para quien no la haya guardado.
    const { tenant } = await params
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: tenantRow } = await sb
      .from('tenants')
      .select('id, status')
      .eq('slug', tenant)
      .eq('status', 'active')
      .single()
    // Subcuenta inexistente y firma inválida responden IGUAL: si no, este endpoint sirve para
    // averiguar qué subcuentas existen.
    if (!tenantRow) return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
    const tenantId = tenantRow.id

    const cfg = await getTenantConfigWithFallback(tenantId, true)
    const secreto = cfg.CALENDLY_WEBHOOK_SECRET || process.env.CALENDLY_WEBHOOK_SECRET
    if (!verifySignature(raw, req.headers.get('calendly-webhook-signature'), secreto)) {
      return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
    }
    const body = JSON.parse(raw)
    const event = body.event as string
    const p = body.payload || {}
    const now = new Date().toISOString()

    const email = (p.email as string | null)?.toLowerCase?.().trim() || null
    let phone = digits(p.text_reminder_number)
    const fullName = (p.name as string | null)?.trim() || `${p.first_name || ''} ${p.last_name || ''}`.trim() || null
    const sched = p.scheduled_event || {}
    const externalId = (sched.uri as string | null) || (p.uri as string | null) || null
    const eventUuid = typeof sched.uri === 'string' ? sched.uri.split('/').pop() || null : null
    const startTime = sched.start_time as string | null
    const endTime = sched.end_time as string | null
    let durationMin: number | null = null
    if (startTime && endTime) {
      const d = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000
      if (d > 0 && d < 24 * 60) durationMin = Math.round(d)
    }
    const meetingUrl = sched.location?.join_url || null
    const rescheduleUrl = (p.reschedule_url as string | null) || null
    const tr = p.tracking || {}
    const utm = {
      utm_source: tr.utm_source || null,
      utm_medium: tr.utm_medium || null,
      utm_campaign: tr.utm_campaign || null,
      utm_content: tr.utm_content || null,
      utm_term: tr.utm_term || null,
    }
    const hasUtm = Object.values(utm).some(Boolean)

    // --- Respuestas del formulario ---
    const qa: Array<{ question: string; answer: string; position?: number }> = Array.isArray(p.questions_and_answers)
      ? p.questions_and_answers
      : []
    const qualification: Record<string, unknown> = {}
    const respuestas: Array<{ q: string; a: string }> = []
    let ageFromForm: number | null = null
    let instagramFromForm: string | null = null
    for (const item of qa) {
      const q = item?.question || ''
      const a = item?.answer || ''
      if (!q) continue
      respuestas.push({ q, a })
      const key = mapKey(q)
      qualification[key || slugify(q)] = a
      if (key === 'telefono' && !phone) phone = digits(a)
      if (key === 'instagram') instagramFromForm = String(a).replace(/^@/, '').trim() || null
      if (key === 'edad') {
        const m = String(a).match(/\d{1,3}/)
        if (m) ageFromForm = parseInt(m[0], 10)
      }
      // Auto-registro de la pregunta, idempotente por (tenant_id, slug).
      //
      // Esto llevaba roto desde la migración multi-tenant y fallando EN SILENCIO: el upsert no
      // pasaba tenant_id, que es NOT NULL, así que cada llamada moría con not_null_violation y
      // nadie miraba el error. Por eso qualification_questions estaba vacía habiendo pasado
      // cientos de formularios por aquí.
      const { error: qqError } = await sb
        .from('qualification_questions')
        .upsert(
          { tenant_id: tenantId, slug: slugify(q), question_text: q, field_key: key },
          { onConflict: 'tenant_id,slug', ignoreDuplicates: true }
        )
      // No se aborta el webhook por esto: registrar el catálogo de preguntas es un efecto
      // secundario, y perder la cita entera por ello sería peor. Pero se deja constancia en vez de
      // tragárselo, que es exactamente lo que escondió el fallo durante semanas.
      if (qqError) console.error('[calendly] no se pudo registrar la pregunta de cualificación:', qqError.message)
    }
    qualification.respuestas = respuestas

    // --- Resolver / crear contacto ---
    // Atómico en la base de datos: Calendly reintenta la misma entrega, y el check-then-insert que
    // había aquí creaba dos contactos para el mismo lead cuando dos entregas se solapaban.
    if (!email && !phone) return NextResponse.json({ error: 'Sin email ni teléfono' }, { status: 400 })
    const parts = (fullName || '').split(' ')
    const resolved = await getOrCreateContact(sb, tenantId, {
      email,
      phone,
      fullName,
      firstName: parts[0] || null,
      lastName: parts.slice(1).join(' ') || null,
      instagram: instagramFromForm,
      age: ageFromForm,
      leadStatus: 'agendado',
      // Canal de origen first-touch: toda entrega de este webhook viene de Calendly.
      leadChannel: 'calendly',
      seenAt: now,
    })
    if (!resolved.ok) {
      return NextResponse.json({ error: 'Error creando contacto', detail: resolved.error }, { status: 500 })
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
    // COLABORADOR del enlace (?ref=CODIGO, aceptado como tracking.ref / referral):
    // resuelto server-side a UUID del perfil, primera-atribución-válida-gana la
    // fija registrarToque. El utm_content sigue para reporting; el dinero va por FK.
    let colaboradorId: string | null = null
    const refCruda = body as { ref?: unknown; referral?: unknown; colaborador?: unknown }
    const refValor =
      typeof refCruda?.ref === 'string'
        ? refCruda.ref
        : typeof refCruda?.referral === 'string'
          ? refCruda.referral
          : typeof refCruda?.colaborador === 'string'
            ? refCruda.colaborador
            : null
    if (refValor) {
      try {
        const perfil = await resolverColaboradorPorCodigo(sb, tenantId, refValor)
        colaboradorId = perfil?.id ?? null
      } catch (e) {
        console.warn('[colaborador] no se pudo resolver el ref:', e instanceof Error ? e.message : e)
      }
    }
    try {
      const toque = leerToque(body)
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
          ...(phone ? { phone } : {}),
          ...(instagramFromForm ? { instagram: instagramFromForm } : {}),
          ...(ageFromForm != null ? { age: ageFromForm } : {}),
        })
        .eq('id', contact.id)
        .eq('tenant_id', tenantId)
    }

    // --- Cualificación efectiva (arrastre en reprogramaciones) ---
    // Al reprogramar, Calendly crea una cita nueva y su payload a menudo NO reenvía
    // las preguntas del formulario. Para no perder la calidad del lead, si no llegan
    // respuestas arrastramos la última cualificación conocida del contacto (cita previa
    // o snapshot a nivel de contacto).
    let effectiveQualification: Record<string, unknown> = qualification
    if (respuestas.length === 0 && event !== 'invitee.canceled') {
      const { data: priorAppt } = await sb
        .from('appointments')
        .select('qualification')
        .eq('contact_id', contact.id)
        .eq('tenant_id', tenantId)
        .not('qualification', 'is', null)
        .order('appointment_datetime', { ascending: false })
        .limit(1)
      const priorQ = (priorAppt?.[0]?.qualification as Record<string, unknown> | undefined) || null
      if (priorQ && Array.isArray(priorQ.respuestas) && priorQ.respuestas.length > 0) {
        effectiveQualification = priorQ
      } else {
        const { data: c2 } = await sb
          .from('contacts')
          .select('qualification')
          .eq('id', contact.id)
          .eq('tenant_id', tenantId)
          .maybeSingle()
        const cq = (c2?.qualification as Record<string, unknown> | undefined) || null
        if (cq && Array.isArray(cq.respuestas) && cq.respuestas.length > 0) effectiveQualification = cq
      }
    }

    // Volcamos la cualificación al contacto (snapshot consultable en Atribución/Dashboard).
    if (
      Array.isArray(effectiveQualification.respuestas) &&
      (effectiveQualification.respuestas as unknown[]).length > 0
    ) {
      await sb
        .from('contacts')
        .update({ qualification: effectiveQualification, qualification_updated_at: now })
        .eq('id', contact.id)
        .eq('tenant_id', tenantId)
    }

    // Atribución (UTMs de Calendly)
    if (hasUtm) {
      const firstUtm = {
        first_utm_source: utm.utm_source,
        first_utm_medium: utm.utm_medium,
        first_utm_campaign: utm.utm_campaign,
        first_utm_content: utm.utm_content,
        first_utm_term: utm.utm_term,
      }
      const lastUtm = {
        last_utm_source: utm.utm_source,
        last_utm_medium: utm.utm_medium,
        last_utm_campaign: utm.utm_campaign,
        last_utm_content: utm.utm_content,
        last_utm_term: utm.utm_term,
      }
      const { data: attr } = await sb
        .from('contact_attributions')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('tenant_id', tenantId)
        .eq('is_primary', true)
        .maybeSingle()
      if (attr)
        await sb
          .from('contact_attributions')
          .update({ last_touch_at: now, ...utm, ...lastUtm, source: 'calendly' })
          .eq('id', attr.id)
      else
        await sb.from('contact_attributions').insert({
          tenant_id: tenantId,
          contact_id: contact.id,
          source: 'calendly',
          ...utm,
          ...firstUtm,
          ...lastUtm,
          first_touch_at: now,
          last_touch_at: now,
          is_primary: true,
        })
    }

    // --- VSL: engancha el visionado (incl. anónimo sin optin) y guarda el % visto ---
    // El anon_id del VSL llega como salesforce_uuid en el enlace de Calendly (inyectado por loader.js).
    if (event !== 'invitee.canceled') {
      const vslAnon = (tr.salesforce_uuid as string | null)?.trim() || null
      await attachVslWatch({ anon: vslAnon, email, contactId: contact.id, now, tenantId })
    }

    // --- Cancelación / reprogramación ---
    if (event === 'invitee.canceled') {
      if (externalId) {
        const status = p.rescheduled === true ? 'rescheduled' : 'cancelled_lead'
        const { data: canceledAppt } = await sb
          .from('appointments')
          .select('id, status')
          .eq('external_id', externalId)
          .eq('tenant_id', tenantId)
          .maybeSingle()
        await sb.from('appointments').update({ status }).eq('external_id', externalId).eq('tenant_id', tenantId)
        if (canceledAppt) {
          await sb.from('audit_logs').insert({
            tenant_id: tenantId,
            entity_type: 'appointment',
            entity_id: canceledAppt.id,
            action: p.rescheduled === true ? 'reschedule_out' : 'cancel',
            old_values: { status: canceledAppt.status },
            new_values: { status },
          })
          // Cancelación real (no reprogramación: esa se notifica como cita.reprogramada
          // en el lado del invitee.created nuevo, donde sí conocemos la hora nueva).
          if (p.rescheduled !== true && eventUuid) {
            await notifyCreatuagente(await getTenantConfigWithFallback(tenantId), 'cita.cancelada', utm.utm_content, {
              idExternoEvento: eventUuid,
              origen: 'calendly',
            })
          }
        }
      }
      return NextResponse.json({
        ok: true,
        kind: p.rescheduled ? 'appointment.rescheduled_out' : 'appointment.canceled',
        contactId: contact.id,
      })
    }

    // --- Asignar closer (dueño del calendario) y setter (utm_term) ---
    let closerId: string | null = null
    let setterId: string | null = null
    const ownerEmail = (sched.event_memberships?.[0]?.user_email as string | null)?.toLowerCase?.().trim() || null
    // El dueño del calendario en Calendly puede tener un email distinto al de login en la app
    // (ej: cuenta de trabajo vs gmail personal) → se busca también por calendly_email.
    if (ownerEmail) {
      const { data } = await sb
        .from('users')
        .select('id')
        .or(`email.eq.${ownerEmail},calendly_email.eq.${ownerEmail}`)
        .limit(20)
      // `users` es GLOBAL (la pertenencia vive en tenant_members): sin acotar a la subcuenta, el
      // closer de otra podía quedarse la agenda — y con ella su comisión. Y `.maybeSingle()` devolvía
      // null en silencio si dos usuarios de subcuentas distintas compartían el email de Calendly.
      closerId = await firstMemberOf(
        sb,
        tenantId,
        (data ?? []).map((u) => (u as { id: string }).id)
      )
    }
    if (utm.utm_term) {
      setterId = await resolveUserIdByTrackingCode(sb, utm.utm_term, tenantId)
    }

    const apptFields = {
      appointment_datetime: startTime ? new Date(startTime).toISOString() : now,
      duration_minutes: durationMin,
      calendar_name: (sched.name as string | null) || 'Calendly',
      source: 'calendly',
      meeting_url: meetingUrl,
      reschedule_url: rescheduleUrl,
      calendly_event_uuid: eventUuid,
      qualification: effectiveQualification,
      ...utm,
      ...(closerId ? { closer_id: closerId } : {}),
      ...(setterId ? { setter_id: setterId } : {}),
    }

    let appt: {
      id: string
      status?: string
      qualification?: unknown
      closer_id?: string | null
      setter_id?: string | null
    } | null = null
    if (externalId) {
      const { data } = await sb
        .from('appointments')
        .select('id, status, qualification, closer_id, setter_id')
        .eq('external_id', externalId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      appt = data
    }

    // --- Reprogramación entrante desde Calendly (evita agendas duplicadas) ---
    // Cuando el lead reprograma desde el enlace de Calendly, Calendly manda un invitee.created
    // para el evento NUEVO cuyo payload trae `old_invitee` con la URI del invitee del evento
    // ANTERIOR. Su prefijo (…/scheduled_events/{uuid}) coincide EXACTAMENTE con el external_id
    // de la fila que ya existe. Migramos esa MISMA fila al evento nuevo en vez de crear otra,
    // que es lo que provocaba dos agendas con el mismo nombre en el calendario.
    let migratedReschedule = false
    if (!appt && typeof p.old_invitee === 'string' && p.old_invitee) {
      const oldEventUri = p.old_invitee.split('/invitees/')[0] || null
      if (oldEventUri && oldEventUri !== externalId) {
        const { data } = await sb
          .from('appointments')
          .select('id, status, qualification, closer_id, setter_id')
          .eq('external_id', oldEventUri)
          .eq('tenant_id', tenantId)
          .maybeSingle()
        if (data) {
          appt = data
          migratedReschedule = true
        }
      }
    }

    if (appt) {
      // No reasignar closer/setter si la cita ya tenía uno: recalcularlos desde el
      // dueño del calendario de Calendly en cada webhook (incluida una reagenda que
      // reutiliza esta misma fila) pisaba la asignación real cuando el evento nuevo
      // se creaba bajo un calendario distinto (bug: "el crm al reagendar cambia la
      // propiedad del lead", antes no pasaba porque cada reagenda creaba fila nueva).
      const { closer_id: _closerField, setter_id: _setterField, ...apptFieldsNoAssignment } = apptFields
      await sb
        .from('appointments')
        .update({
          ...apptFieldsNoAssignment,
          ...(appt.closer_id ? {} : _closerField != null ? { closer_id: _closerField } : {}),
          ...(appt.setter_id ? {} : _setterField != null ? { setter_id: _setterField } : {}),
          ...(migratedReschedule ? { external_id: externalId, status: 'scheduled' } : {}),
        })
        .eq('id', appt.id)
        .eq('tenant_id', tenantId)
      await sb.from('contacts').update({ lead_status: 'agendado' }).eq('id', contact.id).eq('tenant_id', tenantId)
      // Log siempre que la cualificación cambie (además de en cada reprogramación entrante),
      // para poder detectar si un evento sobreescribe respuestas reales del formulario
      // (esto es lo que pasó con la reagenda de Alberto: quedó silencioso hasta ahora).
      const qualificationChanged = JSON.stringify(appt.qualification ?? null) !== JSON.stringify(effectiveQualification)
      if (migratedReschedule || qualificationChanged) {
        await sb.from('audit_logs').insert({
          tenant_id: tenantId,
          entity_type: 'appointment',
          entity_id: appt.id,
          action: migratedReschedule ? 'reschedule_in' : 'update',
          old_values: { status: appt.status, qualification: appt.qualification },
          new_values: {
            status: migratedReschedule ? 'scheduled' : appt.status,
            qualification: effectiveQualification,
            appointment_datetime: apptFields.appointment_datetime,
          },
        })
      }
      if (migratedReschedule && eventUuid && startTime) {
        await notifyCreatuagente(await getTenantConfigWithFallback(tenantId), 'cita.reprogramada', utm.utm_content, {
          idExternoEvento: eventUuid,
          origen: 'calendly',
          inicio: toZonedISO(startTime),
          fin: addMinutesISO(startTime, durationMin || 30),
          titulo: (sched.name as string | null) || 'Llamada',
        })
      }
      return NextResponse.json({
        ok: true,
        kind: migratedReschedule ? 'appointment.rescheduled_in' : 'appointment.updated',
        contactId: contact.id,
        appointmentId: appt.id,
      })
    }
    const { data: created, error: aptErr } = await sb
      .from('appointments')
      .upsert(
        {
          tenant_id: tenantId,
          contact_id: contact.id,
          external_source: 'calendly',
          external_id: externalId,
          status: 'scheduled',
          raw_payload: body,
          ...apptFields,
        },
        // El UNIQUE de appointments pasó de (external_id) global a (tenant_id, external_id)
        // por tenant (ver 20260911200000_financial_integrity_constraints.sql) — el onConflict
        // tiene que apuntar exactamente a las columnas del índice compuesto.
        { onConflict: 'tenant_id,external_id' }
      )
      .select('id')
      .single()
    if (aptErr) return NextResponse.json({ error: 'Error creando agenda', detail: aptErr.message }, { status: 500 })
    await sb.from('contacts').update({ lead_status: 'agendado' }).eq('id', contact.id).eq('tenant_id', tenantId)
    await sb.from('audit_logs').insert({
      tenant_id: tenantId,
      entity_type: 'appointment',
      entity_id: created.id,
      action: 'create',
      new_values: {
        contact_id: contact.id,
        source: 'calendly',
        qualification: effectiveQualification,
        appointment_datetime: apptFields.appointment_datetime,
      },
    })
    if (eventUuid && startTime) {
      await notifyCreatuagente(await getTenantConfigWithFallback(tenantId), 'cita.agendada', utm.utm_content, {
        idExternoEvento: eventUuid,
        origen: 'calendly',
        inicio: toZonedISO(startTime),
        fin: addMinutesISO(startTime, durationMin || 30),
        titulo: (sched.name as string | null) || 'Llamada',
      })
    }
    return NextResponse.json({
      ok: true,
      kind: 'appointment.created',
      contactId: contact.id,
      appointmentId: created.id,
      closer: !!closerId,
      setter: !!setterId,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
