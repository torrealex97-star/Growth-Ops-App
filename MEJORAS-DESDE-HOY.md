# MEJORAS DESDE HOY (2026-07-02) — [tenant]
> Changelog de cambios/mejoras a partir del 2026-07-02, para luego **portar a [tenant]**.
> Formato: cada mejora con estado ✅ hecho / ⏳ en curso / ⬜ pendiente, y notas de qué tocar al portar (código + migración).

### 10. Integración Meta Marketing API ✅ (2026-07-04)
- Vuelca automáticamente las campañas de Meta a `campaigns` (spend, impresiones, clics, reach, leads) y contabiliza el gasto del mes en Finanzas/P&L (idempotente `auto_source=campaign:<id>`).
- Código: `lib/meta/client.ts` (Graph v21.0 + appsecret_proof + paginación), `lib/meta/sync.ts` (`runMetaSync`: upsert por (provider,external_id), cruce LEADS FUNNEL por UTM). Endpoints `meta/sync` (botón), `cron/meta` (Bearer). Migración **v19** (`scripts/migration-v19-meta.sql`): `provider,external_id,reach,meta_leads,funnel_leads,synced_at` + índice único parcial.
- UI en Campañas: botones **Migración Meta** / **Auto 30 min** / **Sincronizar con Meta** (admin), columnas **Leads Meta** vs **Leads Funnel** con aviso ⚠️ si divergen.
- Cron 30 min = **Supabase pg_cron** (`admin/setup-meta-cron` habilita pg_net+pg_cron y programa `meta-sync-30min`), porque Vercel es plan Hobby (no admite crons sub-diarios).
- Credenciales en Vercel prod: System User "WINNER" (no caduca), cuenta real **act_210133006** (el "ASSET ID" que se dio primero era erróneo). ⚠️ Rotar token/secret (fueron por chat).
- Puesta en marcha (admin en prod, en orden): Migración Meta → Auto 30 min → Sincronizar con Meta.
- Portar a [tenant]: mismos ficheros + migración v19; credenciales y cuenta propias de [tenant].

### 9. Integración Calendly ✅ (falta suscribir el webhook en Calendly)
- Webhook `POST /api/evergreen/webhooks/calendly` (público; firma HMAC opcional con `CALENDLY_WEBHOOK_SECRET`). En `invitee.created` crea/ENCAJA el contacto por email→teléfono, registra la agenda (external_source='calendly', duración de start/end, UTMs first/last), pone lead_status='agendado'. En `invitee.canceled` marca la agenda cancelada. Idempotente por scheduled_event.uri. Probado OK.
- Portar: `webhooks/calendly/route.ts`.
- ✅ CONECTADO (2026-07-02): suscripción webhook **org-scope** creada en Calendly de [tenant] (org `[org-id en el gestor de contraseñas]`), eventos invitee.created/canceled, state active. Signing key en `CALENDLY_WEBHOOK_SECRET` (Vercel prod + local) → firma verificada. Captura TODAS las agendas de todos los setters. ⚠️ El PAT de Calendly se compartió en chat → rotar.

## Batch solicitado 2026-07-02

### 1. Cancelaciones/Refunds en I&G ✅
- P&L renombrado a **"I&G — Ingresos y Gastos"** (nav "I&G (P&L)"). Devoluciones = línea aparte que se resta 1 vez del Cash Collected bruto (verificado en pnl + finanzas). Portar: `pnl/page.tsx`, `finanzas/page.tsx`, nav Sidebar.

### 2. Afiliados ✅
- Nueva `/evergreen/afiliados` (dashboard): afiliado ve su negocio; liderazgo ve ranking + detalle. Atribución por `users.affiliate_code` == `utm_content_first`/`utm_content_last`. Comisión = cash × `default_affiliate_commission_percent`. Config del código en Configuración→Usuarios. Migración v12: `users.affiliate_code`. Portar: `afiliados/page.tsx`, `settings/users/page.tsx`, permisos (affiliate→/afiliados), nav.

### 3. Productos y ventas — reservas ✅
- La reserva es una VENTA con plan method='reserva' (producto reservado + importe, p.ej. 300€).
- **Vista `/evergreen/reservas`**: lista reservas ABIERTAS con "{persona} pagó {reserva} · falta {precio ref − reserva} por pagar", precio de referencia = Full Pay del producto. KPIs (nº, total reservado, total pendiente). Botón **"Completar pago"**.
- **Completar pago**: → alta de venta prefill (contacto + producto + reserva descontada), eliges el MÉTODO de pago; la venta creada apunta a la reserva (`sales.converted_from_reservation_id`) → la reserva pasa a "completada" y sale de abiertas. Sin pasarelas (registro manual).
- Reserva NO cuenta como alumno (Alumnos excluye method='reserva'). Migración v13: `sales.converted_from_reservation_id`.
- Portar: `reservas/page.tsx`, `sales/new`, `sales/[id]`, migración v13, nav+permisos ('/evergreen/reservas').

### 4. Invitación — acceso por departamento ✅
- Configuración→Usuarios: checkboxes de departamentos (`users.dept_overrides`). El layout usa `allowedPrefixesFor(role, dept_overrides)`. Migración v12. Portar: `settings/users/page.tsx`, `lib/auth/permissions.ts` (DEPARTMENT_PREFIXES + allowedPrefixesFor), `app/evergreen/layout.tsx`.

### 5. Contratos ✅
- Nueva `/evergreen/contratos` (biblioteca: alta, estado pendiente/enviado/firmado, enlace, KPIs). Al crear venta → contrato 'pendiente' automático. Acción "Enviar". **Webhook de firma** `POST /api/evergreen/webhooks/contract` (x-ghl-secret) que la herramienta e-sign/GHL llama al firmar → marca 'firmado' + guarda URL del PDF firmado (identifica por contractId/saleId/email). Migración v12: tabla `contracts`. Portar: `contratos/page.tsx`, `webhooks/contract/route.ts`, `sales/new` (auto-create).
- ⬜ PENDIENTE: conectar una herramienta e-sign real que llame al webhook (config externa).

### 6. Gestoría ✅
- Rol `gestoria` (v12) + **vista dedicada `/evergreen/gestoria`**: resumen I&G del mes (cash, devoluciones, gastos, comisiones plataforma, IVA, resultado) + facturas del mes + **exportar CSV** (I&G y facturas). Acceso: facturas, I&G, finanzas, gestoria. "Crear perfil de la gestora" = invitarla en Configuración→Usuarios con rol Gestoría. Portar: `gestoria/page.tsx`, permisos/nav.

### 7. Fórmulas/cálculos ⏳
- ✅ Verificado el flujo de devoluciones/comisiones plataforma en I&G y finanzas. ⬜ PENDIENTE: repaso global número a número contra datos reales cuando haya volumen.

### 8. Filtros globales + exportar ✅ (en 3 páginas; resto pendiente)
- Selector Día/Semana/Mes/Trimestre/Año/Personalizado + **Exportar CSV** en Comisiones, Ventas y Gastos. Portar esas 3 páginas. ⬜ PENDIENTE: extender el mismo filtro/export al resto de dashboards.

---
## Registro de cambios
- 2026-07-02: creados `ESTADO-ACTUAL.md` y `MEJORAS-DESDE-HOY.md`.
- 2026-07-02: migración v12 (afiliado_code, dept_overrides, tabla contracts, rol gestoria). Desplegado batch: refunds/I&G, afiliados, acceso por depto, contratos, filtros+CSV. Rol gestoría + nav afiliados/contratos.
- 2026-07-02 (2ª tanda): completados pendientes del batch → reservas (no-alumno + completar pago), contratos (envío + webhook de firma `/api/evergreen/webhooks/contract`), vista Gestoría `/evergreen/gestoria`, filtros+CSV en devoluciones/cobros/cancelaciones. Sin migración nueva (usa v12).
- **Sigue ⬜:** pasarela de pago real para reservas (Stripe/transfer), conectar e-sign real al webhook de contratos, extender filtros/export a dashboards restantes (dashboard, csm-events, morosidad, students, campaigns).
- **Para portar a [tenant]:** aplicar migración v12 a qgjr (vía Management API, sin seeds de datos) + copiar los archivos citados + rebrand + deploy. (Mismo procedimiento que el port inicial.)

---
## 9. Integración Calendly ✅ (agendas automáticas)
- **Webhook `POST /api/evergreen/webhooks/calendly`** (org-webhook, verificado end-to-end):
  - Verifica firma HMAC (`CALENDLY_WEBHOOK_SECRET`), header `calendly-webhook-signature`.
  - `invitee.created` → encaja contacto por email → teléfono (o lo crea con nombre/email/teléfono/instagram/edad del formulario).
  - **Asigna CLOSER** por el email del dueño del calendario (`scheduled_event.event_memberships[0].user_email` → `users.email`).
  - **Asigna SETTER** por `utm_term` → `users.tracking_code` (el setter NO usa utm_content para no romper la atribución de contenido).
  - **Formulario → `appointments.qualification`** (jsonb): mapeo fino de las 10 preguntas (telefono, instagram, edad, situacion, ingresos, compromiso, motivo, inversion, confirma_asistencia, vio_vsl) + guarda `respuestas[]` con el texto original + **auto-registra cada pregunta** en `qualification_questions` (upsert por slug) → si cambian las preguntas no hay que tocar código.
  - Guarda `meeting_url` (enlace Meet), `reschedule_url`, `calendly_event_uuid`, `duration_minutes` (start→end, arregla el bug de 30 min ocupando 1h) y UTMs first/last.
  - `invitee.canceled` → status `rescheduled` (si `p.rescheduled`) o `cancelled_lead`.
- **Cancelar desde la app** `POST /api/evergreen/appointments/cancel`: cancela en la app **y** en Calendly (API `scheduled_events/{uuid}/cancellation`). Roles: admin/director/manager/closer/setter.
- **Calendario** (`appointments/page.tsx`): altura proporcional a `duration_minutes` (30 min = media altura), filtro por usuario (closer/setter ven lo suyo; liderazgo ve todo + filtro por persona) y muestra closer asignado.
- **Ficha de agenda** (`AppointmentDetail.tsx`): sección Formulario (Q&A), botón Unirse a la reunión (meeting_url), Reprogramar (reschedule_url), Cancelar (→ endpoint).
- Migración **v14**: `qualification_questions`, `users.tracking_code`, `appointments.meeting_url/reschedule_url/calendly_event_uuid`, tabla `link_templates`.

## 10. Enlaces (links con UTM por usuario) ✅
- **`/evergreen/enlaces`**: cada usuario ve sus enlaces generados automáticamente a partir de plantillas (`link_templates`) aplicables a su rol. Setters/cold_callers → `utm_term=<tracking_code>`; afiliados → `utm_content=<tracking_code>`. Botón copiar.
- **Admin/director**: CRUD de plantillas (nombre, base_url, roles aplicables, activo).
- **`tracking_code`** se autogenera al dar de alta setters/closers/cold_callers/afiliados (slug del nombre) y es editable en Configuración→Usuarios.
- Permisos/nav: `PERMISSIONS.canViewLinks` / `canManageLinkTemplates`, item "Enlaces" en Ventas para setter/closer/cold_caller/afiliado + liderazgo.

- 2026-07-02: desplegado batch Calendly + Enlaces a producción (`[tenant]`, [despliegue-id]). `tsc` limpio. Cambios: calendario proporcional a `duration_minutes` + filtro por usuario + closer visible (`appointments/page.tsx`); ficha con Formulario Q&A + Unirse/Reprogramar/Cancelar (`AppointmentDetail.tsx`); sección `/evergreen/enlaces` con generación de UTM por rol + CRUD plantillas (admin/director); `tracking_code` autogenerado en invitación + editable en Configuración→Usuarios (`invite/route.ts`, `settings/users/page.tsx`, `lib/utils.ts` slugifyTrackingCode).

## 11. Pagos — reserva sin duplicar, autofinanciado con entrada/cuotas, comisiones conectadas ✅
- **Reserva → completar pago en la MISMA venta** (no se duplica): al completar, se ACTUALIZA la venta de la reserva (nuevo plan/precio total, `payment_method`, `reservation_completed_at`), en vez de crear otra. Queda registrado que hizo reserva y con qué método completó. Migración v15: `sales.down_payment_amount, installments_start_date, installments_count, reservation_completed_at, payment_method`.
- **Cash collected**: la reserva ya pagada se registra como cobro (cash collected) al momento; al completar, la entrada/primer pago también; el resto entra como cash collected cuando se cobra cada cuota. La facturación (`gross_amount`) cuenta en el mes en que se completa.
- **Autofinanciado con trato especial**: en `sales/new` el closer indica **entrada ahora + nº de cuotas para el resto + fecha de la 1ª cuota**. `buildRestInstallments` genera el calendario (la entrada/reserva no generan cuota; el resto se divide). Ej: paga 1300 hoy y 697 en 4 meses desde el mes que viene.
- **BUG comisiones corregido**: antes NO se generaba ninguna comisión (tabla vacía) porque `payments/mark` y `markInstallmentPaid` nunca las creaban y `collections/new` solo si ya había pasado el plazo de 15 días. Ahora **cada cobro genera la comisión en estado 'pendiente'** vía `lib/commissions/generate.ts` (usado en `payments/mark`, detalle de venta y `collections/new`). Aparece al instante en Comisiones y P&L. La devolución sigue generando comisiones negativas.
- **Editar venta (admin/director)**: diálogo en el detalle de venta para cambiar setter/closer/afiliado (+%), fecha, importe, estado y notas, con registro en historial.
- **Pipeline de pagos** `/evergreen/pagos`: tablero visual (Reserva abierta · Con impago · En curso · Completado) con barra de progreso cobrado/facturado, próximo vencimiento, KPIs (facturado, cash collected, pendiente, en mora) y export CSV. Nav en Ventas + permiso `canViewPaymentPipeline`.
- Archivos: `sales/new/page.tsx`, `sales/[id]/page.tsx`, `reservas/page.tsx`, `collections/new/page.tsx`, `api/evergreen/payments/mark/route.ts`, `lib/commissions/calculator.ts` (+`buildRestInstallments`), `lib/commissions/generate.ts` (nuevo), `pagos/page.tsx` (nuevo), `components/os/Sidebar.tsx`, `lib/auth/permissions.ts`, `lib/types/database.ts`, `scripts/migration-v15.sql`.

## 12. Filtros unificados en dashboards (periodo + persona/equipo) ✅
- **Módulo reutilizable**: `lib/filters/period.ts` (`PeriodPreset` Día/Semana/Mes/Trimestre/Año/Personalizado, `getPeriodRange`, `inPeriod`, `periodFileTag`, `downloadCSV`/`csvEscape`) + `components/os/PeriodFilterBar.tsx` (barra: periodo + custom + persona/equipo + limpiar + exportar).
- **Ranking (`pipeline`)**: filtro periodo + persona; **BUG corregido** → los rankings de closers/setters/triager/cold caller y objetivos ignoraban el filtro (usaban datos crudos); ahora todo respeta periodo+persona. Fechas: appointments→appointment_datetime, sales→sale_date, contacts→created_at, collections→collected_at.
- **Aplicado también a**: `dashboard` (periodo+persona, respeta saved-views), `ventas-metricas` (reusa personId), `targets` (progreso respeta filtro), `afiliados` (periodo + selector afiliado; default mes), `kpi/report` (report_date + miembro; liderazgo ve todos), `morosidad` (due_date), `students` (sale_date), `csm-events` (event_datetime), `campaigns` (start_date). Garantía de identidad: con periodo='todo' y persona='todos' el resultado es idéntico al actual.
- Ya tenían filtro de periodo de antes: `commissions`, `sales`, `expenses`, `collections`, `refunds`, `drops`, `pagos`.
- ⬜ Pendiente (tienen selector de mes propio, no tocados): `pnl`, `finanzas`, `gestoria`, `cohorts`, `unit-economics`. Si se quiere, unificar también.
- **Portar a [tenant]**: copiar `lib/filters/period.ts`, `components/os/PeriodFilterBar.tsx` + las páginas citadas.

### ⬜ PARA PORTAR A [tenant] — batch Calendly + Enlaces (secciones 9 y 10)
Pendiente de hacer más adelante. Pasos:
1. **Migración v14** en qgjr (vía Management API, sin seeds): tabla `qualification_questions`, `users.tracking_code`, `appointments.meeting_url` / `reschedule_url` / `calendly_event_uuid`, tabla `link_templates`. Fichero: `scripts/migration-v14.sql`.
2. **Copiar archivos:**
   - `app/api/evergreen/webhooks/calendly/route.ts`
   - `app/api/evergreen/appointments/cancel/route.ts`
   - `app/evergreen/appointments/page.tsx` (calendario proporcional + filtro por usuario + closer)
   - `components/appointments/AppointmentDetail.tsx` (Q&A + Unirse/Reprogramar/Cancelar)
   - `app/evergreen/enlaces/page.tsx` (nuevo)
   - `app/api/evergreen/invite/route.ts` (autogenera tracking_code)
   - `app/evergreen/settings/users/page.tsx` (columna + editar tracking_code)
   - `lib/utils.ts` (`slugifyTrackingCode`)
   - `lib/types/database.ts` (User.tracking_code; Appointment.meeting_url/reschedule_url/calendly_event_uuid; LinkTemplate)
   - `lib/auth/permissions.ts` (prefijos `/evergreen/enlaces` + canViewLinks/canManageLinkTemplates)
   - `components/os/Sidebar.tsx` (item "Enlaces")
3. **Config externa en [tenant]:** crear su propia suscripción de webhook org-scope en su Calendly + setear `CALENDLY_WEBHOOK_SECRET`, `CALENDLY_API_TOKEN` en su Vercel. Rebrand donde aplique. Deploy.

### ⬜ PARA PORTAR A [tenant] — batch Pagos (sección 11)
1. **Migración v15** en qgjr: `scripts/migration-v15.sql` (5 columnas en `sales`).
2. **Copiar archivos:** `app/evergreen/sales/new/page.tsx`, `app/evergreen/sales/[id]/page.tsx`, `app/evergreen/reservas/page.tsx`, `app/evergreen/collections/new/page.tsx`, `app/evergreen/pagos/page.tsx` (nuevo), `app/api/evergreen/payments/mark/route.ts`, `app/api/evergreen/collections/record/route.ts` (nuevo), `lib/commissions/calculator.ts`, `lib/commissions/generate.ts` (nuevo), `components/os/Sidebar.tsx`, `lib/auth/permissions.ts`, `lib/types/database.ts`.
3. Sin config externa. Deploy.

- **Sigue ⬜:** desplegar worker de transcripción a Railway; **rotar** tokens compartidos en chat (CALENDLY_API_TOKEN, personal access token); portar batches 9-10 a [tenant] (ver checklist de arriba).

---

## 2026-07-02 — Fix: ventas full-pay no contaban en I&G ni generaban comisiones

**Problema:** una venta full-pay nueva (p.ej. la del setter "Prueba Adri Setter") NO se contabilizaba en Ingresos/Gastos ni en Comisiones. Causa raíz: en `sales/new`, la rama de **pago único (full-pay)** para venta nueva NO registraba ningún cobro (a diferencia de reserva/autofinanciado/sequra), así que sin `collection` no hay cash collected → no aparece en Finanzas/P&L ni se generan comisiones. Además `recordCollection` **tragaba los errores en silencio** (`.catch(()=>{})`), dejando cobros sin registrar sin avisar.

**Fix (código):**
1. `app/evergreen/sales/new/page.tsx`: la rama full-pay de **venta nueva** ahora registra el cobro por el total bruto (`recordCollection(gross)`) → cuenta en I&G y genera comisiones al instante.
2. `recordCollection` ahora comprueba `res.ok` y muestra un `toast.error` si el cobro falla (la venta ya está creada), en vez de fallar en silencio.

**Fix (datos, backfill en BBDD):** se registró el cobro que faltaba en las 8 ventas activas sin `collection` (según su plan: bruto, comisionable = bruto×ratio, processing_fee = bruto×fee%) y se generaron las comisiones del setter (tramo 3%, cash acumulado <10k): Prueba Adri Setter = 56,91 € + 59,91 € = 116,82 € (pendientes, liquidación 2026-08-01).

**Portar a [tenant]:** copiar `app/evergreen/sales/new/page.tsx`. El backfill de datos es específico de la BBDD de [tenant].

### 2026-07-02 (cont.) — Cuadre facturación vs cash collected + reserva autofinanciado

- **Modelo confirmado correcto:** Dashboard/Finanzas ya distinguen bien: **Facturación** = `sum(sales.gross_amount)` (vendido), **Cash Collected** = `sum(collections.gross_amount)` (cobrado). Full-pay registra el total; autofinanciado solo entrada/cuotas pagadas (resto = facturación pendiente); sequra el 70%. El "848,28" que se veía era el estado previo al backfill (solo la venta autofinanciada tenía cobro).
- **Bug encontrado (mismo patrón):** en autofinanciado, la "reserva ya pagada" tecleada en una venta nueva se restaba de las cuotas (`buildRestInstallments`) pero NO se registraba como cobro → 300 € desaparecían del cuadre. **Fix:** `sales/new` ahora registra la reserva como cobro en venta nueva autofinanciada (si viene de completar reserva, no duplica). Backfill del cobro de 300 € en la venta de prueba.
- **Cuadre final:** Facturación 16.575,55 € = Cash 15.427,28 € + Pendiente 1.148,28 €. ✔

### 2026-07-02 (cont.) — Motor de comisiones: cash collected, tramos en tiempo real, futuras y auto-aprobación

**Modelo confirmado con el usuario:** la comisión REAL se calcula sobre el **cash collected** (no facturación); lo no cobrado es **comisión futura** asociada a las cuotas pendientes (autofinanciado/Sequra). Aprobación **automática** a los 15 días salvo devolución marcada.

- **Tramos en tiempo real (bug):** los niveles (min_cash/max_cash) se calculaban sobre el *comisionable* (neto) y "punto en el tiempo", así que un setter con 10.285 € de cash collected bruto seguía al 3% en vez de 4%. Fix en `lib/commissions/generate.ts`: el tramo usa el **cash collected BRUTO neto de devoluciones** (`repNetCash`, = el "Cash Collected" del dashboard) y `recomputeRepCommissionTiers` recalcula el % + importe de TODAS las comisiones no liquidadas del rep en cada cobro y en cada devolución (sube y baja). Aplica a setter y closer (afiliado = % fijo). `pickCommissionRule` extraído en `calculator.ts`.
- **Devoluciones:** `refunds/create` ahora recalcula tramos del rep tras la devolución (puede bajar de nivel).
- **Comisión futura/esperada:** endpoint `GET /api/evergreen/commissions/future` proyecta la comisión de las cuotas pendientes (no monitorización, ventas activas) × % del tramo actual del rep. Visibilidad admin/director/manager = todo; resto = lo suyo. Se muestra en la página **Comisiones** (KPI "Futuras (por cobrar)" + pestaña "Futuras" con desglose por cuota/fecha) y en el **Dashboard** (KPIs "Comisión ganada" y "Comisión futura", respetando filtros/persona) → cada uno ve en su cuenta facturado + cash collected + comisiones en tiempo real.
- **Auto-aprobación:** el cron diario `cron/reminders` aprueba las comisiones pendientes positivas cuya venta superó `refund_deadline_at` (15 días) y no tiene devolución.
- **Datos:** recalculadas las 7 comisiones del setter de prueba a 4% (387,58 € ganado). NO se generan comisiones sobre facturación (se descartó ese enfoque tras aviso del usuario).

**Portar a [tenant]:** `lib/commissions/{calculator,generate}.ts`, `app/api/evergreen/commissions/future/route.ts`, `app/api/evergreen/refunds/create/route.ts`, `app/api/evergreen/cron/reminders/route.ts`, `app/evergreen/commissions/page.tsx`, `app/evergreen/dashboard/page.tsx`.

## 13. Asignar rep a ventas ya creadas + reconciliación de comisiones ✅ (2026-07-03)

**Problema reportado:** en Comisiones NO aparecían las comisiones esperadas ("Futuras") del equipo. **Causa raíz:** el alta de venta (`sales/new`) deja `setter_id`/`closer_id` **opcionales**, así que se crearon 5 ventas de prueba (Test GHL / CustomData / Link Test / Prod Test) **sin comercial**. Una venta sin rep NO genera ninguna comisión (ni ganada ni futura), **en silencio**. La única venta con cuota pendiente (autofinanciado "Prod Test") no tenía rep → pestaña/KPI **Futuras = 0**. Además, se detectó que 1 cobro de una venta CON rep tampoco había generado su comisión (el motor solo la crea en el momento del cobro y ese cobro no la disparó) → contabilidad descuadrada (7 comisiones para 8 cobros).

**Solución (reconciliación desde la verdad):**
- **`lib/commissions/generate.ts` → `reconcileSaleCommissions(sb, saleId, alsoRecompute?)`**: reconstruye, de forma **idempotente**, las comisiones POSITIVAS ligadas a cobro de UNA venta a partir de sus **cobros reales** (`collections` collected) + los **reps asignados ahora**. Borra las positivas no liquidadas y las regenera; **conserva** las liquidadas (pagadas, no duplica) y las negativas (devoluciones); recalcula tramos (%) de reps nuevos y anteriores.
- **`POST /api/evergreen/sales/update`** (admin/director): edita la venta (reps, fecha, importe, estado, notas) **y reconcilia**. Es el nuevo destino del diálogo "Editar venta" (`sales/[id]` `handleEditSubmit` ya NO hace update directo desde el cliente). → **Asignar/cambiar el comercial de una venta ya creada genera al instante las comisiones de lo ya cobrado y limpia las del rep anterior.** El toast informa cuántas comisiones se recalcularon.
- **`POST /api/evergreen/sales/reconcile-all`** (sesión admin/director **o** `Authorization: Bearer <CRON_SECRET>`): reparación masiva que reconcilia TODAS las ventas para cuadrar la contabilidad. Añadida a rutas públicas del middleware (auto-protegida). Idempotente.

**Datos reparados en producción (2026-07-03):** ejecutado `reconcile-all` → generado el cobro que faltaba; asignado el setter de prueba a la venta autofinanciado "Prod Test" para validar el flujo → **Futuras** ya proyecta la cuota pendiente (1090,86 € × 4% = 43,63 €). Estado final: 10 comisiones setter al tramo 4% = 443,81 €; **0 cobros con rep sin comisión**. Las otras ventas de prueba (Test GHL / CustomData / Link Test) siguen sin rep → sin comisión (correcto: nadie a quien pagar); se les puede asignar rep desde "Editar venta" y se reconcilian solas.

**Archivos:** `lib/commissions/generate.ts` (+`reconcileSaleCommissions`), `app/api/evergreen/sales/update/route.ts` (nuevo), `app/api/evergreen/sales/reconcile-all/route.ts` (nuevo), `app/evergreen/sales/[id]/page.tsx` (`handleEditSubmit` → endpoint), `middleware.ts` (ruta pública reconcile-all).

**Portar a [tenant]:** copiar esos archivos. Tras portar, ejecutar una vez `POST /api/evergreen/sales/reconcile-all` con su `CRON_SECRET` para cuadrar. Sin migración nueva.

### 14. BUG CRÍTICO: la lista de comisiones salía vacía (solo se veía "Futuras" 43€) ✅ (2026-07-03)

**Síntoma:** en Comisiones (y en la ficha de venta) NO aparecían las comisiones ganadas (443,81 €); solo el KPI "Futuras (por cobrar)" mostraba ~43 € (ese viene por endpoint service-role, sin RLS). Le pasaba a **todos los roles, incluido admin**.

**Causa raíz:** la tabla `commissions` tiene **DOS** claves foráneas a `users` (`user_id` y `approved_by`). La consulta `.select('*, users(...), ...)` es **ambigua** → PostgREST devuelve error **PGRST201** ("more than one relationship was found for 'commissions' and 'users'") y **falla la consulta ENTERA** → `commissions=[]` → todos los KPIs de comisión ganada = 0. No era RLS (verificado: admin y setter ven las 10 comisiones por RLS; los `auth.uid()` coinciden con `public.users.id`).

**Fix:** desambiguar el embed indicando el nombre del FK → `users!commissions_user_id_fkey(...)`. Aplicado en:
- `app/evergreen/commissions/page.tsx` (query principal de la lista).
- `app/evergreen/sales/[id]/page.tsx` (lista de comisiones reales de la ficha de venta).

**Regla:** al embeber `users` (u otra tabla con >1 FK) en un `.select()` de Supabase/PostgREST, **siempre** desambiguar con `tabla!nombre_fk(...)`. Otras consultas de `commissions` sin embed (finanzas, pnl, dashboard, refunds) no estaban afectadas.

Verificado por REST: la query corregida devuelve 10 filas = 443,81 € con `users` poblado. Desplegado a producción.

**Portar a [tenant]:** copiar los 2 archivos (mismo doble-FK en su esquema).

### 15. I&G/Finanzas: la comisión no aparecía + reconocimiento por mes de cobro ✅ (2026-07-03)

**Problema:** en I&G (`pnl`) y en Finanzas la línea de **Comisiones salía siempre 0**. Doble causa: (1) **bug de formato** — se comparaba `commission.liquidation_month === ym`, pero `liquidation_month` es fecha completa (`'2026-08-01'`) y `ym` es `'YYYY-MM'` → nunca casaba; (2) **desfase temporal** — la comisión liquida el mes SIGUIENTE al cobro, así que aunque se arreglara el formato caería en un mes distinto al del ingreso.

**Fix (principio de correlación):** la comisión se reconoce en el **mes del COBRO que la generó** (`collections.collected_at` vía `collection_id`), no en su mes de liquidación → cuadra con la línea de ingresos del mismo mes. Las **negativas** (devoluciones) se imputan a su mes de liquidación (= mes de la devolución). Aplicado en `pnl/page.tsx` y `finanzas/page.tsx` (ambas: +`id` en collections, +`collection_id` en commissions, mapa `collection_id→mes`). Verificado julio: Comisiones internas **443,81 €** (antes 0); Pre-Tax ≈ 5.699,69 € (ingreso neto 19.421,28 − OpEx 13.721,59). La página **Comisiones** sigue agrupando por `liquidation_month` para el calendario de PAGO al equipo (correcto: eso es cuándo se paga, no cuándo se imputa el coste).

**Portar a [tenant]:** copiar `pnl/page.tsx` y `finanzas/page.tsx`.

### 16. Ventas por canal de origen ✅ (2026-07-03)

- En **Ventas** (`sales/page.tsx`) nuevo desglose **"Ventas por canal"** (nº de ventas + € por canal, respeta los filtros) + columna **Canal** en el export CSV. El canal = **first-touch UTM source** del contacto (`contact_attributions.first_utm_source`, fallback `utm_source` → `contacts.lead_channel` → "Directo / sin atribución"), normalizado a etiquetas legibles (`channelLabel`: meta→Meta Ads, calendly→Calendly, google→Google, tiktok→TikTok, etc.). Datos reales actuales: Meta 6, Calendly 1, sin atribución 3.
- **Portar a [tenant]:** copiar `sales/page.tsx`.
