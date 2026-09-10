# ESTADO ACTUAL — [tenant] OS
> Documento vivo. Al retomar la conversación, **lee esto primero** para continuar desde donde lo dejamos.
> Última actualización: **2026-07-02**

## Qué es
App de gestión comercial (Next.js 14 + Supabase + Vercel) para la academia [tenant].
- **Producción:** https://tu-dominio.com · Deploy: `vercel --prod --yes` (cuenta Vercel `<cuenta-de-vercel>`).
- **Supabase:** `wdkedextuajxoulzzkip`. Migraciones vía `psql $POSTGRES_URL -f scripts/migration-*.sql`.
- ⚠️ NUNCA correr `next build` local con el dev server (:3001) vivo → corrompe `.next`.

## Arquitectura por departamentos (RBAC)
Dirección · Ventas · Marketing · Producto/Alumnos · Finanzas · Sistema. Roles: admin, director, manager, setter, closer, triager, cold_caller, affiliate, marketing, adscripcion, editor, csm, cobros. Acceso acotado por `ROLE_ALLOWED_PREFIXES` (lib/auth/permissions.ts) + zone-lock en app/evergreen/layout.tsx.

## Lo que YA está hecho
- **CRM/Ventas:** Leads (datos+first/last UTM+notas+orden fecha+badge "no llamar"), Contactos (ficha completa+notas), Agendas (tabla+calendario+análisis IA+métricas equipo+duración), crear-contacto inline, alta venta con preview por método + reserva.
- **Ranking** (antes Pipeline): funnel, leaderboards por rol, objetivos (editar/eliminar), tiempos Lead→Contacto/Agenda/Compra.
- **Pagos:** Full Pay Stripe(−5%)/Transfer(−3%), Autofinanciado 2/3/4 (+recargo), Sequra 3/6/9/12 (70% cash, cuotas monitorización). Cash collected por método → comisión. Comisiones plataforma (processing_fee). Morosidad + rol Cobros. Devoluciones (ventana 15 días → resta comisiones).
- **Finanzas:** Resumen financiero, P&L, reparto de socios (55/30/15), Unit Economics + embudo marketing, Cohortes, Gastos (3 estados+factura IA+recurrentes+sueldos auto), Biblioteca de facturas.
- **Marketing:** Campañas (→contabilizar gasto), Atribución visual (first/last, agendas, top anuncios), Contenido.
- **Producto:** Alumnos (journey+renovación), Eventos CSM, Retención, Cancelaciones/Drops.
- **IA:** facturas (visión Claude), análisis de llamadas (Groq Whisper + Claude). **Tareas automáticas DESACTIVADAS**. Worker de transcripción (código en `worker/`, SIN desplegar a Railway).
- **Webhook GHL** + recuperación de contraseña + invitaciones. Comisiones con filtros + comisión esperada por venta.
- **[tenant]:** todas estas mejoras portadas a https://app.the[tenant].es (branding propio, sin precios).

## Migraciones aplicadas
v3–v12 en `scripts/migration-v*.sql`.

## EN QUÉ ESTAMOS AHORA — batch 2026-07-02 (detalle/checklist en MEJORAS-DESDE-HOY.md)
Ver `MEJORAS-DESDE-HOY.md` para el estado ✅/⏳ de cada punto de este batch (refunds en I&G, afiliados, reservas, invitación por departamentos, contratos, gestoría, filtros+export, revisión de fórmulas).

## Pendientes de fondo (PENDIENTES.md)
Worker Railway · 2º webhook GHL real · rotar claves · matices Sequra/reserva · automatizaciones A3 · limpiar contactos de prueba · definir planes/socios propios de [tenant].
