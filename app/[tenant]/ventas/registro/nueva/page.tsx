'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isSetterRoleKey, isCloserRoleKey, isAffiliateRoleKey } from '@/lib/users'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, ArrowRight, Check, Loader2, Search, User, Package, Users, Calendar } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { buildRestInstallments } from '@/lib/commissions/calculator'
import { addDays } from 'date-fns'
import type { Contact, Product, PaymentPlan, User as DbUser, Appointment } from '@/lib/types/database'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'

// UUID v4 con fallback para navegadores sin crypto.randomUUID (contextos no seguros/antiguos).
function genUuid(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    const v = ch === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

type Step = 1 | 2 | 3 | 4

const STEPS = [
  { label: 'Contacto', icon: User },
  { label: 'Producto y Plan', icon: Package },
  { label: 'Equipo', icon: Users },
  { label: 'Confirmar', icon: Check },
]

export default function NewSalePage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const sesion = useSesion()
  const router = useRouter()

  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)

  // Step 1
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<Contact[]>([])
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [showNewContactForm, setShowNewContactForm] = useState(false)
  const [newContactName, setNewContactName] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactInstagram, setNewContactInstagram] = useState('')
  const [creatingContact, setCreatingContact] = useState(false)

  // Step 2
  const [products, setProducts] = useState<Product[]>([])
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlan | null>(null)
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null)
  const [pendingPlan, setPendingPlan] = useState<PaymentPlan | null>(null)

  // Step 3
  const [users, setUsers] = useState<DbUser[]>([])
  const [setterId, setSetterId] = useState('')
  const [closerId, setCloserId] = useState('')
  const [affiliateId, setAffiliateId] = useState('')
  const [affiliatePercent, setAffiliatePercent] = useState('')
  // Bloqueo de campos traídos automáticamente (setter/afiliado): el closer no puede
  // cambiarlos para evitar errores; los retoca un admin desde "editar venta".
  const [lockSetter, setLockSetter] = useState(false)
  const [lockAffiliate, setLockAffiliate] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentRoleKey, setCurrentRoleKey] = useState('')
  // Conflicto de atribución (primer toque ≠ último): se aplica el último y se marca para el admin.
  const [appointmentSearch, setAppointmentSearch] = useState('')
  const [appointmentResults, setAppointmentResults] = useState<Appointment[]>([])
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null)

  // Step 4
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [reservationAmount, setReservationAmount] = useState('0')
  const [reservationId, setReservationId] = useState<string | null>(null)

  // Autofinanciado: entrada (pago inicial) + nº de cuotas para el resto + fecha primera cuota
  const firstOfNextMonth = (() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0]
  })()
  const [downPayment, setDownPayment] = useState('0')
  const [restCount, setRestCount] = useState('')
  const [installmentsStartDate, setInstallmentsStartDate] = useState(firstOfNextMonth)

  // Plan de pagos PERSONALIZADO (baza: "X ahora + resto por Y en Z meses")
  const [customTotal, setCustomTotal] = useState('')
  const [customDown, setCustomDown] = useState('0')
  const [customRestMethod, setCustomRestMethod] = useState('sequra')
  const [customRestCount, setCustomRestCount] = useState('1')
  const [customRestNotes, setCustomRestNotes] = useState('')

  // Justificante / captura del pago (se sube a Supabase Storage)
  const [proofFile, setProofFile] = useState<File | null>(null)

  // Tomador ≠ alumno: el comprador puede ser distinto de quien agenda (madre/empresa/Sequra).
  const [buyerIsScheduler, setBuyerIsScheduler] = useState(true)
  const [payer, setPayer] = useState({
    name: '',
    dni: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    relation: 'madre',
  })
  const [accessEmailChoice, setAccessEmailChoice] = useState<'alumno' | 'tomador'>('alumno')

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const [productsRes, usersRes] = await Promise.all([
        supabase.from('products').select('*').eq('is_active', true).eq('tenant_id', tenantId).order('name'),
        supabase.from('users').select('*, roles(key)').eq('is_active', true),
      ])
      // Sin esto, un fallo de RLS dejaba los selectores de Producto/Closer/Setter vacíos en
      // silencio y el formulario quedaba inutilizable sin explicar por qué.
      if (productsRes.error) toast.error('Error al cargar productos', { description: productsRes.error.message })
      if (usersRes.error) toast.error('Error al cargar usuarios', { description: usersRes.error.message })
      setProducts(productsRes.data ?? [])
      setUsers(usersRes.data ?? [])

      // Usuario actual (para prerellenar el closer con quien registra la venta).
      if (sesion) {
        setCurrentUserId(sesion.userId)
        setCurrentRoleKey(sesion.rol ?? '')
      }
    }
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, sesion])

  // Prefill desde query params (?contact=&reserva=&product=&reservationId=&plan=) al venir de
  // "Completar pago" de una reserva o de "Nueva reserva" (?plan=reserva: preselecciona el plan
  // de reserva del producto para registrar el cobro de la reserva en un paso).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const contactId = params.get('contact')
    const reserva = params.get('reserva')
    const productId = params.get('product')
    const resId = params.get('reservationId')
    const planPrefill = params.get('plan')

    if (reserva) {
      setReservationAmount(reserva)
    }

    if (resId) {
      setReservationId(resId)
    }

    if (contactId) {
      const loadContact = async () => {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .eq('id', contactId)
          .eq('tenant_id', tenantId)
          .single()
        if (!error && data) {
          setSelectedContact(data)
          setStep(2)
        }
      }
      loadContact()
    }

    if (productId) {
      const loadProduct = async () => {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .eq('tenant_id', tenantId)
          .single()
        if (!error && data) {
          setSelectedProduct(data)
          await loadPaymentPlans(data.id)
          // Prefill del plan (solo alta de reserva: no pisa la elección del usuario en flujos
          // normales ni al completar una reserva existente, que ya viene con reservationId).
          if (planPrefill === 'reserva' && !resId) {
            const { data: plans } = await supabase
              .from('payment_plans')
              .select('*')
              .eq('product_id', productId)
              .eq('is_active', true)
              .eq('tenant_id', tenantId)
              .order('sort_order')
            const reservaPlan = (plans ?? []).find((p) => p.method === 'reserva')
            if (reservaPlan) setSelectedPlan(reservaPlan)
            // El paso lo gestionan los prefills existentes (contacto → setStep(2)); sin contacto
            // el usuario empieza en el paso 1 y ya ve el plan marcado al llegar al paso 2.
          }
        }
      }
      loadProduct()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const searchContacts = useCallback(
    async (query: string) => {
      if (!query || query.length < 2) {
        setContactResults([])
        return
      }
      setSearchLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
        .eq('tenant_id', tenantId)
        .limit(8)

      setContactResults(data ?? [])
      setSearchLoading(false)
    },
    [tenantId]
  )

  useEffect(() => {
    const timer = setTimeout(() => searchContacts(contactSearch), 300)
    return () => clearTimeout(timer)
  }, [contactSearch, searchContacts])

  const loadPaymentPlans = async (productId: string) => {
    const supabase = createClient()
    const { data } = await supabase
      .from('payment_plans')
      .select('*')
      .eq('product_id', productId)
      .eq('is_active', true)
      .eq('tenant_id', tenantId)
      .order('sort_order')

    setPaymentPlans(data ?? [])
    setSelectedPlan(null)
  }

  const searchAppointments = useCallback(
    async (query: string) => {
      if (!query || query.length < 2) {
        setAppointmentResults([])
        return
      }
      const supabase = createClient()
      const { data } = await supabase
        .from('appointments')
        .select('*, contacts(full_name)')
        .eq('contact_id', selectedContact?.id ?? '')
        .eq('tenant_id', tenantId)
        .limit(5)
      setAppointmentResults(data ?? [])
    },
    [selectedContact, tenantId]
  )

  useEffect(() => {
    if (selectedContact) {
      searchAppointments(appointmentSearch)
    }
  }, [selectedContact, appointmentSearch, searchAppointments])

  // Autoselecciona la agenda más reciente del contacto al elegirlo
  useEffect(() => {
    if (!selectedContact) return
    let active = true
    ;(async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('appointments')
        .select('*, contacts(full_name)')
        .eq('contact_id', selectedContact.id)
        .eq('tenant_id', tenantId)
        .order('appointment_datetime', { ascending: false })
        .limit(1)
      if (active && data && data[0]) {
        setSelectedAppointmentId(data[0].id)
        setAppointmentResults(data as Appointment[])
      }
    })()
    return () => {
      active = false
    }
  }, [selectedContact, tenantId])

  // Resuelve setter / cold caller / closer / afiliado SIEMPRE, en este orden de prioridad:
  //   1) La AGENDA seleccionada (setter_id / cold_caller_id / closer_id / affiliate_id)  ← fuente principal
  //   2) La atribución UTM del contacto (utm_term → tracking_code, utm_content → affiliate_code)  ← respaldo
  // El setter y el afiliado traídos quedan BLOQUEADOS (no se pueden cambiar aquí) para evitar errores;
  // un admin los retoca desde "editar venta". El closer se prerellena (agenda o usuario actual) editable.
  // Política: el ÚLTIMO toque prevalece. Prioridad: agenda (= quien agendó, último toque real)
  // → last_utm_term/last_utm_content → first_utm_term/first_utm_content. Si el rep del PRIMER
  // toque difiere del que se lleva la comisión, se marca la venta como CONFLICTO para que el
  // admin lo revise. El closer lo ve bloqueado; solo el admin lo cambia en "editar venta".
  useEffect(() => {
    if (users.length === 0 || (!selectedAppointmentId && !selectedContact)) return
    let active = true
    ;(async () => {
      const supabase = createClient()
      const has = (id?: string | null) => !!id && users.some((u) => u.id === id)
      const norm = (s?: string | null) => (s ?? '').trim().toLowerCase()
      const bySetter = (code: string) =>
        users.find((x) => norm((x as { tracking_code?: string | null }).tracking_code) === code)?.id ?? null
      const byAff = (code: string) =>
        users.find((x) => norm((x as { affiliate_code?: string | null }).affiliate_code) === code)?.id ?? null

      // Agenda (fuente principal = último toque al agendar)
      let apptSetter: string | null = null,
        apptCloser: string | null = null,
        apptAff: string | null = null
      if (selectedAppointmentId) {
        const { data: apt } = await supabase
          .from('appointments')
          .select('setter_id, closer_id, cold_caller_id, affiliate_id')
          .eq('id', selectedAppointmentId)
          .eq('tenant_id', tenantId)
          .maybeSingle()
        if (apt) {
          const a = apt as {
            setter_id: string | null
            closer_id: string | null
            cold_caller_id: string | null
            affiliate_id: string | null
          }
          apptSetter = (has(a.setter_id) && a.setter_id) || (has(a.cold_caller_id) && a.cold_caller_id) || null
          apptCloser = (has(a.closer_id) && a.closer_id) || null
          apptAff = (has(a.affiliate_id) && a.affiliate_id) || null
        }
      }

      // Atribución UTM del contacto: primer vs último toque
      let firstSetter: string | null = null,
        lastSetter: string | null = null,
        firstAff: string | null = null,
        lastAff: string | null = null
      if (selectedContact) {
        const { data: attr } = await supabase
          .from('contact_attributions')
          .select(
            'utm_term, first_utm_term, last_utm_term, utm_content, first_utm_content, last_utm_content, collaborator_id, is_primary, last_touch_at'
          )
          .eq('contact_id', selectedContact.id)
          .eq('tenant_id', tenantId)
          .order('is_primary', { ascending: false })
          .order('last_touch_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (attr) {
          const a = attr as Record<string, string | null>
          const ft = norm(a.first_utm_term),
            lt = norm(a.last_utm_term || a.utm_term)
          if (ft) firstSetter = bySetter(ft)
          if (lt) lastSetter = bySetter(lt)
          const fc = norm(a.first_utm_content),
            lc = norm(a.last_utm_content || a.utm_content)
          if (fc) firstAff = byAff(fc)
          if (lc) lastAff = byAff(lc)
          // COLABORADOR estructurado (FK contact_attributions.collaborator_id): manda
          // sobre el texto de utm_content — la comisión no se deduce comparando strings.
          const collabId = a.collaborator_id
          if (collabId) {
            const { data: cp } = await supabase
              .from('collaborator_profiles')
              .select('user_id, default_commission_percent')
              .eq('id', collabId)
              .maybeSingle()
            const perfil = cp as { user_id: string; default_commission_percent: number | string | null } | null
            if (perfil?.user_id && has(perfil.user_id)) {
              lastAff = perfil.user_id
              if (!firstAff) firstAff = perfil.user_id
              if (perfil.default_commission_percent != null) {
                setAffiliatePercent((prev) => (prev ? prev : String(perfil.default_commission_percent)))
              }
            }
          }
        }
      }

      if (!active) return

      // Último toque prevalece
      const appliedSetter = apptSetter || lastSetter || firstSetter
      const appliedAff = apptAff || lastAff || firstAff

      if (appliedSetter) {
        setSetterId(appliedSetter)
        setLockSetter(true)
      }
      if (appliedAff) {
        setAffiliateId(appliedAff)
        setLockAffiliate(true)
        const aff = users.find((u) => u.id === appliedAff)
        const pct = (aff as { default_affiliate_commission_percent?: number | null } | undefined)
          ?.default_affiliate_commission_percent
        if (pct != null) setAffiliatePercent((prev) => (prev ? prev : String(pct)))
      }
      setCloserId((prev) => {
        if (prev && prev !== 'none') return prev
        if (apptCloser) return apptCloser
        if (currentRoleKey === 'closer' && has(currentUserId)) return currentUserId
        return prev
      })

      // NOTA: si el primer toque difiere del aplicado antes se marcaba la venta como conflicto
      // (sales.attribution_conflict/attribution_meta), columnas retiradas de la BD. Si vuelven,
      // restaurar aquí el cálculo setterConflict/affConflict y su persistencia.
    })()
    return () => {
      active = false
    }
  }, [selectedAppointmentId, selectedContact, users, currentUserId, currentRoleKey, tenantId])

  // El desplegable de "setter" incluye también cold callers: ambos agendan por utm_term y cobran
  // como setter. Así el rep atribuido por UTM (setter o cold caller) aparece pre-seleccionado.
  // Filtros centralizados en lib/users.ts (compartidos con ventas/registro/[id]).
  const setters = users.filter((u) => isSetterRoleKey((u as { roles?: { key?: string } }).roles?.key))
  const roleLabel = (u: DbUser) => {
    const key = (u as { roles?: { key?: string } }).roles?.key
    return key === 'cold_caller' ? ' (cold caller)' : ''
  }
  const closers = users.filter((u) => isCloserRoleKey((u as { roles?: { key?: string } }).roles?.key))
  const affiliates = users.filter((u) => isAffiliateRoleKey((u as { roles?: { key?: string } }).roles?.key))

  // Plan personalizado: el precio total lo fija el closer (no viene del plan).
  const isCustom = selectedPlan?.method === 'custom'
  const customTotalNumber = parseFloat(customTotal) || 0
  const reservationAmountNumber = parseFloat(reservationAmount) || 0
  // Plan de reserva (nueva, no completando una ya abierta): el importe "comisionable" NO es el
  // precio fijo configurado en el plan (p.ej. 300€ por defecto) sino lo que el closer cobra
  // realmente hoy como reserva (100/200/300/500€, personalizable) — eso es lo que se comisiona.
  const isReservaPlanSelected = selectedPlan?.method === 'reserva'
  const effectiveGross = selectedPlan
    ? isCustom
      ? customTotalNumber
      : isReservaPlanSelected && !reservationId
        ? reservationAmountNumber
        : selectedPlan.gross_price
    : 0
  const effectiveRatio = selectedPlan ? (isCustom || isReservaPlanSelected ? 1 : selectedPlan.cash_collection_ratio) : 1

  const commissionableAmount = effectiveGross * effectiveRatio
  const netPendingAmount = selectedPlan ? Math.max(effectiveGross - reservationAmountNumber, 0) : 0
  const platformFeeAmount = selectedPlan ? (effectiveGross * (selectedPlan.fee_percent ?? 0)) / 100 : 0
  const amountPerPayment =
    selectedPlan && selectedPlan.number_of_payments > 0 ? effectiveGross / selectedPlan.number_of_payments : 0

  // Autofinanciado = lo financiamos nosotros en varias cuotas (ni Sequra ni Reserva ni custom)
  const isAutofinanciado =
    !!selectedPlan &&
    selectedPlan.number_of_payments > 1 &&
    selectedPlan.method !== 'sequra' &&
    selectedPlan.method !== 'reserva' &&
    !isCustom
  // El plan personalizado SIEMPRE se registra como entrada + cuotas del resto (nunca como
  // full pay), aunque sea 1 cuota: así el resto pendiente queda reflejado y no se cobra de más.
  const customRestCountNumber = Math.max(1, parseInt(customRestCount || '1', 10))
  const financeAsInstallments = isAutofinanciado || isCustom
  const downPaymentNumber = isCustom ? parseFloat(customDown) || 0 : isAutofinanciado ? parseFloat(downPayment) || 0 : 0
  const restCountNumber = isCustom
    ? customRestCountNumber
    : isAutofinanciado
      ? Math.max(1, parseInt(restCount || String(selectedPlan?.number_of_payments ?? 1), 10))
      : (selectedPlan?.number_of_payments ?? 1)
  // Resto a financiar = total − reserva ya pagada − entrada
  const restToFinance = selectedPlan ? Math.max(effectiveGross - reservationAmountNumber - downPaymentNumber, 0) : 0
  const perRestInstallment = restCountNumber > 0 ? restToFinance / restCountNumber : 0

  const handleCreateNewContact = async () => {
    const name = newContactName.trim()
    if (!name) {
      toast.error('Ponle un nombre al contacto')
      return
    }
    if (!newContactEmail.trim() && !newContactPhone.trim()) {
      toast.error('Añade al menos un email o un teléfono')
      return
    }

    setCreatingContact(true)
    const parts = name.split(' ')
    const firstName = parts[0]
    const lastName = parts.slice(1).join(' ') || null

    // Vía API con service-role: contacts solo tiene política RLS de SELECT, un INSERT directo
    // desde el cliente lo bloqueaba en silencio para roles no-admin (0 filas, sin error).
    const res = await fetch(`/api/${tenant}/evergreen/contacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        email: newContactEmail.trim() || null,
        phone: newContactPhone.trim() || null,
        instagram: newContactInstagram.trim() || null,
      }),
    })
    const json = await res.json().catch(() => ({}))

    setCreatingContact(false)

    if (!res.ok || !json.contact) {
      toast.error('Error al crear el contacto', { description: json?.error })
      return
    }

    toast.success('Contacto creado correctamente')
    setSelectedContact(json.contact)
    setShowNewContactForm(false)
    setContactSearch('')
    setContactResults([])
    setNewContactName('')
    setNewContactEmail('')
    setNewContactPhone('')
    setNewContactInstagram('')
  }

  const handleSubmit = async () => {
    if (!selectedContact || !selectedProduct || !selectedPlan) return

    setSubmitting(true)
    const supabase = createClient()

    if (!sesion) {
      toast.error('No autenticado')
      setSubmitting(false)
      return
    }

    const saleDateObj = new Date(saleDate)
    const refundDeadline = addDays(saleDateObj, 15)
    const gross = effectiveGross
    const ratio = effectiveRatio ?? 1
    const commissionable = gross * ratio
    const method = selectedPlan.method
    const isReservaPlan = method === 'reserva'
    const isSequra = method === 'sequra'
    const nowIso = new Date().toISOString()

    // Desglose del plan personalizado (para guardar en la venta y mostrar en el contrato).
    const customPlanPayload = isCustom
      ? {
          total: gross,
          down_payment: downPaymentNumber,
          rest_method: customRestMethod,
          rest_installments: customRestCountNumber,
          notes: customRestNotes || null,
        }
      : null

    // Sube el justificante de pago (si lo hay) y obtiene su path. No bloquea la venta.
    let paymentProofPath: string | null = null
    if (proofFile) {
      try {
        const buf = await proofFile.arrayBuffer()
        // Conversión a base64 por trozos (evita "Maximum call stack" con archivos grandes).
        const u8 = new Uint8Array(buf)
        let bin = ''
        const CH = 0x8000
        for (let i = 0; i < u8.length; i += CH) {
          bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH) as unknown as number[])
        }
        const b64 = btoa(bin)
        const res = await fetch(`/api/${tenant}/evergreen/sales/payment-proof`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: proofFile.name, contentType: proofFile.type, dataBase64: b64 }),
        })
        const d = await res.json().catch(() => ({}))
        if (res.ok) paymentProofPath = d.path ?? null
        else toast.error('No se pudo subir el justificante', { description: d?.error })
      } catch {
        toast.error('No se pudo subir el justificante (archivo demasiado grande?)')
      }
    }

    const teamFields = {
      setter_id: setterId && setterId !== 'none' ? setterId : null,
      closer_id: closerId && closerId !== 'none' ? closerId : null,
      affiliate_id: affiliateId && affiliateId !== 'none' ? affiliateId : null,
      affiliate_commission_percent:
        affiliateId && affiliateId !== 'none' && affiliatePercent ? parseFloat(affiliatePercent) : null,
    }

    // Tomador (comprador) distinto del agendador: datos del pagador + a qué email van los accesos.
    const buyerFields = {
      buyer_is_scheduler: buyerIsScheduler,
      payer_data: buyerIsScheduler
        ? null
        : {
            name: payer.name.trim(),
            dni: payer.dni.trim() || null,
            email: payer.email.trim() || null,
            phone: payer.phone.trim() || null,
            address: payer.address.trim() || null,
            city: payer.city.trim() || null,
            relation: payer.relation || null,
          },
      access_email: buyerIsScheduler
        ? null
        : accessEmailChoice === 'tomador'
          ? payer.email.trim() || null
          : selectedContact.email || null,
    }

    const alreadyPaid = reservationAmountNumber + downPaymentNumber

    // Calendario de cuotas del resto (sequra = monitorización de impago; autofinanciado = lo financiamos).
    // Se calcula una sola vez y se usa tanto al crear la venta como al completar una reserva.
    const buildInstallmentRows = (sid: string): Record<string, unknown>[] => {
      if (isSequra) {
        const N = selectedPlan.number_of_payments
        const ourCash = Math.round((gross * ratio - alreadyPaid) * 100) / 100
        const perStudent = Math.round((gross / N) * 100) / 100
        const rows: Record<string, unknown>[] = []
        if (ourCash > 0) {
          rows.push({
            sale_id: sid,
            installment_number: 0,
            due_date: saleDateObj.toISOString().split('T')[0],
            expected_gross_amount: ourCash,
            expected_commissionable_amount: ourCash,
            status: 'pending',
            is_monitoring: false,
          })
        }
        for (let i = 1; i <= N; i++) {
          const d = new Date(saleDateObj)
          d.setMonth(d.getMonth() + (i - 1))
          rows.push({
            sale_id: sid,
            installment_number: i,
            due_date: d.toISOString().split('T')[0],
            expected_gross_amount: perStudent,
            expected_commissionable_amount: 0,
            status: 'pending',
            is_monitoring: true,
          })
        }
        return rows
      }
      if (financeAsInstallments) {
        return buildRestInstallments({
          saleId: sid,
          totalGross: gross,
          cashCollectionRatio: ratio,
          alreadyPaid,
          restCount: restCountNumber,
          startDate: new Date(installmentsStartDate || firstOfNextMonth),
        })
      }
      return []
    }

    let saleId: string

    if (reservationId) {
      // ── MODO COMPLETAR RESERVA: se actualiza la MISMA venta (no se crea otra) ──
      const updatePayload = {
        appointment_id: selectedAppointmentId || null,
        product_id: selectedProduct.id,
        payment_plan_id: selectedPlan.id,
        sale_date: saleDate, // la facturación cuenta en el mes en que se completa el pago
        refund_deadline_at: refundDeadline.toISOString().split('T')[0],
        gross_amount: gross,
        expected_commissionable_amount: commissionable,
        reservation_amount: reservationAmountNumber,
        down_payment_amount: downPaymentNumber,
        installments_count: financeAsInstallments ? restCountNumber : null,
        installments_start_date: financeAsInstallments ? installmentsStartDate : null,
        reservation_completed_at: nowIso,
        payment_method: method,
        custom_plan: customPlanPayload,
        ...(paymentProofPath ? { payment_proof_path: paymentProofPath } : {}),
        ...teamFields,
        ...buyerFields,
        status: 'active' as const,
        notes: notes || null,
      }
      // El UPDATE va SIEMPRE server-side (service role): `sales`/`sale_expected_installments` solo
      // permiten escritura a admin/director por RLS, así que un closer/setter que completaba el pago
      // hacía un update que la RLS filtraba en silencio (0 filas, sin error) → la venta seguía como
      // reserva de 300 € aunque el cobro (server-side) sí quedaba registrado.
      const res = await fetch(`/api/${tenant}/evergreen/sales/complete-reservation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: reservationId,
          patch: updatePayload,
          installments: buildInstallmentRows(reservationId),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('Error al completar el pago', { description: d?.error })
        setSubmitting(false)
        return
      }
      saleId = reservationId
    } else {
      // ── MODO NUEVA VENTA ──
      const salePayload = {
        contact_id: selectedContact.id,
        appointment_id: selectedAppointmentId || null,
        product_id: selectedProduct.id,
        payment_plan_id: selectedPlan.id,
        sale_date: saleDate,
        refund_deadline_at: refundDeadline.toISOString().split('T')[0],
        gross_amount: gross,
        expected_commissionable_amount: commissionable,
        reservation_amount: reservationAmountNumber,
        down_payment_amount: downPaymentNumber,
        installments_count: financeAsInstallments ? restCountNumber : null,
        installments_start_date: financeAsInstallments ? installmentsStartDate : null,
        payment_method: method,
        custom_plan: customPlanPayload,
        ...(paymentProofPath ? { payment_proof_path: paymentProofPath } : {}),
        ...teamFields,
        ...buyerFields,
        status: 'active' as const,
        created_by: sesion.userId,
        updated_by: null,
        notes: notes || null,
      }
      // El id se genera en cliente para NO depender de un readback (.select()) que la RLS puede
      // bloquear: un closer/setter con data_scope 'own' que crea una venta donde no figura como
      // closer/setter no podría releer la fila recién insertada → daba "Error al crear la venta"
      // aunque la venta SÍ quedaba guardada (ventas fantasma al reintentar). Insertamos con id propio
      // y return=minimal: el INSERT solo evalúa la policy de WITH CHECK (created_by = auth.uid()).
      const newSaleId = genUuid()
      const { error: saleError } = await supabase
        .from('sales')
        .insert({ ...salePayload, id: newSaleId, tenant_id: tenantId })
      if (saleError) {
        toast.error('Error al crear la venta', { description: saleError.message })
        setSubmitting(false)
        return
      }
      saleId = newSaleId
      await supabase.from('audit_logs').insert({
        tenant_id: tenantId,
        actor_user_id: sesion.userId,
        entity_type: 'sale',
        entity_id: saleId,
        action: 'create',
        old_values: null,
        new_values: salePayload,
      })
    }

    // Registra un cobro (cash collected) + genera comisiones pendientes vía endpoint server-side
    // (collections/commissions solo permiten INSERT a admin/director por RLS; el closer no).
    const recordCollection = async (grossAmt: number, commissionableAmt?: number): Promise<boolean> => {
      if (grossAmt <= 0) return true
      try {
        const res = await fetch(`/api/${tenant}/evergreen/collections/record`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            saleId,
            grossAmount: grossAmt,
            method,
            collectedAt: nowIso,
            ...(commissionableAmt != null ? { commissionableAmount: commissionableAmt } : {}),
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          // La venta ya está creada; avisamos para que no quede un cobro sin registrar en silencio.
          toast.error('La venta se creó, pero no se pudo registrar el cobro', { description: d?.error })
          return false
        }
        return true
      } catch {
        toast.error('La venta se creó, pero no se pudo registrar el cobro (error de red)')
        return false
      }
    }

    // ── Cobros inmediatos + calendario de cuotas ──
    // Al completar una reserva las cuotas ya las insertó el endpoint server-side (RLS). En una venta
    // nueva se insertan aquí desde el cliente. En ambos casos los cobros van por el endpoint server-side.

    if (reservationId) {
      // La reserva ya pagada cuenta como cash collected. Si aún no hay cobro que la cubra
      // (reservas antiguas no lo registraban), lo registramos ahora.
      const { data: existingColls } = await supabase
        .from('collections')
        .select('gross_amount')
        .eq('sale_id', saleId)
        .eq('tenant_id', tenantId)
      const alreadyCollected = (existingColls ?? []).reduce(
        (s, c: { gross_amount: number | string }) => s + Number(c.gross_amount || 0),
        0
      )
      if (alreadyCollected < reservationAmountNumber) {
        await recordCollection(reservationAmountNumber - alreadyCollected)
      }
    }

    if (isSequra) {
      // Sequra: recibimos el cash por adelantado (comisionable, una vez); las cuotas del alumno
      // con la financiera son solo MONITORIZACIÓN de impago.
      if (!reservationId) {
        const rows = buildInstallmentRows(saleId)
        // El adelanto (cuota #0, no monitorización) es cash que recibimos YA de la financiera:
        // se registra como cobro al momento —igual que un full-pay/entrada— en vez de dejarlo como
        // cuota pendiente por marcar a mano (si no, la venta suma a facturación pero 0 € a cash
        // collected hasta que alguien la marca). Como el importe YA es la parte comisionable,
        // se pasa commissionable explícito para que el endpoint NO re-aplique el ratio del plan.
        const upfront = rows.find((r) => r.installment_number === 0 && r.is_monitoring === false)
        const monitoringRows = rows.filter((r) => !(r.installment_number === 0 && r.is_monitoring === false))
        if (monitoringRows.length) {
          const { error: instErr } = await supabase
            .from('sale_expected_installments')
            .insert(monitoringRows.map((r) => ({ ...r, tenant_id: tenantId })))
          //Nunca silencioso: si falla, la venta queda sin calendario de cuotas y la morosidad
          //ni las comisiones futuras la verán. Aviso al usuario y fallback a data/error log.
          if (instErr) {
            console.error('[nueva-venta] insert cuotas sequra:', instErr.message)
            alert(
              `La venta se registró pero NO se pudo crear el calendario de cuotas: ${instErr.message}. Avísale a soporte para repararlo.`
            )
          }
        }
        if (upfront) {
          const amt = Number(upfront.expected_gross_amount)
          await recordCollection(amt, amt)
        }
      }
    } else if (financeAsInstallments) {
      // Autofinanciado / plan personalizado: reserva ya pagada (venta nueva) + entrada al momento
      // = cash collected; el resto, cuotas. (Si viene de completar una reserva, ya se registró arriba.)
      if (!reservationId && reservationAmountNumber > 0) await recordCollection(reservationAmountNumber)
      if (downPaymentNumber > 0) await recordCollection(downPaymentNumber)
      if (!reservationId) {
        const rest = buildInstallmentRows(saleId)
        if (rest.length) {
          const { error: instErr } = await supabase
            .from('sale_expected_installments')
            .insert(rest.map((r) => ({ ...r, tenant_id: tenantId })))
          //Nunca silencioso (mismo motivo que arriba): el fallo de cuotas rompe finanzas aguas abajo.
          if (instErr) {
            console.error('[nueva-venta] insert cuotas financiación:', instErr.message)
            alert(
              `La venta se registró pero NO se pudo crear el calendario de cuotas: ${instErr.message}. Avísale a soporte para repararlo.`
            )
          }
        }
      }
    } else if (isReservaPlan) {
      // Alta de una reserva: el importe reservado cuenta como cash collected al momento.
      // Se pasa commissionable explícito (= lo realmente cobrado) para que el endpoint NO
      // reaplique el cash_collection_ratio del plan de reserva (que es un valor de referencia,
      // no el % real a comisionar sobre un importe de reserva variable).
      if (!reservationId) await recordCollection(gross, gross)
    } else {
      // Full pay (pago único): el cliente paga el total ahora → se registra como cash collected
      // para que la venta cuente en Ingresos/Gastos y genere las comisiones (setter/closer/afiliado).
      if (reservationId) {
        // Completar una reserva: se cobra el resto pendiente de una vez.
        const remaining = Math.round((gross - alreadyPaid) * 100) / 100
        if (remaining > 0) await recordCollection(remaining)
      } else {
        // Venta nueva full-pay: el cobro es el total bruto (la reserva ya pagada forma parte de él).
        await recordCollection(gross)
      }
    }

    // Genera el contrato de alumno y lo envía por email (firma en caliente). Deja el enlace
    // "cortafuegos" listo para copiar/pegar al alumno pase lo que pase con el correo.
    let contractSignUrl: string | null = null
    try {
      const cRes = await fetch(`/api/${tenant}/evergreen/contracts/student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId, send: true }),
      })
      const cd = await cRes.json().catch(() => ({}))
      if (cRes.ok) contractSignUrl = cd.signUrl ?? null
    } catch {
      /* no bloquea la venta */
    }

    if (contractSignUrl) {
      try {
        await navigator.clipboard.writeText(contractSignUrl)
      } catch {
        /* clipboard no disponible */
      }
      toast.success(reservationId ? 'Pago completado · contrato enviado' : 'Venta creada · contrato enviado', {
        description: 'Enlace de firma copiado al portapapeles. Pégaselo al alumno si no le llega el correo.',
      })
    } else {
      toast.success(reservationId ? 'Pago completado correctamente' : 'Venta creada correctamente')
    }
    router.push(`/${tenant}/ventas/registro/${saleId}`)
  }

  const canGoNext = () => {
    if (step === 1) return !!selectedContact
    if (step === 2) return !!(selectedProduct && selectedPlan && (!isCustom || customTotalNumber > 0))
    if (step === 3) return true
    return !!saleDate
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 text-muted-foreground hover:text-foreground"
          onClick={() => router.back()}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Nueva Venta</h1>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const stepNum = (i + 1) as Step
          const isActive = step === stepNum
          const isDone = step > stepNum
          return (
            <div key={s.label} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    isDone
                      ? 'bg-brand-600 text-white'
                      : isActive
                        ? 'bg-brand-600/20 border-2 border-brand-500 text-brand-400'
                        : 'bg-muted border-2 border-border text-muted-foreground'
                  }`}
                >
                  {isDone ? <Check className="w-4 h-4" /> : stepNum}
                </div>
                <span className={`text-xs mt-1 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mb-4 ${step > stepNum ? 'bg-brand-600' : 'bg-muted'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <div className="bg-card border border-border rounded-lg p-6">
        {/* STEP 1 */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Seleccionar Contacto</h2>

            {selectedContact ? (
              <div className="bg-muted border border-border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">{selectedContact.full_name}</p>
                  <p className="text-sm text-muted-foreground">{selectedContact.email || 'Sin email'}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setSelectedContact(null)}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar contacto por nombre o email..."
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="pl-9 bg-muted border-border"
                  />
                </div>

                {(contactResults.length > 0 || searchLoading) && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    {searchLoading ? (
                      <div className="p-3 text-center text-muted-foreground text-sm">Buscando...</div>
                    ) : (
                      contactResults.map((c) => (
                        <button
                          key={c.id}
                          className="w-full text-left px-4 py-3 hover:bg-muted transition-colors border-b border-border last:border-0"
                          onClick={() => {
                            setSelectedContact(c)
                            setContactSearch('')
                            setContactResults([])
                          }}
                        >
                          <p className="text-foreground text-sm font-medium">{c.full_name}</p>
                          <p className="text-muted-foreground text-xs">{c.email || 'Sin email'}</p>
                        </button>
                      ))
                    )}
                  </div>
                )}

                {!showNewContactForm && contactSearch.length >= 2 && !searchLoading && contactResults.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No se encontraron contactos con &ldquo;{contactSearch}&rdquo;.
                  </p>
                )}

                {!showNewContactForm && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-dashed border-border text-brand-400 hover:text-brand-300"
                    onClick={() => {
                      setShowNewContactForm(true)
                      setNewContactName(contactSearch)
                    }}
                  >
                    + Crear nuevo contacto
                  </Button>
                )}

                {showNewContactForm && (
                  <div className="border border-border rounded-lg p-4 space-y-3">
                    <h3 className="text-sm font-medium text-foreground">Nuevo Contacto</h3>
                    <Input
                      placeholder="Nombre completo *"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      className="bg-muted border-border"
                    />
                    <Input
                      placeholder="Email"
                      type="email"
                      value={newContactEmail}
                      onChange={(e) => setNewContactEmail(e.target.value)}
                      className="bg-muted border-border"
                    />
                    <Input
                      placeholder="Teléfono"
                      type="tel"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                      className="bg-muted border-border"
                    />
                    <Input
                      placeholder="Instagram (opcional)"
                      value={newContactInstagram}
                      onChange={(e) => setNewContactInstagram(e.target.value)}
                      className="bg-muted border-border"
                    />
                    <p className="text-xs text-muted-foreground">* Nombre obligatorio, y al menos email o teléfono.</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleCreateNewContact} disabled={creatingContact || !newContactName}>
                        {creatingContact ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Creando...
                          </>
                        ) : (
                          'Crear y seleccionar'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowNewContactForm(false)}
                        disabled={creatingContact}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-foreground">Producto y Plan de Pago</h2>

            <div>
              <Label className="mb-3 block">Producto</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProduct(p)
                      loadPaymentPlans(p.id)
                    }}
                    className={`p-4 rounded-lg border text-left transition-colors ${
                      selectedProduct?.id === p.id
                        ? 'border-brand-500 bg-brand-600/10'
                        : 'border-border hover:border-border bg-muted/50'
                    }`}
                  >
                    <p className="font-medium text-foreground">{p.name}</p>
                    {p.description && <p className="text-xs text-muted-foreground mt-1">{p.description}</p>}
                  </button>
                ))}
              </div>
            </div>

            {paymentPlans.length > 0 && (
              <div>
                <Label className="mb-3 block">Plan de Pago</Label>
                <div className="grid grid-cols-1 gap-3">
                  {paymentPlans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedPlan(plan)}
                      className={`p-4 rounded-lg border text-left transition-colors ${
                        selectedPlan?.id === plan.id
                          ? 'border-brand-500 bg-brand-600/10'
                          : 'border-border hover:border-border bg-muted/50'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-foreground">{plan.name}</p>
                          {plan.financing_provider && (
                            <p className="text-xs text-muted-foreground mt-0.5">{plan.financing_provider}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-foreground">{formatCurrency(plan.gross_price)}</p>
                          <p className="text-xs text-muted-foreground">
                            {plan.number_of_payments} pago{plan.number_of_payments > 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedPlan && !isCustom && (
              <div className="bg-brand-600/10 border border-brand-500/30 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-foreground">Resumen del plan</h3>
                  {selectedPlan.method && (
                    <span className="text-xs uppercase tracking-wide bg-muted text-foreground px-2 py-1 rounded">
                      {selectedPlan.method}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-muted/60 rounded p-2">
                    <p className="text-muted-foreground text-xs">Total</p>
                    <p className="text-foreground font-medium">{formatCurrency(selectedPlan.gross_price)}</p>
                  </div>
                  <div className="bg-muted/60 rounded p-2">
                    <p className="text-muted-foreground text-xs">Nº pagos / importe</p>
                    <p className="text-foreground font-medium">
                      {selectedPlan.number_of_payments} × {formatCurrency(amountPerPayment)}
                    </p>
                  </div>
                  <div className="bg-muted/60 rounded p-2">
                    <p className="text-muted-foreground text-xs">Cash Collected estimado</p>
                    <p className="text-emerald-400 font-medium">{formatCurrency(commissionableAmount)}</p>
                    <p className="text-muted-foreground text-[11px]">
                      {Math.round(selectedPlan.cash_collection_ratio * 100)}% del total
                    </p>
                  </div>
                  <div className="bg-muted/60 rounded p-2">
                    <p className="text-muted-foreground text-xs">
                      Comisión plataforma ({selectedPlan.fee_percent ?? 0}%)
                    </p>
                    <p className="text-amber-400 font-medium">{formatCurrency(platformFeeAmount)}</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  La comisión del equipo se calcula sobre el Cash Collected, no sobre el total bruto.
                </p>
              </div>
            )}

            {isCustom && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-medium text-cyan-300">Plan de pago personalizado</h3>
                <p className="text-xs text-muted-foreground -mt-2">
                  Ej: paga una parte ahora y el resto por Sequra/transferencia en varias cuotas.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground">Precio total (€)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={customTotal}
                      onChange={(e) => setCustomTotal(e.target.value)}
                      className="bg-muted border-border"
                      placeholder="1997"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground">Pago inicial ahora (€)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={customDown}
                      onChange={(e) => setCustomDown(e.target.value)}
                      className="bg-muted border-border"
                      placeholder="500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground">Resto mediante</Label>
                    <Select value={customRestMethod} onValueChange={setCustomRestMethod}>
                      <SelectTrigger className="bg-muted border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border">
                        <SelectItem value="sequra">Sequra</SelectItem>
                        <SelectItem value="transferencia">Transferencia</SelectItem>
                        <SelectItem value="autofinanciado">Autofinanciado</SelectItem>
                        <SelectItem value="stripe">Tarjeta (Stripe)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground">Nº cuotas para el resto</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={customRestCount}
                      onChange={(e) => setCustomRestCount(e.target.value)}
                      className="bg-muted border-border"
                      placeholder="3"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground">1ª cuota (fecha)</Label>
                    <Input
                      type="date"
                      value={installmentsStartDate}
                      onChange={(e) => setInstallmentsStartDate(e.target.value)}
                      className="bg-muted border-border"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-foreground">Notas del plan (opcional)</Label>
                  <Input
                    value={customRestNotes}
                    onChange={(e) => setCustomRestNotes(e.target.value)}
                    className="bg-muted border-border"
                    placeholder="Detalle acordado con el alumno"
                  />
                </div>
                {customTotalNumber > 0 && (
                  <div className="text-xs text-muted-foreground border-t border-cyan-500/20 pt-3 space-y-0.5">
                    <p>
                      Inicial ahora:{' '}
                      <span className="text-emerald-400 font-medium">{formatCurrency(downPaymentNumber)}</span> · Resto
                      a financiar: <span className="text-foreground font-medium">{formatCurrency(restToFinance)}</span>{' '}
                      en <span className="text-foreground font-medium">{restCountNumber}</span> cuota
                      {restCountNumber === 1 ? '' : 's'} de{' '}
                      <span className="text-foreground font-medium">{formatCurrency(perRestInstallment)}</span>
                    </p>
                  </div>
                )}
              </div>
            )}

            {selectedPlan?.code === 'RESERVA' && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium text-amber-400">Pago de Reserva — Pendiente de completar</h3>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="bg-muted rounded p-3 text-center">
                    <p className="text-muted-foreground text-xs mb-1">Reserva pagada</p>
                    <p className="text-foreground font-bold">{formatCurrency(reservationAmountNumber)}</p>
                  </div>
                  <div className="bg-muted rounded p-3 text-center">
                    <p className="text-muted-foreground text-xs mb-1">Precio total</p>
                    <p className="text-foreground font-bold">{formatCurrency(selectedPlan.gross_price)}</p>
                  </div>
                  <div className="bg-muted rounded p-3 text-center">
                    <p className="text-muted-foreground text-xs mb-1">Pendiente</p>
                    <p className="text-amber-400 font-bold">{formatCurrency(netPendingAmount)}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm text-foreground">
                    Plan de pago para el resto ({formatCurrency(netPendingAmount)})
                  </Label>
                  <div className="grid grid-cols-1 gap-2">
                    {paymentPlans
                      .filter((p) => p.code !== 'RESERVA')
                      .map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => {
                            setPendingPlanId(plan.id)
                            setPendingPlan(plan)
                          }}
                          className={`p-3 rounded-lg border text-left transition-colors text-sm ${
                            pendingPlanId === plan.id
                              ? 'border-amber-500 bg-amber-600/10'
                              : 'border-border hover:border-border bg-muted/50'
                          }`}
                        >
                          <div className="flex justify-between">
                            <span className="text-foreground font-medium">{plan.name}</span>
                            <span className="text-muted-foreground">
                              {plan.number_of_payments} {plan.number_of_payments === 1 ? 'pago' : 'pagos'}
                            </span>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Equipo</h2>

            <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
              ℹ️ <b>Regla de atribución:</b> el primer contacto y el último determinan setter/closer/afiliado. Si
              difieren, se aplica el <b>último</b> (el que agendó/reactivó) y un admin puede ajustarlo al editar la
              venta.
            </div>

            <div className="space-y-2">
              <Label>Setter / Cold caller (opcional)</Label>
              <Select value={setterId} onValueChange={setSetterId} disabled={lockSetter}>
                <SelectTrigger className={`bg-muted border-border ${lockSetter ? 'opacity-90' : ''}`}>
                  <SelectValue placeholder="Seleccionar setter..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">Sin setter</SelectItem>
                  {setters.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name}
                      {roleLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lockSetter && (
                <p className="text-xs text-amber-400/80">
                  🔒 Traído automáticamente de la agenda/atribución. Lo cambia un admin desde &quot;editar venta&quot;.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Closer (opcional)</Label>
              <Select value={closerId} onValueChange={setCloserId}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Seleccionar closer..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">Sin closer</SelectItem>
                  {closers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Colaborador (opcional)</Label>
              <Select
                value={affiliateId}
                disabled={lockAffiliate}
                onValueChange={(val) => {
                  setAffiliateId(val)
                  const aff = affiliates.find((u) => u.id === val)
                  if (aff?.default_affiliate_commission_percent) {
                    setAffiliatePercent(String(aff.default_affiliate_commission_percent))
                  }
                }}
              >
                <SelectTrigger className={`bg-muted border-border ${lockAffiliate ? 'opacity-90' : ''}`}>
                  <SelectValue placeholder="Seleccionar afiliado..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="none">Sin afiliado</SelectItem>
                  {affiliates.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lockAffiliate && (
                <p className="text-xs text-amber-400/80">
                  🔒 Traído automáticamente. Lo cambia un admin desde &quot;editar venta&quot;.
                </p>
              )}
            </div>

            {affiliateId && (
              <div className="space-y-2">
                <Label>Comision del afiliado (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={affiliatePercent}
                  onChange={(e) => setAffiliatePercent(e.target.value)}
                  className="bg-muted border-border"
                  placeholder="10.00"
                />
              </div>
            )}

            {selectedContact && (
              <div className="space-y-2">
                <Label>Agenda vinculada (opcional)</Label>
                <Input
                  placeholder="Buscar agenda del contacto..."
                  value={appointmentSearch}
                  onChange={(e) => setAppointmentSearch(e.target.value)}
                  className="bg-muted border-border"
                />
                {appointmentResults.length > 0 && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    {appointmentResults.map((appt) => (
                      <button
                        key={appt.id}
                        className={`w-full text-left px-4 py-3 hover:bg-muted border-b border-border last:border-0 transition-colors ${
                          selectedAppointmentId === appt.id ? 'bg-brand-600/10' : ''
                        }`}
                        onClick={() => setSelectedAppointmentId(appt.id === selectedAppointmentId ? null : appt.id)}
                      >
                        <p className="text-foreground text-sm">
                          {new Date(appt.appointment_datetime).toLocaleDateString('es-ES')}
                        </p>
                        <p className="text-muted-foreground text-xs">{appt.status}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">Confirmar Venta</h2>

            <div className="space-y-2">
              <Label>Fecha de la venta *</Label>
              <Input
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className="bg-muted border-border"
              />
            </div>

            {/* En un plan personalizado NUEVO (no viene de completar una reserva ya hecha), el
                dinero pagado hoy ya se recoge en "Pago inicial ahora" del paso anterior. Mostrar
                aquí OTRO campo de "reserva" duplicaba el cobro (aparecía dos veces: como entrada
                y como reserva) cuando el closer rellenaba los dos pensando que eran lo mismo. */}
            {!(isCustom && !reservationId) && (
              <div className="space-y-2">
                <Label>Reserva personalizada (€)</Label>
                <div className="space-y-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={reservationAmount}
                    onChange={(e) => setReservationAmount(e.target.value)}
                    className="bg-muted border-border"
                    placeholder="Escribe el importe exacto"
                  />
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="whitespace-nowrap"
                      onClick={() => setReservationAmount('200')}
                    >
                      200€
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="whitespace-nowrap"
                      onClick={() => setReservationAmount('300')}
                    >
                      300€
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="whitespace-nowrap"
                      onClick={() => setReservationAmount('500')}
                    >
                      500€
                    </Button>
                  </div>
                </div>
                {selectedPlan && reservationAmountNumber > 0 && !isReservaPlanSelected && (
                  <p className="text-xs text-muted-foreground">
                    Total {formatCurrency(selectedPlan.gross_price)} − Reserva {formatCurrency(reservationAmountNumber)}{' '}
                    = <span className="text-foreground font-medium">{formatCurrency(netPendingAmount)} a cobrar</span>
                  </p>
                )}
                {selectedPlan && reservationAmountNumber > 0 && isReservaPlanSelected && !reservationId && (
                  <p className="text-xs text-muted-foreground">
                    Se cobra y comisiona el importe real de la reserva:{' '}
                    <span className="text-foreground font-medium">{formatCurrency(reservationAmountNumber)}</span>. El
                    resto se calculará al completar el pago con el producto/plan final.
                  </p>
                )}
              </div>
            )}

            {/* Autofinanciado: entrada + cuotas del resto + fecha de inicio */}
            {isAutofinanciado && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-medium text-blue-300">Autofinanciado — trato de pago</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground">Entrada ahora (€)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={downPayment}
                      onChange={(e) => setDownPayment(e.target.value)}
                      className="bg-muted border-border"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground">Nº cuotas para el resto</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={restCount}
                      onChange={(e) => setRestCount(e.target.value)}
                      className="bg-muted border-border"
                      placeholder={String(selectedPlan?.number_of_payments ?? 1)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-foreground">1ª cuota (fecha)</Label>
                    <Input
                      type="date"
                      value={installmentsStartDate}
                      onChange={(e) => setInstallmentsStartDate(e.target.value)}
                      className="bg-muted border-border"
                    />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5 border-t border-blue-500/20 pt-3">
                  <p>
                    Entrada ahora (cash collected):{' '}
                    <span className="text-emerald-400 font-medium">{formatCurrency(downPaymentNumber)}</span>
                    {reservationAmountNumber > 0 && (
                      <>
                        {' '}
                        · Reserva ya pagada:{' '}
                        <span className="text-emerald-400 font-medium">{formatCurrency(reservationAmountNumber)}</span>
                      </>
                    )}
                  </p>
                  <p>
                    Resto a financiar:{' '}
                    <span className="text-foreground font-medium">{formatCurrency(restToFinance)}</span> en{' '}
                    <span className="text-foreground font-medium">{restCountNumber}</span> cuota
                    {restCountNumber === 1 ? '' : 's'} de{' '}
                    <span className="text-foreground font-medium">{formatCurrency(perRestInstallment)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    Ejemplo: paga la entrada hoy y el resto en {restCountNumber} mensualidades desde el{' '}
                    {formatDate(installmentsStartDate)}.
                  </p>
                </div>
              </div>
            )}

            {/* Tomador ≠ alumno */}
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={buyerIsScheduler}
                  onChange={(e) => setBuyerIsScheduler(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-card accent-brand-500"
                />
                <span className="text-sm text-foreground">
                  La persona que <b>compra</b> es la misma que <b>agenda</b> (el alumno)
                </span>
              </label>

              {!buyerIsScheduler && (
                <div className="space-y-3 border-t border-border pt-3">
                  <p className="text-xs text-amber-300">
                    Paga otra persona (madre/padre/empresa/socio). Se genera un <b>contrato de tomador</b> aparte y la
                    factura irá a su nombre.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground">Nombre del tomador *</Label>
                      <Input
                        value={payer.name}
                        onChange={(e) => setPayer({ ...payer, name: e.target.value })}
                        className="bg-muted border-border"
                        placeholder="Nombre y apellidos / empresa"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground">DNI / CIF</Label>
                      <Input
                        value={payer.dni}
                        onChange={(e) => setPayer({ ...payer, dni: e.target.value })}
                        className="bg-muted border-border"
                        placeholder="00000000X / B00000000"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground">Email del tomador</Label>
                      <Input
                        type="email"
                        value={payer.email}
                        onChange={(e) => setPayer({ ...payer, email: e.target.value })}
                        className="bg-muted border-border"
                        placeholder="tomador@email.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground">Teléfono</Label>
                      <Input
                        value={payer.phone}
                        onChange={(e) => setPayer({ ...payer, phone: e.target.value })}
                        className="bg-muted border-border"
                        placeholder="+34…"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground">Dirección</Label>
                      <Input
                        value={payer.address}
                        onChange={(e) => setPayer({ ...payer, address: e.target.value })}
                        className="bg-muted border-border"
                        placeholder="Calle, número"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground">Ciudad</Label>
                      <Input
                        value={payer.city}
                        onChange={(e) => setPayer({ ...payer, city: e.target.value })}
                        className="bg-muted border-border"
                        placeholder="Ciudad"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground">Relación con el alumno</Label>
                      <Select value={payer.relation} onValueChange={(v) => setPayer({ ...payer, relation: v })}>
                        <SelectTrigger className="bg-muted border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="madre">Madre</SelectItem>
                          <SelectItem value="padre">Padre</SelectItem>
                          <SelectItem value="familiar">Familiar</SelectItem>
                          <SelectItem value="empresa">Empresa</SelectItem>
                          <SelectItem value="socio">Socio</SelectItem>
                          <SelectItem value="otro">Otro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-foreground">¿A qué email van los accesos?</Label>
                      <Select
                        value={accessEmailChoice}
                        onValueChange={(v) => setAccessEmailChoice(v as 'alumno' | 'tomador')}
                      >
                        <SelectTrigger className="bg-muted border-border">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          <SelectItem value="alumno">
                            Email del alumno{selectedContact?.email ? ` (${selectedContact.email})` : ''}
                          </SelectItem>
                          <SelectItem value="tomador">Email del tomador</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Justificante del pago (captura o PDF)</Label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-brand-500"
              />
              {proofFile ? (
                <p className="text-xs text-emerald-400">Adjuntado: {proofFile.name}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sube la captura de Stripe / el justificante de transferencia como prueba del pago.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observaciones..."
                className="bg-muted border-border min-h-[80px]"
              />
            </div>

            {/* Summary */}
            <div className="bg-muted rounded-lg p-4 space-y-2 border border-border">
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Resumen</h3>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Contacto</span>
                <span className="text-foreground">{selectedContact?.full_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Producto</span>
                <span className="text-foreground">{selectedProduct?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Plan</span>
                <span className="text-foreground">{selectedPlan?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Importe bruto</span>
                <span className="text-foreground font-medium">{formatCurrency(selectedPlan?.gross_price ?? 0)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Comisionable</span>
                <span className="text-brand-300 font-medium">{formatCurrency(commissionableAmount)}</span>
              </div>
              {reservationAmountNumber > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Reserva ya pagada</span>
                    <span className="text-foreground">− {formatCurrency(reservationAmountNumber)}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-border pt-2">
                    <span className="text-muted-foreground">Neto pendiente</span>
                    <span className="text-emerald-400 font-medium">{formatCurrency(netPendingAmount)}</span>
                  </div>
                </>
              )}
              {setterId && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Setter</span>
                  <span className="text-foreground">{users.find((u) => u.id === setterId)?.full_name}</span>
                </div>
              )}
              {closerId && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Closer</span>
                  <span className="text-foreground">{users.find((u) => u.id === closerId)?.full_name}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => (step > 1 ? setStep((s) => (s - 1) as Step) : router.back())}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {step === 1 ? 'Cancelar' : 'Anterior'}
        </Button>

        {step < 4 ? (
          <Button onClick={() => setStep((s) => (s + 1) as Step)} disabled={!canGoNext()}>
            Siguiente
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting || !canGoNext()}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creando...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Crear Venta
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
