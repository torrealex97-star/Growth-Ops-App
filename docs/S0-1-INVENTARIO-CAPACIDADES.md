# S0.1 — Inventario de capacidades

Fase activa: **S0 tramo 1**. Ver `docs/00-CONSTITUCION.md` §5.
Código auditado: `origin/main` en `06d1b5b` (PR #95). Fecha: 2026-09-20.

Método: `INSPECTED` (lectura del repo) y `TESTED` donde se indica. Los recuentos de producción
proceden de una consulta de solo lectura al proyecto Supabase `rgcbveflosqgxrcqlqzv` el 2026-09-20;
no se ejecutó ni modificó nada.

## 1. Superficie

| Dimensión                            | Recuento                                    |
| ------------------------------------ | ------------------------------------------- |
| Páginas (`app/[tenant]/**/page.tsx`) | 92                                          |
| Rutas de API (`app/**/route.ts`)     | 180, de las cuales 168 bajo `/api/[tenant]` |
| Módulos de dominio (`lib/*`)         | 73                                          |
| Migraciones versionadas              | 66                                          |
| Ficheros de test                     | 123                                         |
| Tablas en producción (`public`)      | 106, todas con RLS habilitada               |

## 2. Baseline de calidad (TESTED el 2026-09-20)

| Comprobación                      | Resultado                                                  |
| --------------------------------- | ---------------------------------------------------------- |
| `tsc --noEmit`                    | **PASS** (exit 0, sin diagnósticos)                        |
| Suite completa `tests/*.test.mjs` | **PASS** — 485 tests: 482 pasan, **0 fallan**, 3 se saltan |

Los 3 saltados no son omisiones: `columnas-fantasma`, `esquema-tenant-invariante` y la frescura del
artefacto de tipos se auto-saltan sin `SUPABASE_SERVICE_ROLE_KEY`, y **en CI sí corren** porque el
workflow les inyecta secrets de solo lectura.

La puerta de CI (`.github/workflows/ci.yml`) encadena `format:check`, `lint`, `typecheck`,
`dead-code`, `test` (con secrets), `test:metrics` y, solo entonces, `build`. Añade un job
`gitleaks` sobre el **historial completo** con `--redact` en cada push y PR.

**Conclusión del tramo: la base es sólida.** El trabajo de S0 no es estabilizar una app rota, sino
cubrir los huecos concretos de §4 y §5.

## 3. Capacidades y estado

Estado: **Estable** (código, datos y cobertura), **Parcial** (funciona, con hueco identificado),
**Sin datos** (implementado, 0 filas en producción).

| Capacidad                                       | Tablas                                                | Filas prod       | Estado                              |
| ----------------------------------------------- | ----------------------------------------------------- | ---------------- | ----------------------------------- |
| CRM / contactos                                 | `contacts`, `contact_notes`, `activities`             | 972 / 0 / 1      | Estable                             |
| Agenda y citas                                  | `appointments`                                        | 559              | Estable                             |
| Ventas                                          | `sales`, `payment_plans`, `products`                  | 28 / 21 / 2      | Estable                             |
| Cobros                                          | `collections`, `stripe_payments`                      | 49 / 69          | Estable                             |
| Comisiones                                      | `commissions`, `commission_rules`                     | 49 / **0**       | Parcial — ver §4.2                  |
| Meta Ads                                        | `campaigns`, `campaign_ads`, `campaign_daily`         | 171 / 350 / 1793 | Estable (mayor volumen)             |
| Instagram                                       | `ig_media`, `ig_audience`, `ig_competitor*`           | 40 / 104 / 51    | Parcial — token de WDC sin permisos |
| Tracking / pixel                                | `analytics_*`, `tracking_sites`                       | 2 / 2            | Parcial — poco volumen aún          |
| Atribución                                      | `contact_attributions`                                | **0**            | Parcial — ver §4.3                  |
| Event core                                      | `raw_events`, `canonical_events`, `delivery_attempts` | 4 / 4 / 0        | Parcial — ver §4.1                  |
| Conectores / sync                               | `integration_settings`, `integration_sync_runs`       | 23 / 96          | Estable                             |
| Agente IA + RAG                                 | `ai_*`, `knowledge_chunks`                            | 20/26/32 / 180   | Estable                             |
| Llamadas                                        | `call_recordings`, `fathom_match_review`              | **0** / 178      | Parcial                             |
| Identidad                                       | `identity_matches`, `contacts.merged_into`            | 0                | Parcial                             |
| Privacidad                                      | —                                                     | —                | **Ausente** — ver §4.4              |
| Contratos, afiliados, carruseles, email, social | varias                                                | 0 en su mayoría  | Sin datos                           |

## 4. Huecos reales

### 4.1 El webhook de GHL no escribe capa raw (bloquea F1)

`app/api/[tenant]/evergreen/webhooks/ghl/route.ts` (482 líneas): **0 referencias a `raw_events` y 0
a `canonical_events`**. Escribe directo a `contacts`, `appointments`, `contact_attributions`,
`qualification_questions` y `audit_logs`.

Tiene idempotencia de efecto (`upsert` con `onConflict: 'tenant_id,external_id'` en `appointments`,
matching de contacto en tres niveles), pero **el payload original no se conserva**. Un reenvío de
GHL converge; una corrección retroactiva de la lógica de mapeo no se puede reprocesar. Es el
trabajo central de F1.

Las migraciones de la capa raw **sí existen** (`20260915100000_tracking_sites_and_raw_layer.sql`);
lo que falta es que el webhook la use.

### 4.2 El porcentaje de comisión está escrito en el código (P1, va a F3)

`lib/commissions/generate.ts:103`:

```ts
const percent = rule?.percent ?? (role === 'setter' ? 5 : 10)
```

Con `commission_rules` a 0 filas, **las 49 comisiones de producción se calcularon con ese 5 % / 10 %
de respaldo**, en silencio. No es un bug: es el comportamiento diseñado. Pero el porcentaje al que
se paga a personas reales no existe como regla configurada ni auditable, lo que choca con "Config,
not code" (§3) y es exactamente lo que `MONEY.md` y F3 tienen que fijar.

### 4.3 No hay atribución persistida (bloquea F7 y F4)

`contact_attributions` = **0 filas** con 972 contactos y 1793 días de campaña. El código del webhook
que la escribe (líneas 303-317) es correcto, pero solo corre `if (hasUtm || source)`. Conclusión:
**GHL no está enviando UTMs ni `source`**. Es configuración del webhook en GHL, no código.

Sin capa raw (§4.1) no se puede confirmar leyendo el histórico: para diagnosticarlo hay que loguear
temporalmente el payload completo, o cerrar F1 primero.

### 4.4 No existe `erase_person` (F6)

`grep -ril "erase_person"` sobre todo el repo → **vacío**. `contacts` guarda `full_name`, `email` y
`phone` en claro sobre **972 personas reales**, sin procedimiento de borrado probado.

No depende de ninguna fase previa. Por eso la Enmienda 1 de la constitución lo adelanta a justo
después de F-1.

### 4.5 Coberturas ausentes

- **Ningún test ejerce el webhook de GHL.** No hay `tests/*ghl*`. Es la única entrada automática de
  personas al sistema y el journey con más volumen detrás.
- `call_recordings` = 0 con `fathom_match_review` = 178: cola de revisión sin objeto.

## 5. Lo que ya está resuelto y no hay que rehacer

Para evitar que una sesión futura vuelva a "descubrirlo":

- **Aislamiento de tenant**: `requireTenant()` en **149 de 168** rutas bajo `/api/[tenant]`. Las 19
  restantes son legítimamente sin sesión — 5 webhooks (secreto propio), 9 crons (`CRON_SECRET`),
  3 de auth y 2 migraciones admin. Hay tests dedicados: `tenant-isolation`, `fase3-tenant-queries`
  ("ninguna query service-role a tabla con tenant_id queda sin filtro"), `uniques-multitenant`,
  `rol-por-tenant`, `tenant-no-enumeration`, `esquema-tenant-invariante`.
- **Secretos**: `gitleaks` sobre el historial completo en cada push y PR.
- **Drift de esquema**: auditor de columnas fantasma en CI contra el esquema vivo, más chequeo de
  frescura del artefacto de tipos.

## 6. Qué queda de S0 tramo 1

- **S0.2** — journeys críticos: hecho, en `docs/S0-2-JOURNEYS-CRITICOS.md`.
- **S0.3** — regresión golden: escribir los tests que faltan, empezando por el webhook de GHL (§4.5),
  antes de que F1 lo reescriba.
