# Webhook de Hotmart: compras en tiempo real

Cómo entra una compra de Hotmart en la app en el momento (contacto, atribución y hecho canónico),
y qué NO hace el webhook todavía.

## URL y autenticación

```
POST https://app.scalixsystems.com/api/<slug-de-la-subcuenta>/evergreen/webhooks/hotmart
```

- El token de firma lo define el propietario al registrar el webhook en Hotmart y se guarda en
  **Integraciones → Hotmart → Webhook Secret (Hottok)** de ESA subcuenta (campo cifrado, sin
  respaldo en variables de entorno: el panel es la única fuente).
- Hotmart firma cada entrega con ese token de dos formas: `X-Hotmart-Hmac` (HMAC-SHA256 del cuerpo
  crudo, en base64 o hex — se aceptan ambas) o, en entregas legacy, `x-hotmart-hottok` (token en
  claro). La comparación es timing-safe y fail-closed: sin token guardado, todo es `401`.
- Subcuenta inexistente/inactiva y firma errónea responden lo mismo (`401 "Firma inválida"`): no
  se puede usar el endpoint para enumerar slugs. El motivo concreto del rechazo queda en el log
  del servidor (`[hotmart-webhook] 401 en "<slug>": …`), nunca en la respuesta.

## Qué hace la app con cada entrega

1. **Guarda el sobre completo** en `raw_events` ANTES de procesar nada — con la firma ya
   verificada. Un reintento del mismo evento cae en la misma fila
   (`tenant_id, source, source_event_id`); si una pasada anterior se quedó a medias, el reintento
   la sana en vez de duplicarla.
2. **Encaja el contacto** por el email del comprador (`data.buyer.email`), o lo crea con estado
   `venta` y canal de origen `hotmart` (solo al crear; un contacto que ya existía no cambia de
   pipeline). Si la entrega no trae email ni teléfono, no se encaja nadie: la entrega queda en
   `raw_events` para revisarla o enlazarla a mano.
3. **Registra la atribución** si el payload trae UTMs (primer toque conservando el primero; toque
   antiguo no se presenta como último). Sin UTMs no se escribe nada — un hueco no es un cero.
4. **Deriva el hecho canónico** (`hotmart.compra.aprobada`, `.reembolsada`, …) en
   `canonical_events`, con producto externo, importe declarado y moneda. La identidad del comprador
   NUNCA entra en el hecho (el sobre ya la tiene, con su control de acceso).

## Qué NO hace (y por qué)

- **No escribe en `sales` ni en `collections`.** La compra trae el producto EXTERNO de Hotmart y su
  importe; qué producto de la app es y qué plan de pago le corresponde es una decisión del
  propietario. Igual que el webhook de Stripe: el hecho queda guardado, el registro pasa por
  decisión humana. La respuesta del webhook lo declara (`mueve_dinero`, `clase`, `importe`).

## Eventos y respuestas

Eventos que la app entiende: `PURCHASE_APPROVED`, `PURCHASE_COMPLETE`, `PURCHASE_REFUNDED`,
`PURCHASE_CHARGEBACK`, `PURCHASE_PROTEST`, `PURCHASE_CANCELED`, `PURCHASE_EXPIRED`,
`PURCHASE_DELAYED`, `PURCHASE_BILLET_PRINTED`. Cualquier otro se guarda en crudo y responde `200`
con `procesado: false` — un 4xx solo provocaría reintentos inútiles de algo que ya está guardado.

- `401` firma inválida (no se reintenta a mano: Hotmart reintenta por su cuenta y seguirá fallando
  hasta que el token del panel y el del webhook coincidan).
- `400` cuerpo vacío o JSON inválido (no hay nada que reintentar).
- `500` fallo nuestro y transitorio (fallar la escritura del contacto): el reintento sana.
