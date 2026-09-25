# MONEY.md — Vocabulario y decisiones de dinero

Fuente de verdad del vocabulario financiero. Existe porque "Net Revenue" llegó a
significar dos cosas distintas en dos pantallas (ver `METRICS.md`, el incidente
original). Aquí se fijan los términos que el plan exige cerrar antes de declarar
F3 completa (`docs/plan/01-arquitectura-datos.md`): bruto frente a atribuible en
el consolidado; importes con moneda y tipo de cambio a la fecha; IVA (cash bruto
y neto); fees por pasarela; disputas; comisiones de setter, closer y afiliado;
pagos en cuotas; financiación que paga neto; cash manual.

**Gobernanza.** Cada decisión tiene identificador, estado y quién puede revocarla.
Cambiar una decisión = versión nueva de este documento con entrada en el
changelog, nunca una reescritura silenciosa. Una cifra publicada en UI/API debe
poder rastrear hasta la decisión que la sustenta (encaja con el contrato de
`DefinicionVersionada` de `lib/metrics/definiciones.ts`).

**Estado de esta versión:** v1.1.0 (2026-09-25). D1–D7 redactadas por Freebuff/Buffy
bajo delegación explícita de Alex ("MONEY.md: Decides primero"). D8–D10 añadidas el
mismo día tras un incidente real en producción (comisiones de reserva sin completar,
una socia comisionando pese a `pays_commissions=false`, y 190k€ de gasto de Meta de
otro negocio mezclado en este tenant — ver PR #211 y `PROJECT_CONTEXT.md` §14). Todas
las decisiones son operativas y reversibles; lo que Alex aún no ha decidido queda
marcado como decisión abierta, no como hecho.

---

## 1. Las cuatro palabras

| Término | Qué es | Mapeo en este repo | Estado |
|---|---|---|---|
| **Booked** (contratado) | Valor de ventas activas cerradas en el periodo, por su fecha de venta | `Contracted Revenue` (`METRICS.md` §2) — `computeMonthlyPnl().contractedRevenue` | Existe. NO se crea un segundo nombre |
| **Collected** (cobrado) | Dinero efectivamente entrado en el periodo, sea cual sea la venta que lo originó | `Cash Collected` (`METRICS.md` §3) + módulo canónico `lib/canonical/cash.ts` | Existe |
| **Billed** (facturado) | Importe de facturas emitidas al cliente, por fecha de emisión, con o sin cobro | No existe como métrica | **Abierta** (A1) — no se calcula a medias |
| **Recognized** (reconocido) | Reparto contable del booked a lo largo de la prestación del servicio | No existe como métrica | **Abierta** (A2) — no se calcula a medias |

Reglas del cuadro:

- **Booked y collected conviven sin reconciliarse en la misma cifra.** Un cobro
  puede llegar antes o después de su venta; cada uno vive en su grain (collected
  por `collected_at`, booked por `sale_date`). La diferencia entre ambos es
  información (cohorts de cobro, `METRICS.md` §7), no un error que "arreglar".
- **Billed no es booked ni collected.** Si algún día existe, nace de facturas
  reales (emisión), no deducida de ventas ni de cobros. Hoy el sistema solo ve
  facturas del lado del GASTO (extracción IA de `expenses`); el lado ingreso
  facturado no tiene fuente.
- **Recognized no se inventa.** Repartir un importe entre meses presupone una
  política contable que nadie ha fijado. Mientras tanto, ninguna pantalla dice
  "reconocido".

## 2. Bruto vs atribuible — D1

**Estado: decidida la MECÁNICA, abierta la PREFERENCIA (A3).**

- **Bruto** (modo `bruto`): totales del negocio tal como ocurren, sin repartir
  entre canales ni personas. Es el número que toca la caja y el que deben mirar
  los indicadores económicos del negocio (cash, P&L, ROAS, CAC).
- **Atribuible** (modo `atribuible`): la misma cantidad repartida según
  atribución (canal, campaña, colaborador, setter/closer) para evaluar rendimiento
  de cada pieza. El reparto nunca altera el total: la suma de lo atribuible
  equivale al bruto del periodo; lo que no se puede atribuir aparece como
  "sin atribuir", no se reparte "por si acaso".
- **Ninguno de los dos es el modo oficial hoy.** El plan lo deja así mientras la
  preferencia no esté decidida, y la regla de graduación de F9 dice que el modo
  "oficial" solo existe si `MONEY.md` versiona esa decisión. UI y API muestran
  SIEMPRE el modo como etiqueta explícita; ninguna cifra de dinero se publica
  sin decir si es bruto o atribuible.
- Revocar A3 (elegir oficial) es una decisión de Alex, no de un agente.

## 3. Moneda base y tipo de cambio — D2

- **Moneda base: EUR, por tenant.** El importe de referencia de toda métrica se
  expresa en la moneda base del tenant.
- **Los importes se guardan con su moneda original.** Un importe sin moneda
  declarada no permite asumir la base: se trata como dato con moneda desconocida,
  no como EUR.
- **Toda conversión usa el tipo de cambio a la FECHA DEL HECHO** (`collected_at`,
  `sale_date`, `expense_date` — la fecha del evento, nunca la de la consulta) y
  guarda junto al importe convertido el tipo aplicado y su fecha.
- **Estado actual (hueco declarado):** el sistema hoy opera de facto en una sola
  moneda y no hay tabla de tipos de cambio. Mientras no exista: los importes con
  moneda distinta de la base se reportan por separado como "no convertidos" en la
  respuesta (no se suman al total asumiendo paridad) y entran en cola de revisión
  si su moneda es desconocida. Fuente de tipos (ECB, proveedor de pago u otra) es
  la decisión abierta A4.

## 4. IVA — D3

- **El IVA recaudado no es ingreso.** Ninguna métrica de negocio lo suma.
- **Cash bruto** = importes tal como entran al banco (con IVA cuando lo llevan).
  Es la base de `Cash Collected` y de todas las métricas de negocio actuales.
- **Cash neto de IVA** = cash bruto menos el IVA declarado. Solo se calcula donde
  hay dato real de IVA (hoy: `vat` extraído de facturas de gasto por IA; en el
  lado ingreso no existe todavía). **No se imputa un porcentaje por defecto**:
  donde no hay dato, se muestra el bruto y se declara el hueco.
- P&L y gestoría separan IVA cuando la fuente lo declara; las métricas de
  funnel/ads no lo hacen (su base es el bruto cobrado, D5).

## 5. Fees de pasarela — D4

- **Las métricas de negocio usan importes brutos de cobro.** `cash_collected`,
  ROAS, MER, CAC y su familia se calculan sobre lo cobrado sin restar comisión de
  pasarela: los fees son un coste, no una disminución del ingreso.
- **Los fees se restan exactamente una vez, en el P&L**, como partida de gasto.
  Hoy el espejo de `stripe_payments` no persiste el fee por transacción (hueco
  declarado): cuando exista, alimenta esa partida; no se estiman porcentajes.
- **La base comisionable es distinta y sigue siéndolo.** `commissionable_amount`
  (`METRICS.md` §5) ya es neto de fees/impuestos de pasarela y existe para calcular
  comisiones de personas. No se usa como base de métricas de negocio ni se
  renombra: mide sobre qué se liquida a setter/closer/afiliado.

## 6. Disputas y reembolsos — D5

- **Un reembolso resta del cash del periodo en que OCURRE** (lógica ya asentada
  en `lib/canonical/cash.ts` y `METRICS.md` §3): el cobro histórico no se
  reescribe, el refund es un hecho nuevo con su fecha.
- **`chargeback` excluye la venta** de las métricas de booked
  (`ACTIVE_SALE_STATUSES` en `lib/analytics.ts` ya lo excluye) y el chargeback
  propiamente dicho resta del cash cuando se materializa.
- **Disputas abiertas no restan hasta resolverse** y no se anticipan como pérdida
  estimada: entran en la cola de revisión que ya existe para datos no conciliables.
  Anticipar su importe sería inventar dinero.
- Los refunds comisionables (`commissionable_refund_amount`) siguen la política
  de clawback del apartado 8.

## 7. Cash manual y cobros fuera de Stripe — D6

- El cash admite cobros sin Stripe (transferencia, financiación, registro manual)
  vía `collections`/`refunds` internos, con la deduplicación por
  `payment_reference` que ya aplica `lib/canonical/cash.ts`: si un cobro manual
  referencia un pago de Stripe, es EL MISMO dinero y cuenta una vez (gana la
  fuente primaria).
- Todo cobro manual exige fecha, importe y origen declarados. Un cobro manual sin
  referencia ni fecha es un hueco de datos, no un cero.

## 8. Comisiones, cuotas y financiación — D7

- **Base de comisiones:** `commissionable_amount` del cobro (D4). **Clawback**
  (recuperar comisión si la venta se reembolsa después): decisión abierta A5 —
  mientras tanto, el sistema registra el refund comisionable pero no liquida ni
  revierte comisiones por su cuenta.
- **Pagos en cuotas:** el booked cuenta el total a la fecha de venta; el collected
  cuenta cada cuota a su fecha de cobro. Ninguna métrica "reparte" el total entre
  meses salvo la cohorte de cobro (§7 de `METRICS.md`), que mide, no inventa.
- **Financiación que paga neto** (el cliente financia y la entidad te adelanta
  menos de lo contratado): cash = importe NETO efectivamente recibido; la
  diferencia entre lo contratado y lo recibido es coste de financiación, hoy sin
  partida contable (decisión abierta A6). Lo contratado sigue contando como
  booked: la financiación no cambia lo que el cliente debe.

## 9. Reservas: cuándo es venta, cuándo comisiona — D8

**Incidente que fija esta decisión:** una reserva (seña, históricamente <100€ en este
negocio) se creaba con `sales.status = 'active'` desde el primer cobro, así que
contaba como venta/cliente y su cobro comisionaba al instante — exactamente igual
que un pago real — aunque la persona nunca completara la compra.

- **Reservar no es comprar.** Una venta con `payment_plans.method = 'reserva'` y
  `reservation_completed_at` todavía `null` es una reserva ABIERTA: no cuenta como
  venta ni como cliente en ninguna métrica de negocio (`esReservaAbierta`,
  `lib/metrics/agregados.ts`), aunque su `status` sea `active` en la fila.
- **Una reserva abierta no comisiona a nadie** (ni closer, ni setter, ni
  colaborador), ni siquiera al cobrar la seña. Solo empieza a comisionar cuando la
  persona EMPIEZA A PAGAR de verdad — fraccionado o completo — y
  `reservation_completed_at` deja de ser null. En ese momento se reabre y
  reconcilia el cobro de la seña (`lib/commissions/generate.ts`,
  `saleNeedsCommissionReview` + `complete-reservation/route.ts`), así que sí
  comisiona, pero no antes.
- **El umbral de importe (<100€) es una señal histórica de este negocio, no una
  regla de código.** No se infiere "reserva" a partir del importe: se marca
  explícitamente con el plan de pago `reserva` al crear la venta (el closer lo
  elige en el flujo de `ventas/reservas`). Un importe bajo sin ese plan marcado es
  un dato mal cargado (ver el caso de la venta importada desde Stripe corregida en
  el PR #211), no una reserva implícita.

## 10. Elegibilidad de comisión por persona (`pays_commissions`) — D9

**Incidente que fija esta decisión:** una socia con `users.pays_commissions = false`
llevaba comisionando meses como closer porque ninguna consulta leía esa columna
(que además ni tenía migración en el repo).

- **`pays_commissions = false` es un veto absoluto,** no una preferencia de
  visualización: quien lo tenga nunca recibe fila de comisión de ningún cobro
  (`lib/commissions/calculator.ts`) y nunca aparece en el Dashboard de Comisiones
  (filtro también en lectura, `app/[tenant]/comisiones/page.tsx`), sea closer,
  setter, afiliado o colaborador.
- **Comisión de venta y reparto de socio son cosas distintas y no comparten
  tabla.** Un socio que no comisiona por venta puede seguir viendo su parte del
  beneficio real del negocio, pero por un mecanismo aparte (reparto de socios,
  pendiente de construir — ver `PROJECT_CONTEXT.md` §14), nunca reescribiendo
  `pays_commissions` a `true` para que "le salga algo" en Comisiones.
- **Toda persona nueva en `users` comisiona por defecto (`true`).** Desmarcar es un
  acto explícito en Configuración › Usuarios, nunca automático.

## 11. Aislamiento de gasto por integración (cuentas publicitarias) — D10

**Incidente que fija esta decisión:** con ninguna cuenta de Meta marcada en
Integraciones, `resolveMetaConfigs` sincronizaba TODAS las cuentas que veía el
token — y un token de Meta Business Manager puede ver cuentas de negocios
distintos del dueño. Resultado: 164 campañas y ~190.000 € de gasto de otro negocio
contaminando `campaign_daily` y `expenses` de este tenant.

- **"Sin selección" nunca es "todas".** Una integración que agrega varias cuentas/
  fuentes bajo un mismo token o credencial (hoy Meta; mañana cualquier otra) exige
  selección EXPLÍCITA de qué pertenece a este tenant antes de sincronizar. Si no
  hay selección ni un flag explícito de "sí, quiero todas" puesto a propósito, la
  sincronización se detiene y lo dice — nunca sincroniza de más "por si acaso".
- **Un token compartido no implica propiedad compartida de los datos.** El hecho
  de que una credencial pueda VER una cuenta no significa que esa cuenta sea de
  este negocio: la UI de selección (Integraciones) es la única fuente de verdad de
  "esto es mío", nunca el descubrimiento de la API.
- **Ningún atajo de UI debe animar a marcar de más.** Un botón "seleccionar todas"
  en una pantalla de selección de cuentas de una integración compartida es, en la
  práctica, un atajo hacia este mismo incidente.

## 12. Decisiones abiertas (requieren a Alex)

| Id | Decisión | Qué bloquea | Riesgo de decidir mal |
|---|---|---|---|
| A1 | Existe "billed" como métrica y qué fuente la alimenta | Nada hoy; evita métrica a medias | Contar facturas emitidas como dinero |
| A2 | Política de reconocimiento contable (recognized) | Nada hoy | Inventar un reparto mensual sin política |
| A3 | Modo oficial del consolidado: bruto o atribuible | Etiqueta "oficial" de F9 | Publicar una cifra como oficial a las dos voces |
| A4 | Fuente de tipos de cambio (ECB, pasarela, otra) y con qué frescura | Conversiones FX (D2) | Tipos fijados a mano sin fecha |
| A5 | Clawback de comisiones tras refund | Liquidaciones de colaboradores | Comisiones pagadas sobre dinero devuelto |
| A6 | Partida contable para el coste de financiación | P&L de financiación que paga neto | Margen inflado silenciosamente |

---

## Reglas duras (resumen operativo)

1. **Una cantidad sin moneda no es una cantidad en la moneda base.** Moneda
   desconocida → cola de revisión, no asunción.
2. **Un hueco no es un cero** (regla general del repo): "no hay datos de IVA" no
   significa "IVA = 0".
3. **No se inventan datos financieros.** Lo que no tiene fuente o política se
   declara abierto (A1–A6), no se aproxima en silencio.
4. **El LLM no calcula dinero.** La IA extrae datos de facturas (`lib/ai/claude.ts`);
   el cálculo es siempre determinista, en el motor de métricas.
5. **Toda conversión FX guarda importe original, tipo y fecha del hecho.**
6. **Los fees se restan una sola vez** (P&L), nunca dentro de las métricas de
   negocio; la base comisionable es la única que ya viene neta, y para comisiones.
7. **Toda cifra publicada nombra su definición** (booked/collected/...), modo
   (bruto/atribuible) y periodo. Los nombres de `METRICS.md` son los únicos
   válidos en UI: no resucitar "Net Revenue" para otra cosa.
8. **Reservar no es comprar, y una reserva sin completar no comisiona a nadie**
   (D8). El plan de pago (`reserva`/`custom`/...) se marca explícitamente al
   crear la venta; nunca se infiere de un importe bajo.
9. **`pays_commissions = false` es un veto absoluto**, en generación y en lectura
   (D9): sin excepciones por tipo de participante ni por antigüedad de la regla.
10. **Una integración que agrega varias cuentas bajo un mismo token nunca
    sincroniza "todas" sin que alguien lo haya pedido a propósito** (D10): sin
    selección explícita, se detiene y lo dice.

## Changelog

- **v1.1.0 (2026-09-25)** — D8 (reservas: no son venta ni comisionan hasta
  completar el pago), D9 (`pays_commissions` es un veto absoluto, en generación y
  en lectura), D10 (una integración con token compartido nunca sincroniza "todas
  las cuentas" sin selección explícita). Las tres nacen de un incidente real en
  producción, corregido en el PR #211 (código + datos): ver
  `PROJECT_CONTEXT.md` §14.
- **v1.0.0 (2026-09-25)** — Primera versión. Decisión D1 (mecánica bruto/atribuible,
  sin oficial), D2 (EUR por tenant, FX a fecha del hecho, moneda obligatoria),
  D3 (IVA: bruto para negocio, neto solo con dato), D4 (fees fuera de las métricas
  de negocio), D5 (refunds cuando ocurren, disputas en cola), D6 (cash manual con
  dedup), D7 (comisiones sobre base comisionable, cuotas por fecha, financiación
  neta). Abiertas: A1–A6.
