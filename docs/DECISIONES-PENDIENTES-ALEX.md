# Decisiones pendientes de Alex — 28-sep

Tres decisiones de negocio bloquean los últimos hallazgos de la auditoría FASE A. Todo lo demás ya
está cerrado y fusionado (PRs #236–#277). Para decidir rápido: responde con la letra por cada uno
(A/B/C). Ninguna de las tres está perdiendo dinero hoy de forma conocida; cada una tiene un
escenario concreto que conviene cerrar.

---

## 1) A5 — Devoluciones acumuladas y clawback de comisiones

**Dónde:** `app/api/[tenant]/evergreen/refunds/create` + `lib/commissions/calculator.ts`.

**Estado real (verificado en código hoy):** una devolución valida su importe contra el total
COBRADO (`totalGross`), pero no contra **devoluciones anteriores**: dos parciales "válidos" pueden
devolver más de lo cobrado. No hay idempotency key: un reintento tras un error inserta un segundo
refund. Y `calculateNegativeCommissionsForRefund` crea el espejo negativo de CADA comisión positiva
escalado por el importe devuelto — el límite de cada fila es SU positiva, no el total ya devuelto
del participante.

**Qué puede pasar:** devolución de 100 € + otra de 100 € sobre un pago de 150 € (la segunda debería
ser de 50 € y no lo bloquea nadie). Comisiones negativas que restan más de lo comisionado si se
acumulan parciales. Ventana de 15 días con `override` explícito, así que la superficie es acotada
pero real (admin/director puede pisarla a mano).

**Opciones:**

- **A) Tope duro automático + idempotency key (recomendada).** El total de refunds de la venta no
  puede superar `totalGross − yaDevuelto` (400 si excede); dedupe por idempotency key opcional en
  el body. Las negativas se recalculan contra el pendiente de devolver. ~1 sesión + tests. Sin
  cambio de comportamiento visible para el uso normal.
- **B) Tope duro + confirmación manual del clawback.** Igual que A, pero las comisiones negativas
  no se insertan solas: quedan como "propuestas" que el director aprueba en Pantalla › Comisiones.
  Más seguro para el rep, más fricción operativa (un paso manual por devolución).
- **C) Dejarlo como está y documentar el riesgo.** Solo procede si crees que el equipo nunca hará
  parciales acumulados. Riesgo residual: error humano sin red de seguridad.

**Recomendación: A.** Es el estándar del sector (tope al total cobrado), no añade fricción y el
motor de tramos ya se re-ejecuta tras la devolución, así que el cash bajo calza solo.

---

## 2) Dos firmas concurrentes con el mismo token (contratos)

**Dónde:** `app/api/public-contracts/sign-student/[token]` (y la variante `sign/[token]`).

**Estado real (verificado hoy):** el flujo lee el contrato, genera PDF + hash, sube el PDF con
`upsert: true` y hace el UPDATE final **sin condicionar por el estado leído** (sin compare-and-
swap). Dos pestañas / doble clic pueden firmar dos veces: el segundo UPDATE pisa PDF, hash, IP y
fecha del primero; el Storage sobrescribe el objeto. En firma de alumno, además, el webhook de
onboarding a GHL se dispara **antes** del UPDATE — dos firmas concurrentes pueden dar de alta dos
veces al alumno en GHL.

**Qué puede pasar:** valor jurídico del documento firmado (¿cuál es el verdadero?) y duplicados de
onboarding en GHL. Probabilidad baja (mismo token, casi al mismo segundo) pero el coste es alto y
el arreglo es mecánico.

**Opciones:**

- **A) CAS + idempotencia completa (recomendada).** El UPDATE final lleva `.neq('status',
'firmado')` (o `.eq('status', 'pendiente')`): si 0 filas actualizadas, el que llega tarde responde
  "ya firmado" con el PDF existente. El webhook de onboarding se mueve DESPUÉS del UPDATE ganador
  y solo lo dispara el ganador. Storage `upsert: false`. ~1 sesión + tests de carrera con mock.
- **B) Solo mover el webhook tras el UPDATE (mínimo).** Elimina el doble alta en GHL, pero mantiene
  la posible sobreescritura de PDF/hash. Media sesión.
- **C) Bloqueo pesimista por token.** Fila de lock en DB o `FOR UPDATE` vía RPC. Es lo más
  robusto, pero añade una migración/RPC para un caso de probabilidad mínima: sobredimensionado hoy.

**Recomendación: A.** El CAS es el mismo patrón que ya usamos en el claim de YouTube (#270), sin
migraciones; la ventana de carrera desaparece y el webhook queda en el sitio correcto del flujo.

---

## 3) Onboarding de alumno sin outbox (fallo de GHL tras firmar)

**Dónde:** mismo `sign-student/[token]` + `fireOnboardingWebhook`.

**Estado real (verificado hoy):** si el webhook a GHL falla, el contrato queda firmado con
`accesos_enviados_at: null` y `onboarding_webhook_ok: false` — **honesto y visible**, pero sin
ningún reintento automático: el alumno no recibe accesos hasta que alguien se da cuenta. Y el 409
del propio endpoint impide volver a firmar para reintentar. Caso inverso: si GHL acepta pero el
UPDATE posterior falla, el evento queda repetible sin dedupe visible.

**Qué puede pasar:** alumno firmó y pagó pero no recibe accesos (experiencia pésima, churn temprano)
descubierto tarde; o doble alta en GHL. La UI ya muestra el estado, así que hoy es un riesgo de
proceso humano, no de dato.

**Opciones:**

- **A) Outbox con reintento (recomendada).** El evento de onboarding se persiste ANTES de
  dispararse (tabla `outbox_events` o reutilizar `raw_events` del event-core de F1 si Claude Code
  prefiere), estado `pendiente → enviado`; un cron pequeño reintenta los pendientes con backoff.
  Dedupe por `contractId`. Requiere coordinación con el carril F1 (es su dominio de eventos) y una
  migración si va a tabla nueva.
- **B) Botón manual de reintento en la ficha del alumno.** ContractSection ya muestra "Enviado" en
  rojo cuando falló; añadir "Reintentar envío" que re-dispare el webhook. Media sesión, sin
  migración ni cron. La carga mental sigue siendo humana, pero el error deja de ser irreversible.
- **C) Automático en cada arranque de sesión del panel.** Chequeo perezoso al abrir students que
  re-dispara los fallidos de <24h. Sin cron, pero depende de que alguien entre al panel.

**Recomendación: A si el carril F1 está activo esta semana; B como puente si no.** El outbox es el
patrón correcto y ya tiene precedente en el repo (claim atómico de #270), pero no quiero pisar el
diseño de `raw_events` que está en curso — por eso esta decisión es también de coordinación.

---

## Resumen para decidir en 30 segundos

| #   | Decisión                                      | Recomendación                             | Coste estimado        |
| --- | --------------------------------------------- | ----------------------------------------- | --------------------- |
| A5  | Tope a devoluciones acumuladas + idempotencia | **A** (automático)                        | ~1 sesión             |
| 2   | Firma concurrente (CAS + webhook tras UPDATE) | **A** (completo)                          | ~1 sesión             |
| 3   | Reintento de onboarding de alumno             | **A** (outbox, coord. F1) o **B** (botón) | media sesión–1 sesión |

Responde con "A5: X · Firma: X · Onboarding: X" y las ejecuto en ese orden.
