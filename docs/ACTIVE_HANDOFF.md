# Relevo activo

Última actualización: 2026-09-12

## Estado canónico

- Rama fuente de verdad: `main`
- Último commit inspeccionado: `fc1166b` — objetivos configurables de ROAS/CAC/CPL con alertas.
- CI de `main`: verde.
- Despliegue de Vercel: activo en `https://growth-ops-weld.vercel.app`.
- PR abiertos al redactar este relevo: ninguno.

## Validado en producción

- Data Health carga para `women-digital-closer`.
- 943 contactos, 555 agendas, 469 registros de Calendly, 1.005 de HighLevel y 62 de Fathom.
- 0 duplicados normalizados de email, 0 de teléfono y 0 agendas sin contacto.
- Tracking canónico todavía no contiene eventos.

## Bloqueo actual

El código de `main` incluye cuatro migraciones que todavía no constan aplicadas en el proyecto Supabase de producción:

- `20260912170000_stripe_customers.sql`
- `20260912180000_contact_merge.sql`
- `20260912190000_fathom_meeting_id.sql`
- `20260912200000_campaign_targets.sql`

La ausencia fue verificada tanto en el historial de migraciones como consultando la existencia de tablas, columnas y función. Las capacidades dependientes no deben declararse terminadas hasta revisar las migraciones, probar aislamiento multitenant/RLS y aplicarlas con estrategia de rollback.

## Próxima acción exacta

1. Revisar las cuatro migraciones y sus consumidores como cambio HIGH/CRITICAL.
2. Validar compatibilidad, RLS, aislamiento entre tenants y rollback en entorno no productivo cuando esté disponible.
3. Aplicarlas en orden solamente con evidencia suficiente.
4. Ejecutar smoke tests de clientes Stripe, fusión de contactos, sincronización Fathom y objetivos de campañas.
5. Actualizar este archivo y publicar a `main` solo si el Quality Gate pasa.

## Regla de continuidad

Si existe un único PR o rama activa, continuar allí. No crear una segunda rama. Si el trabajo está validado, fusionarlo a `main`, verificar CI/despliegue y eliminar la rama antes de cerrar la sesión.
