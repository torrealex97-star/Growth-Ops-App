# Webhook de GHL: transporte, secret y limitaciones conocidas

Cómo entra en tiempo real lo que pasa en GoHighLevel (contactos, agendas, show/no_show) y cómo
diagnosticar por qué no entra. Complementa al cron diario `cron/calendly-ghl` (red de seguridad con
ventana de 14 días) y al botón "Sincronizar histórico" de Integraciones (ventana de 5 años).

## URL y autenticación

```
POST https://growth-ops-weld.vercel.app/api/<slug-de-la-subcuenta>/evergreen/webhooks/ghl
Cabecera: x-ghl-secret: <valor de GHL_WEBHOOK_SECRET en Integraciones de ESA subcuenta>
```

- El secret es **por subcuenta** (se configura en el panel de Integraciones, campo cifrado).
- Comparación **timing-safe** y fail-closed: sin cabecera o con valor incorrecto → `401` (con línea
  `[ghl-webhook] 401: …` en los logs de Vercel, para poder distinguir "no llegó" de "llegó mal").
- Subcuenta inexistente/inactiva y secret erróneo responden lo mismo (401): no se puede enumerar slugs.

## Limitaciones conocidas de GoHighLevel (2026-09)

| Mecanismo de GHL                                            | ¿Envía cabeceras personalizadas?                                                                                                           | Veredicto para nuestro webhook                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Settings › Integrations › Webhooks** (herramienta simple) | ❌ No admite cabeceras                                                                                                                     | **Inutilizable tal cual**: la entrega llega sin `x-ghl-secret` → 401 siempre   |
| **Workflow → Trigger → acción "Custom Webhook"**            | ✅ Sí (método, headers, body)                                                                                                              | **Vía recomendada**; en subcuentas es acción **LC Premium** (de plan superior) |
| **Marketplace App (OAuth, app propia)**                     | ✅ (suscripción de eventos con firma)                                                                                                      | Alternativa seria; requiere crear app en el Marketplace de GHL                 |
| Logs de entrega                                             | Vía "Webhook Logs" en Marketplace Apps; la herramienta simple y los workflows no exponen el historial de entregas con detalle de cabeceras | Por eso el diagnóstico vive en NUESTRO endpoint                                |

Otras limitaciones observadas/del dominio público:

- GHL **no reintenta con detalle ni explica** por qué un alta no produce datos: si la URL falla o la
  cabecera falta, el alta "existe" pero nada llega. Nuestro endpoint loguea cada rechazo para no
  depender de GHL.
- El casing de las cabeceras HTTP/2 va en minúsculas y el runtime lo normaliza; el matching de
  nuestra app es case-insensitive (lo verifica un test).
- Los espacios alrededor del valor de una cabecera los recorta el runtime (spec fetch): si en GHL se
  pega el secret con espacios, no llegan como parte del valor. El diagnóstico lo declara.

## Modo diagnóstico del transporte

Para responder "¿lo que GHL envía llega intacto?" sin exponer secretos:

```
POST https://growth-ops-weld.vercel.app/api/<slug>/evergreen/webhooks/ghl?diagnostico=1
```

(Con las mismas cabeceras que usaría el webhook real en GHL.) Responde:

```json
{
  "ok": true,
  "modo": "diagnostico",
  "subcuenta_encontrada": true,
  "cabeceras_recibidas": ["x-ghl-secret", "content-type", "..."],
  "diagnostico": {
    "cabecera_presente": true,
    "cabecera_nombre_recibida": ["x-ghl-secret"],
    "longitud_recibida": 24,
    "huella_recibida": "1a2b3c4d",
    "coincide_con_panel": true,
    "panel_configurado": true,
    "pista": null
  }
}
```

- `huella_recibida` = sha256 truncado a 8 hex del valor recibido (no reversible, jamás el valor).
- `coincide_con_panel` = comparación server-side contra `GHL_WEBHOOK_SECRET` del panel.
- `pista` = causa concreta cuando algo va mal: cabecera ausente (→ herramienta simple de GHL, que no
  puede enviar cabeceras), longitud distinta (→ valor truncado en el alta), mismo largo distinto
  valor (→ secret equivocado), panel sin configurar.

Receta de verificación de transporte en 30 segundos:

```bash
curl -s -X POST 'https://growth-ops-weld.vercel.app/api/women-digital-closer/evergreen/webhooks/ghl?diagnostico=1' \
  -H 'x-ghl-secret: <el valor del panel>' -H 'content-type: application/json' -d '{}'
```

Si `coincide_con_panel: true` → el transporte es intacto y cualquier fallo posterior está en el
payload o en la lógica, no en el transporte.

## Alta recomendada en GHL (paso a paso)

1. Subcuenta WDC → **Automation → Workflows → Create Workflow**.
2. Trigger: **"Contact Booked Appointment"** (alta de agenda) y, en un segundo workflow,
   **"Appointment Status"** (show / no_show / cancelada / confirmada).
3. Acción: **Custom Webhook** (LC Premium). URL y cabecera `x-ghl-secret` como arriba. Cuerpo:
   mapear al menos `contactId`, `appointmentId`, `startTime`, `status`, `email`, `fullName`.
4. Publicar el workflow y crear una **cita de prueba**.
5. Verificar: en Vercel → Logs filtrar `ghl-webhook` (debe aparecer `ok: appointment.created`);
   en la app, la cita en Agendas con fuente GHL; el acta en `audit_logs`.

## Qué maneja el webhook

- Opt-in de lead (contacto + atribución, sin agenda), alta de agenda (upsert idempotente por
  `external_id`), actualizaciones de estado (show/no_show/confirmada/cancelada, sin duplicar),
  progreso de VSL (`vsl_watch_pct`), cualificación del formulario, asignación de closer/setter y
  UTMs first/last-touch.
