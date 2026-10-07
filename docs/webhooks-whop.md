# Webhook de Whop: pagos y membresías en tiempo real

Cómo entra un pago de Whop en la app en el momento (contacto, atribución y hecho canónico), y qué
NO hace el webhook todavía.

## URL y autenticación

```
POST https://app.scalixsystems.com/api/<slug-de-la-subcuenta>/evergreen/webhooks/whop
```

- El signing secret (`ws_…`) lo da Whop **una sola vez** al crear el webhook (Developer tab →
  Create webhook) y se guarda en **Integraciones → Whop → Webhook Secret** de ESA subcuenta (campo
  cifrado, sin respaldo en variables de entorno: el panel es la única fuente). Pégalo tal cual, sin
  quitar el prefijo `ws_` ni codificarlo: la verificación deriva la clave del valor completo.
- Whop usa la especificación **Standard Webhooks**: cabeceras `webhook-id`, `webhook-timestamp` y
  `webhook-signature: v1,<base64>`; la firma es HMAC-SHA256 de
  `{webhook-id}.{webhook-timestamp}.{cuerpo crudo}` con la clave `ws_…`. La comparación es
  timing-safe y fail-closed, y se rechaza toda entrega cuyo timestamp diste más de 5 minutos
  (anti-replay, igual que hacen los SDK de Whop).
- Subcuenta inexistente/inactiva y firma errónea responden lo mismo (`401 "Firma inválida"`). El
  motivo concreto queda en el log del servidor, nunca en la respuesta.

## Qué hace la app con cada entrega

1. **Guarda el sobre completo** en `raw_events` ANTES de procesar nada. Los reintentos de Whop
   llegan con el MISMO `webhook-id`, así que caen en la misma fila
   (`tenant_id, source, source_event_id`); si una pasada anterior se quedó a medias, el reintento
   la sana en vez de duplicarla.
2. **Encaja el contacto** por el email del comprador (`data.user.email`), o lo crea con estado
   `venta` y canal de origen `whop` (solo al crear). Sin email ni teléfono, la entrega queda en
   `raw_events` para revisarla o enlazarla a mano.
3. **Registra la atribución** si el payload trae UTMs (primer toque conservando el primero; toque
   antiguo no se presenta como último). Sin UTMs no se escribe nada — un hueco no es un cero.
4. **Deriva el hecho canónico** (`whop.pago.recibido`, `whop.reembolso.creado`, …) en
   `canonical_events`, con producto externo, importe y moneda TAL COMO los manda Whop (sin
   conversión de unidades ni de divisa: el hecho transcribe, no interpreta). La identidad del
   comprador nunca entra en el hecho.

## Qué NO hace (y por qué)

- **No escribe en `sales` ni en `collections`.** Qué producto de la app es el producto de Whop y
  qué plan de pago le corresponde es una decisión del propietario. Igual que el webhook de Stripe:
  el hecho queda guardado, el registro pasa por decisión humana. La respuesta lo declara
  (`mueve_dinero`, `clase`, `importe`).

## Eventos, ritmo de respuesta y reintentos

Eventos que la app entiende: `payment.succeeded`, `payment.failed`, `refund.created`,
`membership.activated`, `member.created`. Cualquier otro se guarda en crudo y responde `200` con
`procesado: false`.

- Whop exige **2xx en menos de 5 segundos**: el motor no hace llamadas externas, solo escrituras a
  Supabase.
- Whop reintenta hasta ~3 días con el mismo `webhook-id` (idempotencia garantizada por la clave
  única del sobre) y **desactiva el endpoint** si falla 24-72 h seguidas: si todo llega con 401, el
  problema es el secret del panel, no el transporte.
