# Sistema de Venta de Contratos de Alumnos + Onboarding

> **ESTADO: IMPLEMENTADO y desplegado a producción el 2026-07-08** ([tenant]).
> Migración v29 aplicada. Falta solo configurar 2 env vars en Vercel para activar email y
> webhook de accesos (ver §5.1 y §5.3): `RESEND_API_KEY` + `RESEND_FROM=[tenant]` y
> `GHL_ONBOARDING_WEBHOOK_URL`. Hasta entonces el flujo funciona con el enlace cortafuegos.


> Diseño para verificar ANTES de construir. Basado en la llamada de socios del 2026-07-08
> (Adri / [tenant] / Alex) y en el estado real del código de `[tenant]-os`.
>
> **Regla de oro acordada en la llamada:** simpleza y centralización. Todo el proceso
> (contrato, correo, cortafuegos, tracking) vive dentro de la app [tenant]. GoHighLevel
> solo se usa para **dar los accesos al curso** (el curso está alojado allí).

---

## 0. Objetivo y principios

- **Orden inamovible del flujo:** `PAGO → CONTRATO (firma) → ACCESOS`.
- **Firma en caliente:** el contrato debe poder firmarse durante la llamada. Metáfora de
  la cafetera: el lead se enfría en ~20 min. Nada de "administración lo envía mañana".
- **Cobertura legal:** contrato firmado (con IP + hash + timestamp) + acceso abierto
  (logueado) = prueba de que el alumno empezó a disfrutar del producto → defensa frente al
  desistimiento de 15 días.
- **Cortafuegos (firewall):** si un correo automático no llega (spam/promociones), el closer
  SIEMPRE tiene un enlace directo para copiar/pegar. Nunca depende de producto ni de terceros.
- **El closer sale de la llamada sabiendo:** ✅ pagó · ✅ firmó contrato · ✅ abrió accesos.

---

## 1. Producto y precios (decisión de la llamada)

Es **un solo producto**, "Master IA Expert", con dos duraciones (no son dos productos):

| Oferta | Precio | Duración | Uso |
|---|---|---|---|
| **Master IA Expert 6 meses** | **1.997 €** | 6 meses | Producto principal que empuja el closer |
| Master IA Expert 12 meses | 3.000 € | 12 meses | Upsell (ahorra 500 € vs. renovar luego) |
| Renovación 6→12 meses | 1.500 € | +6 meses | Post-venta, cuando quede ~15 días |

- El "Master Intensivo" (automatizaciones con Make) es un **módulo dentro** del IA Expert,
  no un producto aparte. La landing no debe parecer que hay dos productos.
- **Fase 1 (ahora):** el equipo vende SOLO los 1.997 € / 6 meses. Máxima simpleza para
  arrancar. El de 12 meses/3.000 € se activa como opción más adelante.

### Estado en el código
- `products`: hoy solo existe **"Master IA Expert (6 meses)"**. Los precios viven en
  `payment_plans.gross_price`, no en el producto.
- **A hacer (datos, no código):** añadir producto/planes de 12 meses (3.000 €) — dejarlos
  creados pero el wizard por defecto ofrece el de 6 meses.
- **A limpiar:** borrar el plan de ejemplo **"Pago Full Pay"** (mencionado en la llamada).

---

## 2. Métodos de pago

Valores ya sembrados en `payment_plans.method`: `reserva`, `stripe`, `transferencia`,
`autofinanciado`, `sequra` (planes: RES, FPS, FPT, AF2/3/4, SEQ3/6/9/12).

**Decisión: verificación de pago 100% MANUAL en Fase 1** (no integrar Stripe/Secura por API
todavía). El closer confirma el pago él mismo:

| Método | Cómo lo verifica el closer |
|---|---|
| Transferencia | Recibe justificante (PDF/captura) en llamada o por el grupo |
| Stripe | Captura de pantalla "Gracias por su pago" (se da por válido; imposible falsificar) |
| Secura / Autofinanciado | Compra aprobada en el carrito Secura |
| Reserva | Igual que Stripe/transferencia según cómo se pague |

- **Añadir "Plan de pagos custom"** (lo pidió Adri): permitir customizar (ej. "500 € ahora
  + resto por Secura"). Nuevo plan configurable en admin.
- **Por qué conservar todos los plazos** aunque el dinero llegue igual: es **data** para
  analizar comportamiento del closer y riesgo de morosidad (¿lanza siempre 12 plazos?).

---

## 3. Flujo completo (paso a paso)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  EN LLAMADA (closer)                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Lead paga  →  closer verifica (captura/justificante)                   │
│  2. Closer → App [tenant] → "Nueva Venta"                                │
│       Paso 1  Contacto (autovinculado a la cita de Calendly)               │
│       Paso 2  Producto + Plan de pago                                      │
│       Paso 3  Equipo (closer/setter automáticos)                           │
│       Paso 4  Confirmar  + [ADJUNTAR CAPTURA DE PAGO]  ← NUEVO             │
│       Paso 5  Generar contrato  ← NUEVO (genera + muestra enlace)          │
│  3. "Crear venta"  →  se crea la venta + se genera el contrato del alumno  │
│  4. Contrato se ENVÍA por email (Resend, [tenant])                │
│       + el closer tiene el ENLACE CORTAFUEGOS para pegarlo en Meet/WhatsApp│
│  5. Lead abre el enlace → mete sus datos → acepta condiciones (firma+IP)   │
│       → recibe copia PDF en su correo                                       │
├─────────────────────────────────────────────────────────────────────────┤
│  AUTOMÁTICO (al firmar)                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│  6. App [tenant] → WEBHOOK SALIENTE → GoHighLevel  ← NUEVO               │
│  7. GHL activa automatización de onboarding → da accesos al curso          │
│       + email de bienvenida + página de onboarding                         │
│  8. Closer verifica en la app: firmado ✅ · accesos enviados ✅            │
│       (accesos abiertos ✅ = fase 2, si GHL expone el dato)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Contrato de alumno (el núcleo del trabajo)

### 4.1 Qué existe hoy
- Flujo **nativo de equipo** (`kind='equipo'`) YA funciona perfecto (contrato de Jaime):
  plantilla → token → `/firmar/[token]` → captura IP + hash SHA-256 → PDF (`pdf-lib`) →
  Supabase Storage bucket `contratos` → email de copia firmada (Resend).
- El contrato de **alumno** hoy usa una biblioteca manual antigua (`kind='venta'`: solo
  contacto/título/URL/estado + webhook a e-sign externo). **Hay que subirlo al flujo nativo.**

### 4.2 Qué construir
1. **Plantilla "Contrato de alumno"** (nueva plantilla en `contract_templates`, reutilizando
   el editor de plantillas que ya existe):
   - Mini-plantilla: logo [tenant] + "Bienvenido a nuestra academia. Acepta las condiciones
     para recibir tus accesos."
   - Botón "Aceptar condiciones". Al desplegarlo se ve el contrato completo (términos legales),
     pero **por defecto no aparece** el textón largo — nada del contrato formal de equipo, que
     para un lead es demasiado formal y asusta.
   - Variables autocompletadas desde la venta (nombre, producto, importe, plan de pago).
2. **Generación enganchada a la venta:** en el Paso 5 del wizard, "Generar contrato" crea el
   contrato con `kind='venta'` + `sale_id` + `contact_id`, genera el `signing_token` y muestra
   el **enlace cortafuegos** (`/firmar/[token]`).
3. **Envío:** al "Crear venta" se envía el contrato por email (Resend). El enlace cortafuegos
   queda disponible dentro de la venta para copiar/pegar en cualquier momento.
4. **Descargar plantilla en PDF sin crear venta:** para leads pesados ("no firmo sin leerlo").
   Siempre desde la plantilla vigente, para no arrastrar contratos viejos descentralizados.
5. **Firma:** reutiliza `/firmar/[token]` existente (IP, hash, PDF a Supabase Storage, copia
   por email). El lead mete sus datos + acepta = firmado con IP registrada.

### 4.3 Tracking dentro de la venta
Sección "Contrato" en el detalle de la venta con pipeline de estados:

`enviado → (leído) → firmado → accesos enviados → (accesos abiertos)`

- Hoy `contracts.status` solo tiene `pendiente|enviado|firmado`. **Añadir** estados/campos:
  `leído` (opcional), `accesos_enviados_at`, `accesos_abiertos_at`.
- El closer ve de un vistazo: pagó / firmó / accesos → sale de la llamada con todo cerrado.

---

## 5. Onboarding y accesos

### 5.1 Webhook saliente a GHL (NUEVO — no existe hoy)
- **Disparador:** al firmar el contrato (`status='firmado'`).
- **Acción:** la app hace `POST` a la URL del webhook entrante de GHL con `{nombre, email,
  teléfono, producto}`. GHL busca el contacto y activa la automatización de accesos.
- Añadir env var (ej. `GHL_ONBOARDING_WEBHOOK_URL`).

### 5.2 Automatización de onboarding en GHL (trabajo de Alex, no código de la app)
- **Crear una automatización NUEVA** disparada por el webhook entrante:
  1. Da accesos al curso (productos marcados).
  2. Envía email de bienvenida + página de onboarding.
- **QUITAR el envío del contrato** de la automatización de GHL (ahora lo manda la app →
  evitar contrato duplicado / doble correo).
- **Nada se envía hasta que el contrato esté firmado.** Bug actual: el alumno recibía el
  WhatsApp/página de onboarding ANTES de firmar → entraba a la academia sin accesos → error
  "no existe contraseña" o se registraba en la comunidad gratis → se sentía estafado.

### 5.3 Correo de accesos (Resend)
- Configurar `RESEND_FROM = [tenant]` (dominio nuevo, sin lanzamientos → buena
  reputación, no cae en spam). El dominio de GHL está quemado por los lanzamientos.
- **Segundo cortafuegos:** la página de onboarding también es un enlace que el closer puede
  pegar si el correo no llega.

### 5.4 Simplificación del acceso (idea de [tenant])
- El alumno solo mete **usuario + contraseña** (contraseña autogenerada, cambiable luego).
- Al entrar se desbloquea el módulo 1 / sesión de bienvenida → "materia prima" inmediata para
  que no se sienta huérfano/estafado.
- **Depende de qué exponga GHL** (los accesos son de GHL).

### 5.5 Tracking "accesos abiertos" (Fase 2 — a investigar)
- Requiere que GHL envíe por API/webhook el evento de login/uso de módulos.
- Candidatos vistos en GHL: trigger de "clic en enlace de invitación" (usando el botón de la
  página de onboarding). **A revisar en la sesión Adri+Alex sobre GHL.**
- Importante legalmente (la abogada insiste): mucho más fácil ganar una reclamación si consta
  logueado. Prioridad baja para el arranque, pero deseable.

---

## 6. Otros ajustes de plataforma mencionados (fuera del núcleo)

- **Limpiar datos** de pruebas y cargar las ventas reales de estos días.
- **KPIs del closer automáticos** (ya lo son en parte): calls, shows, ventas, cash, tasas de
  show/cancelación/no-show. El closer NO rellena KPIs; solo el setter.
- **Botón de urgencia** en Sugerencias (alta/media/baja) para priorizar feedback.
- Borrar el plan de ejemplo "Pago Full Pay".

---

## 7. Cambios técnicos concretos (resumen para implementar)

| # | Cambio | Tipo | Dónde |
|---|---|---|---|
| 1 | Añadir producto/planes 12 meses (3.000 €) + plan custom; borrar "Full Pay" ejemplo | Datos | `payment_plans`, `products` |
| 2 | Adjuntar captura de pago en Paso 4 (Confirmar) | Código UI + storage | `app/evergreen/sales/new/page.tsx` + Supabase Storage |
| 3 | Paso 5 "Generar contrato" + enlace cortafuegos | Código UI | wizard nueva venta |
| 4 | Plantilla "Contrato de alumno" (mini, desplegable) | Datos + editor | `contract_templates` |
| 5 | Contrato de alumno con flujo nativo (`kind='venta'` + `sale_id`, token, firma) | Código | `lib/contracts`, `/firmar/[token]`, API contracts |
| 6 | Envío del contrato por Resend desde `[tenant]` | Config + código | `lib/email/resend.ts`, env `RESEND_FROM` |
| 7 | Sección "Contrato" en detalle de venta con estados + descargar PDF + copiar enlace | Código UI | `app/evergreen/sales/[id]` |
| 8 | Nuevos estados/campos de tracking (`accesos_enviados_at`, `accesos_abiertos_at`) | Migración BD | `contracts` |
| 9 | Webhook SALIENTE a GHL al firmar | Código | nueva API + trigger en firma |
| 10 | (Alex) Nueva automatización onboarding en GHL, sin contrato, disparada por webhook | GHL | fuera de la app |
| 11 | (Fase 2) Tracking "accesos abiertos" vía dato de GHL | Investigar | GHL API |

---

## 8. Decisiones confirmadas (2026-07-08)

1. **Plan de pagos custom:** constructor flexible — importe inicial ahora (ej. 500 €) + resto
   por Sequra/transferencia/X, en X meses. Configurable por venta. Siempre disponible como baza.
2. **Almacenamiento:** Supabase Storage (bucket `contratos`, mismo que el contrato de equipo).
   Descargable siempre, robusto, sin pérdida de datos. La captura de pago igual.
3. **Envío del contrato:** AUTOMÁTICO al "Crear venta" + enlace cortafuegos siempre disponible
   en la venta para envío manual (Meet/WhatsApp).
4. **Webhook GHL:** montar toda la fontanería ahora, con URL en variable de entorno
   (`GHL_ONBOARDING_WEBHOOK_URL`). Queda inerte hasta que se proporcione la URL. No bloquea.
5. **Acceso usuario+contraseña simplificado (5.4):** APARCADO por ahora. No se implementa.

### 8.1 UX del contrato de alumno (confirmado — clave)
- Es una **plantilla** que generamos.
- Al recibirlo, el lead ve un mensaje tipo: **"Bienvenido Winner, acepta las condiciones para
  recibir los accesos."**
- Un **"Acepto las condiciones"** donde la palabra **"condiciones"** es enlace/desplegable:
  al hacer clic puede leer el contrato completo. Por defecto NO se muestra el textón largo.
- Al pulsar **Aceptar** → contrato **firmado** (IP + hash SHA-256 + timestamp, como el de
  equipo) + copia en PDF al correo del alumno.

### 8.2 12 meses / 3.000 €
- Pendiente de confirmar por [tenant] si se crea ya (oculto) o se omite. No bloquea el arranque
  (Fase 1 vende solo 1.997 € / 6 meses).
