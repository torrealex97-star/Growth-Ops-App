-- F1 — VOCABULARIO DE EVENTOS DE HOTMART Y WHOP (`event_types`).
--
-- Espejo de `TIPOS_DE_EVENTO_HOTMART` (lib/eventos/hotmart.ts) y `TIPOS_DE_EVENTO_WHOP`
-- (lib/eventos/whop.ts), igual que la semilla de GHL/Stripe de 20260923090000 espejaba las suyas:
-- la lista del código manda, la migración es su reflejo para poder sembrar en producción sin
-- código. `canonical_events.event_name` sigue siendo texto libre: un evento no declarado se
-- guarda igual y queda como "no declarado" en esta tabla, nunca se rechaza.

INSERT INTO public.event_types (name, description, source) VALUES
  ('hotmart.compra.aprobada',   'Hotmart confirma una compra aprobada.',                                 'hotmart'),
  ('hotmart.compra.completa',   'Hotmart confirma la entrega completa de una compra.',                   'hotmart'),
  ('hotmart.compra.reembolsada','Hotmart comunica un reembolso.',                                        'hotmart'),
  ('hotmart.compra.disputa',    'Hotmart comunica una disputa o protesta.',                              'hotmart'),
  ('hotmart.compra.cancelada',  'Hotmart comunica una compra cancelada.',                                'hotmart'),
  ('hotmart.compra.expirada',   'Hotmart comunica una compra expirada.',                                 'hotmart'),
  ('hotmart.compra.retrasada',  'Hotmart comunica un pago retrasado.',                                   'hotmart'),
  ('hotmart.compra.recibo',     'Hotmart comunica la emisión del recibo.',                               'hotmart'),
  ('hotmart.evento.recibido',   'Evento de Hotmart recibido y guardado, sin clasificar todavía.',        'hotmart'),
  ('whop.pago.recibido',        'Whop confirma un pago exitoso.',                                        'whop'),
  ('whop.pago.fallido',         'Whop comunica un pago fallido.',                                        'whop'),
  ('whop.reembolso.creado',     'Whop comunica un reembolso.',                                           'whop'),
  ('whop.miembro.activado',     'Whop comunica una membresía activada.',                                 'whop'),
  ('whop.miembro.creado',       'Whop comunica un alta de miembro.',                                     'whop'),
  ('whop.evento.recibido',      'Evento de Whop recibido y guardado, sin clasificar todavía.',           'whop')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, source = EXCLUDED.source;
