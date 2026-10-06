# RECOVERY ROADMAP — growth-ops-app (27-sep-2026)

Orden reglado (§28): recuperar lo perdido → arreglar lo roto → completar lo parcial → datos/métricas →
UX → features nuevas. Cada paso = una PR pequeña con su status en el tablero de `docs/ACTIVE_HANDOFF.md`.

## PHASE R0 — Critical recovery (seguridad, dinero, datos)

| PR      | Qué                                                                                                                           | Fuente                         | Riesgo si no se hace                                  | Est.                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------- | ----------------------------- |
| PR-R0.1 | ✅ **HECHA (27-sep, PR #237):** port del doc `BASELINE_QUALITY_2026-09-26.md` (único contenido no fusionado de la rama local) | rama local 6160dc3             | El baseline de calidad queda fuera de main            | XS                            |
| PR-R0.2 | ✅ **HECHA (27-sep, PR #238):** crons `monthly`/`reminders` sin escrituras silenciosas + presupuesto de tiempo                | PENDIENTES 🔒 + handoff 26-sep | Silenciosos en pagos/morosos/aprobación de comisiones | M                             |
| PR-R0.3 | Inventario drift esquema↔migraciones (ledger vs DDL real) — requiere credenciales Supabase read-only                          | PENDIENTES 🔒                  | DDL fuera de git indetectable (flagged_delinquent)    | M — BLOCKED_USER credenciales |

## PHASE R1 — Restore lost working features

No hay features perdidas identificadas (ver BRANCH_RECONCILIATION). Esta fase queda vacía a propósito:
el único ítem era el doc baseline (R0.1). Si aparece trabajo nuevo no fusionado, entra aquí.

## PHASE R2 — Finish partial workflows

| PR      | Qué                                                                                                                                                                          | Dependencias                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| PR-R2.1 | Fusionar contenido de **PR #225** (cuentas ads + nuevo vs recurrente + dual chart): rebase sobre main, resolver solapes con #207–#236, quality, PR propia — decisión de Alex | USER: confirmar que quiere el port (su PR) |
| PR-R2.2 | ✅ **HECHA (27-sep, PR #239):** `commissions/future` verificada + `sales/delete` con borrado compensable (P2 26-sep)                                                         | —                                          |
| PR-R2.3 | Sequra: cerrar contabilidad de cuotas monitorizadas (no doble-contar cash) end-to-end                                                                                        | R0.2                                       |

## PHASE R3 — Data / metrics correctness

- PR-R3.1: clasificación de llamadas (ganada/perdida) derivada de datos canónicos, no de la IA (ROADMAP G).
- PR-R3.2: gate de columnas fantasma en CI (parser ya existe) — REQ-GHOSTCOL.
- PR-R3.3: verificar % shows/reservas con el golden dataset tras el port de #225 (BLOCKED_BY R2.1).

## PHASE R4 — UX / frontend consistency

- PR-R4.x (grandes, con Alex): tokens de color (1a), escala tipográfica (1b), formatos de moneda/fecha
  (1c), migración de modales (1d), split agendas tabla/calendario (PROMPT_ARQ 9), auditoría visual con
  navegador (requiere preview con credenciales). Todas PARTIAL→con la fuente canónica en
  `components/ui/*` y `lib/utils.ts`.

## PHASE R5 — Missing planned functionality

- R5.1: F3 resto de fases (continuar contrato de métricas).
- R5.2: creación de usuarios desde Config › Subcuentas (ROADMAP J).
- R5.3: % VSL desde el reproductor (WISHLIST 4) + estados configurables (WISHLIST 3, si los pide).
- R5.4: alertas A3 — DEPRIORIZADO por Alex (27-sep), no BLOCKED_USER: el tramo que llega al alumno
  se deja listo para conectar (detección separada del envío) el día que se decida el canal, pero no
  es prioridad ahora. No iniciar sin que Alex lo reactive.
- R5.5: rate limiting de login (decidir plataforma vs endpoint — USER).

## PHASE R6 — Cleanup legacy

- R6.1: cerrar rename Afiliados→Colaboradores (un vocabulario, redirect legacy).
- R6.2: tipado Database en clientes Supabase (grande; desbloquea validación en compilación).
- R6.3: quitar `?secret=` por query del webhook de onboarding (coordinar con GHL).
- R6.4: limpiar referencias muertas de PRs CLOSED y ramas locales ya demostradas superseded
  (la rama local se borra SOLO cuando el WIP del checkout raíz lo permita — no es de este agente).

## USER ACTION REQUIRED (específico, con orden sugerido)

1. Credenciales Supabase read-only en el entorno de agentes → desbloquea R0.3 + 3 tests + ledger.
2. Decidir sobre PR #225: rebase+merge, port manual, o cerrar (bloquea R3.3).
3. Rotaciones pendientes: ANTHROPIC_API_KEY, GROQ_API_KEY, token Management Supabase, GHL secret fuerte.
4. SEQURA_MERCHANT_REFERENCE en Vercel (cron morosos 500).
5. Pixel en womendigitalclosers.com + UTMs en enlaces.
6. Reconexiones de proveedores y workflows GHL con cabecera secreta.
7. Railway worker: crear servicio + env.
8. Retención legal de raw_events/transcripciones (F6).
9. Majors de Dependabot (tailwind 4 / eslint 10 / recharts 3): ventana de trabajo o cierre.
