# PROJECT RECONCILIATION — growth-ops-app (auditoría 27-sep-2026)

**Alcance**: 236 PRs (195 mergeadas), 936 tests + 740 métricas, 8 workflows de cron, 14 rutas cron,
fuentes de petición históricas (MEJORAS 1–16, PROMPT_ARQ 1–12, ROADMAP_MVP A–J, plan v1.6, PENDIENTES,
WISHLIST), rama abierta #225, rama local huérfana, WIP del checkout raíz.

## Current app state

- `main` @ c735136, CI success (quality con dead-code, gitleaks, build, Smoke E2E), worktree limpio.
- App Next.js 15 multi-tenant (Supabase, RLS en 108+ tablas) desplegada en Vercel
  (`https://app.scalixsystems.com`). 936 tests unitarios + 740 de métricas en verde; 3 saltos por
  credenciales Supabase ausentes en el entorno local.
- **Producción = main** (branch protection con CI required; nada se pushea directo). Vercel despliega
  por PR. Última verificación CI en el merge de #236 (27-sep, success 4/4 jobs).

## What is stable (DONE_VERIFIED, evidencia CI/tests/producción)

- Multi-tenancy y aislamiento (RLS, no-enumeración, invariantes automáticas contra esquema vivo).
- Money path: ventas/reservas/cobros, espejo Stripe idempotente + fees reales, comisiones (tramos por
  rep, reconciliación idempotente, lote), socios 55/30/15, I&G con comisión por mes de cobro.
- Event core F1 (raw_events → canonical_events → replay) + conectores F2 (GHL/Stripe/Meta sobre contrato).
- Webhook GHL endurecido (secreto por subcuenta, cuerpos inválidos 400, escrituras verificadas #236),
  Calendly org-scope, cualificación de leads, atribución first/last-touch.
- Funnels canónicos + UI, Fathom con matcher conservador + cola de revisión, grabaciones, GA4 OAuth,
  facturas IA (Gmail) con identidad y trazabilidad, contratos (nativa + firma externa), colaboradores
  con contrato encadenado, RAG/skills con inspector, aprovisionamiento de subcuentas, Data Health,
  Data Health de webhooks, alerts de silencio, Growth Brief, anotaciones, objetivos/previsión (F6.5).
- Smoke E2E en CI (reservas + ficha de contacto) contra tenant QA.

## What is partial (lo más relevante)

- Escrituras silenciosas: quedan ~76 (crons `monthly`/`reminders` primero — confluyen con P1 del 26-sep).
- F3 métricas: contrato v1 fusionado; el resto de la fase abierto.
- Rename Afiliados→Colaboradores en convivencia; filtros globales no unificados (pnl/finanzas/cohorts);
  deuda UX documentada (tokens, tipografía, formatos, modales); Sequra-monitorización sin cuadre completo;
  clasificación de llamadas ganada/perdida derivada de datos canónicos.

## What is missing (nunca implementado)

- Rate limiting propio de login (REQ-PROMPT-05); restore drill/PITR (REQ-PROMPT-08); alertas A3 con
  canal (REQ-A3); tipado Database en clientes Supabase (REQ-DATATYPING); creación de usuarios desde
  Subcuentas (REQ-COL-UI); auditoría visual completa (REQ-UXVISUAL).

## What is broken

- Nada bloqueante en `main` (CI success). Crons `ai-insights`/`stripe-payments` fallan **en schedule**
  (6 s) — preexistente, ajeno a esta auditoría, diagnosticado el 26-sep.
- Cron `sequra-morosos` 500 por `SEQURA_MERCHANT_REFERENCE` ausente en Vercel (USER).

## What is unmerged

- **PR #225** (`feat/money-25sep`, 9 commits, 34 ficheros): cuentas ads, nuevo-vs-recurrente, dual
  facturación vs cash. Base 14 commits atrás; solapes con #207–#236. La abrió el propio Alex.
- Doc único no mergeado: `docs/BASELINE_QUALITY_2026-09-26.md` (en rama local superseded).

## What was lost

- **Nada perdido en ramas remotas** (no existe ninguna aparte de main). Único exclusivo rescatable:
  el doc baseline. Los 40 CLOSED sin merge son Dependabot superado + `codex/qa-fixes` #4 (superseded,
  su contenido llegó por otras vías) + #210 (duplicado de #209).

## What is blocked (por el usuario o externo)

- USER: pixel en la web real + UTMs; reconexiones (Meta/Instagram, TikTok, Hotmart, GHL workflows,
  Calendly); retención legal (F6); mapeo de eventos de funnels; asignación producto/plan del backfill
  Stripe; rotaciones de claves (Anthropic/GROQ/Management token/GHL secret); Sequra merchant reference;
  Railway worker; re-ingesta RAG tras editar skills; majors de Dependabot.
- EXTERNO: e-sign real para contratos; Clarity sin histórico (límite API, decisión: no alimenta Funnels).

## Critical risks (para R0)

1. DDL en producción fuera de migraciones (`flagged_delinquent`) → drift esquema↔repo sin inventario.
2. Sobre #225: no fusionar a ciegas; solapes con 14 commits de main.
3. Verificación de ledger de migraciones bloqueada sin credenciales Supabase en el entorno (3 tests).
4. RAG re-ingesta pendiente tras últimos cambios de skills (metadatos en producción desactualizados).

## Deployment

VERIFIED en CI (Vercel preview por PR + producción por push a main protegido). El estado puntual de
producción (env vars, reconexiones de proveedores) depende de acciones USER listadas en PENDIENTES.md.
