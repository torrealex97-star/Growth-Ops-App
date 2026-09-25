// Edge Function CANÓNICA para seeds de QA/E2E (sustituye a qa-seed-comisiones y
// qa-seed-contratos). Versionada en el repo: despliegue reproducible, un solo punto
// de mantenimiento para preparar datos de prueba (preview, manual o futura CI).
//
//   · ESCENARIOS: 'comisiones' (venta+cobros+3 comisiones), 'contratos' (colaborador
//     pending_contract + contrato de equipo con token de firma) y 'gastos' (gasto pendiente).
//   · ACCIONES: seed (crea y devuelve IDs), status (lee estados de los IDs dados),
//     cleanup (borrado QUIRÚRGICO por IDs o por tenant, idempotente).
//   · SEGURIDAD: doble capa. verify_jwt=TRUE (la plataforma exige un JWT válido) y un
//     secreto compartido `E2E_SEED_TOKEN` enviado en el header 'x-e2e-token'. Sin el
//     secreto en el runtime la función responde 503 en TODAS las llamadas (fail-closed):
//     nunca se despliega con credenciales ni tokens escritos en el código.
//   · DATOS: usa SUPABASE_SERVICE_ROLE_KEY inyectada por el runtime (nunca se devuelve
//     por la API). Todo dato QA lleva marcadores 'QA Seed' / emails qa-seed-* para que
//     el cleanup por tenant borre solo lo sintético aunque el tenant tenga datos reales.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SLUG = 'qa-e2e'
const EMAIL_ADMIN = 'qa-seed-admin@qa-e2e.test'
const EMAIL_COLAB_COMISIONES = 'qa-seed-colab@qa-e2e.test'
const EMAIL_COLAB_CONTRATO = 'qa-seed-contrato@qa-e2e.test'
const EMAIL_CLIENTE = 'qa-seed-cliente@test.local'
const PRODUCTO = 'QA Seed Producto'
const GASTO_CONCEPTO = 'QA Gasto E2E'

type Ids = Record<string, unknown>

Deno.serve(async (req: Request) => {
  const token = Deno.env.get('E2E_SEED_TOKEN')
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  // Fail-closed: sin secreto configurado no hay protocolo de autenticación posible.
  if (!token) {
    console.error('[e2e-seed] E2E_SEED_TOKEN no configurado en el runtime')
    return json({ error: 'funcion sin configurar (falta E2E_SEED_TOKEN)' }, 503)
  }
  if (req.headers.get('x-e2e-token') !== token) return json({ error: 'no autorizado' }, 403)

  const body = await req.json().catch(() => ({}))
  const action = body.action as string
  const scenario = body.scenario as string | undefined
  const ids = (body.ids ?? {}) as Ids

  async function ensureTenant(): Promise<string> {
    const { data: t } = await sb.from('tenants').select('id').eq('slug', SLUG).single()
    if (t) {
      await sb.from('tenants').update({ status: 'active' }).eq('id', t.id)
      return t.id
    }
    const { data: c, error } = await sb.from('tenants').insert({ slug: SLUG, name: 'QA E2E' }).select('id').single()
    if (error) throw error
    return c.id
  }

  async function rolId(key: string): Promise<string | null> {
    const { data } = await sb.from('roles').select('id').eq('key', key).single()
    return data?.id ?? null
  }

  async function ensureUser(
    email: string,
    nombre: string,
    tenantId: string,
    password: string,
    rolGlobal: 'admin' | 'closer',
    rolMembresia: 'admin' | 'member'
  ): Promise<string> {
    const { data: listed } = await sb.auth.admin.listUsers()
    const found = (listed?.users ?? []).find((u: { email: string }) => u.email === email)
    let userId: string
    if (found) {
      await sb.auth.admin.updateUserById(found.id, { password, email_confirm: true })
      userId = found.id
    } else {
      const { data: created, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) throw error
      userId = created.user.id
    }
    await sb
      .from('users')
      .upsert({ id: userId, full_name: nombre, email, role_id: await rolId(rolGlobal), is_active: true })
    await sb
      .from('tenant_members')
      .upsert({ tenant_id: tenantId, user_id: userId, role: rolMembresia }, { onConflict: 'tenant_id,user_id' })
    return userId
  }

  async function borrarPdfsContratos(contractIds: string[]): Promise<number> {
    if (!contractIds.length) return 0
    const { data: cs } = await sb.from('contracts').select('id, signed_pdf_url').in('id', contractIds)
    const paths = (cs ?? [])
      .map((c: { signed_pdf_url: string | null }) => c.signed_pdf_url)
      .filter((p): p is string => !!p)
    if (paths.length) await sb.storage.from('contratos').remove(paths)
    return paths.length
  }

  try {
    // ── SEED ────────────────────────────────────────────────────────────────────
    if (action === 'seed') {
      const tenantId = await ensureTenant()
      const password: string = body.password ?? crypto.randomUUID() + 'Aa1!'

      if (scenario === 'comisiones') {
        const adminId = await ensureUser(EMAIL_ADMIN, 'QA Seed Admin', tenantId, password, 'admin', 'admin')
        const colabId = await ensureUser(
          EMAIL_COLAB_COMISIONES,
          'QA Seed Colaborador',
          tenantId,
          password,
          'closer',
          'member'
        )
        const { data: prod, error: e1 } = await sb
          .from('products')
          .insert({ tenant_id: tenantId, name: PRODUCTO, is_active: true })
          .select('id')
          .single()
        if (e1) throw e1
        const { data: plan, error: e2 } = await sb
          .from('payment_plans')
          .insert({
            tenant_id: tenantId,
            product_id: prod!.id,
            name: 'QA Seed Plan',
            gross_price: 3000,
            number_of_payments: 1,
            method: 'stripe',
            cash_collection_ratio: 1,
            is_active: true,
          })
          .select('id')
          .single()
        if (e2) throw e2
        const { data: contacto, error: e3 } = await sb
          .from('contacts')
          .insert({ tenant_id: tenantId, full_name: 'QA Seed Cliente', email: EMAIL_CLIENTE })
          .select('id')
          .single()
        if (e3) throw e3
        const hoy = new Date()
        const dl = new Date()
        dl.setDate(dl.getDate() + 15)
        const { data: venta, error: e4 } = await sb
          .from('sales')
          .insert({
            tenant_id: tenantId,
            contact_id: contacto!.id,
            product_id: prod!.id,
            payment_plan_id: plan!.id,
            sale_date: hoy.toISOString().slice(0, 10),
            refund_deadline_at: dl.toISOString().slice(0, 10),
            gross_amount: 3000,
            expected_commissionable_amount: 3000,
            status: 'active',
            created_by: adminId,
            closer_id: colabId,
            setter_id: adminId,
          })
          .select('id')
          .single()
        if (e4) throw e4
        const hace30d = new Date(Date.now() - 30 * 86400000).toISOString()
        const col = {
          tenant_id: tenantId,
          sale_id: venta!.id,
          gross_amount: 3000,
          commissionable_amount: 3000,
          status: 'collected',
          is_confirmed: true,
          is_eligible_for_commission: true,
        }
        const { data: c1, error: e5 } = await sb
          .from('collections')
          .insert({ ...col, collected_at: new Date().toISOString(), eligible_at: new Date().toISOString() })
          .select('id')
          .single()
        if (e5) throw e5
        const { data: c2, error: e6 } = await sb
          .from('collections')
          .insert({ ...col, collected_at: hace30d, eligible_at: hace30d })
          .select('id')
          .single()
        if (e6) throw e6
        const mesActual = hoy.toISOString().slice(0, 7)
        const d = new Date()
        d.setMonth(d.getMonth() - 1)
        const { data: comisiones, error: e7 } = await sb
          .from('commissions')
          .insert([
            {
              tenant_id: tenantId,
              sale_id: venta!.id,
              collection_id: c1!.id,
              user_id: colabId,
              participant_type: 'closer',
              percent: 10,
              base_amount: 3000,
              commission_amount: 300,
              direction: 'positive',
              status: 'pending',
              liquidation_month: mesActual,
            },
            {
              tenant_id: tenantId,
              sale_id: venta!.id,
              collection_id: c1!.id,
              user_id: adminId,
              participant_type: 'setter',
              percent: 5,
              base_amount: 3000,
              commission_amount: 150,
              direction: 'positive',
              status: 'pending',
              liquidation_month: mesActual,
            },
            {
              tenant_id: tenantId,
              sale_id: venta!.id,
              collection_id: c2!.id,
              user_id: colabId,
              participant_type: 'closer',
              percent: 10,
              base_amount: 3000,
              commission_amount: 300,
              direction: 'positive',
              status: 'approved',
              liquidation_month: d.toISOString().slice(0, 7),
            },
          ])
          .select('id')
        if (e7) throw e7
        return json({
          ok: true,
          ids: {
            tenantId,
            adminId,
            colabId,
            ventaId: venta!.id,
            cobroIds: [c1!.id, c2!.id],
            comisionIds: (comisiones ?? []).map((c: { id: string }) => c.id),
          },
        })
      }

      if (scenario === 'contratos') {
        const colabId = await ensureUser(
          EMAIL_COLAB_CONTRATO,
          'QA Seed Contrato',
          tenantId,
          password,
          'closer',
          'member'
        )
        const { data: perfil } = await sb
          .from('collaborator_profiles')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('user_id', colabId)
          .single()
        let perfilId: string
        if (perfil) {
          perfilId = perfil.id
          await sb.from('collaborator_profiles').update({ status: 'pending_contract' }).eq('id', perfilId)
        } else {
          const { data: created, error } = await sb
            .from('collaborator_profiles')
            .insert({
              tenant_id: tenantId,
              user_id: colabId,
              code: 'QA-SEED',
              name: 'QA Seed Contrato',
              status: 'pending_contract',
            })
            .select('id')
            .single()
          if (error) throw error
          perfilId = created.id
        }
        const { data: contrato, error } = await sb
          .from('contracts')
          .insert({
            tenant_id: tenantId,
            kind: 'equipo',
            user_id: colabId,
            title: 'QA Seed Contrato Colaborador',
            status: 'enviado',
            signing_token: crypto.randomUUID().replace(/-/g, ''),
          })
          .select('id')
          .single()
        if (error) throw error
        return json({ ok: true, ids: { tenantId, colabUserId: colabId, perfilId, contractId: contrato!.id } })
      }

      if (scenario === 'gastos') {
        const adminId = await ensureUser(EMAIL_ADMIN, 'QA Seed Admin', tenantId, password, 'admin', 'admin')
        const { data: gasto, error } = await sb
          .from('expenses')
          .insert({
            tenant_id: tenantId,
            concept: GASTO_CONCEPTO,
            category: 'otros',
            amount: 123.45,
            expense_date: new Date().toISOString().slice(0, 10),
            status: 'pendiente',
            counterparty: 'QA Seed Proveedor',
            created_by: adminId,
          })
          .select('id')
          .single()
        if (error) throw error
        return json({ ok: true, ids: { tenantId, adminId, expenseId: gasto!.id } })
      }

      return json({ error: 'scenario desconocido (comisiones|contratos|gastos)' }, 400)
    }

    // ── STATUS ──────────────────────────────────────────────────────────────────
    if (action === 'status') {
      if (scenario === 'comisiones') {
        const { data: rows } = await sb
          .from('commissions')
          .select('id, status, direction, participant_type, liquidation_month')
          .in('id', (ids.comisionIds as string[]) ?? [])
        return json({ ok: true, rows })
      }
      if (scenario === 'contratos') {
        const { data: contract } = await sb
          .from('contracts')
          .select('id, status, signed_at, signed_pdf_url, signer_data')
          .eq('id', String(ids.contractId ?? ''))
          .single()
        const { data: perfil } = await sb
          .from('collaborator_profiles')
          .select('id, status, code')
          .eq('id', String(ids.perfilId ?? ''))
          .single()
        return json({ ok: true, contract, perfil })
      }
      if (scenario === 'gastos') {
        const { data: expense } = await sb
          .from('expenses')
          .select('id, concept, amount, status, paid_at, paid_from_account')
          .eq('id', String(ids.expenseId ?? ''))
          .single()
        return json({ ok: true, expense })
      }
      return json({ error: 'scenario desconocido (comisiones|contratos|gastos)' }, 400)
    }

    // ── CLEANUP ─────────────────────────────────────────────────────────────────
    if (action === 'cleanup') {
      // Modo quirúrgico: borra SOLO los IDs dados (contratos + perfil + PDF).
      if (ids.contractIds || ids.perfilId) {
        const contractIds = (ids.contractIds as string[]) ?? []
        const pdfs = await borrarPdfsContratos(contractIds)
        if (ids.perfilId) await sb.from('collaborator_profiles').delete().eq('id', String(ids.perfilId))
        for (const id of contractIds) await sb.from('contracts').delete().eq('id', id)
        return json({ ok: true, pdfsBorrados: pdfs })
      }
      // Modo tenant: purga idempotente de TODO lo sintético del tenant QA (solo filas
      // con marcadores QA Seed; nunca datos reales). Orden respetando FKs.
      if (body.tenant) {
        const tenantId = await ensureTenant()
        // Usuarios/perfiles/contratos se escopan a los marcadores de ESTA función: aunque
        // otro agente esté usando el tenant a la vez, su actividad sintética no se toca.
        const { data: listed } = await sb.auth.admin.listUsers()
        const misUsers = (listed?.users ?? []).filter((u: { email: string }) =>
          [EMAIL_ADMIN, EMAIL_COLAB_COMISIONES, EMAIL_COLAB_CONTRATO].includes(u.email)
        )
        const misUserIds = misUsers.map((u: { id: string }) => u.id)
        const { data: contacts } = await sb
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('email', EMAIL_CLIENTE)
        for (const ct of contacts ?? []) {
          const { data: ventas } = await sb.from('sales').select('id').eq('tenant_id', tenantId).eq('contact_id', ct.id)
          for (const v of ventas ?? []) {
            await sb.from('commissions').delete().eq('sale_id', v.id)
            await sb.from('collections').delete().eq('sale_id', v.id)
            await sb.from('contracts').delete().eq('sale_id', v.id)
            await sb.from('sales').delete().eq('id', v.id)
          }
          await sb.from('contacts').delete().eq('id', ct.id)
        }
        const { data: prods } = await sb.from('products').select('id').eq('tenant_id', tenantId).eq('name', PRODUCTO)
        for (const p of prods ?? []) {
          await sb.from('payment_plans').delete().eq('product_id', p.id)
          await sb.from('products').delete().eq('id', p.id)
        }
        const { data: gastos } = await sb
          .from('expenses')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('concept', GASTO_CONCEPTO)
        for (const g of gastos ?? []) await sb.from('expenses').delete().eq('id', g.id)
        if (misUserIds.length) {
          const { data: perfiles } = await sb
            .from('collaborator_profiles')
            .select('id, user_id')
            .eq('tenant_id', tenantId)
            .in('user_id', misUserIds)
          for (const p of perfiles ?? []) await sb.from('collaborator_profiles').delete().eq('id', p.id)
          const { data: contratos } = await sb
            .from('contracts')
            .select('id')
            .eq('tenant_id', tenantId)
            .in('user_id', misUserIds)
          const idsContratos = (contratos ?? []).map((c: { id: string }) => c.id)
          await borrarPdfsContratos(idsContratos)
          for (const id of idsContratos) await sb.from('contracts').delete().eq('id', id)
        }
        for (const u of misUsers) {
          await sb.from('tenant_members').delete().eq('tenant_id', tenantId).eq('user_id', u.id)
          await sb.from('users').delete().eq('id', u.id)
          await sb.auth.admin.deleteUser(u.id)
        }
        return json({ ok: true, tenantId, modo: 'tenant', usuariosBorrados: misUsers.length })
      }
      return json({ error: 'cleanup requiere ids (quirúrgico) o tenant (purga QA)' }, 400)
    }

    return json({ error: 'accion desconocida (seed|status|cleanup)' }, 400)
  } catch (e) {
    console.error('[e2e-seed]', e)
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
