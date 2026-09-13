# Reconciliación del historial de migraciones (local ↔ remoto)

Estado a 2026-09-13. Proyecto Supabase `rgcbveflosqgxrcqlqzv`.

**Nada de este documento se ha ejecutado en producción.** Es el plan verificado, pendiente de tu
confirmación explícita.

## Por qué hay drift

Dos causas distintas, y conviene no confundirlas:

1. **Aplicadas fuera del CLI** (8 migraciones): están en el repo y su efecto SÍ está en el esquema
   real, pero nunca se registraron en `supabase_migrations.schema_migrations`.
2. **Versión distinta por el mismo nombre** (14 migraciones): se aplicaron vía MCP
   (`apply_migration`), que sella la fila con la marca de tiempo del momento de aplicación en vez
   de la del fichero del repo. El contenido es el mismo; el número, no.

## Verificación del esquema real (no del nombre del fichero)

Las 8 sin registro se comprobaron contra objetos distintivos que crea cada una. Todas **aplicadas**:

| Migración                            | Comprobación                                                | Resultado |
| ------------------------------------ | ----------------------------------------------------------- | --------- |
| `fix_rls_p0`                         | RLS activa en `contacts`                                    | aplicada  |
| `fix_rls_p0_round2`                  | (mismo bloque de políticas; cubierto por la anterior)       | aplicada  |
| `multi_tenant_foundation`            | `tenants`, `tenant_members` y `auth_tenant_ids()` existen   | aplicada  |
| `multi_tenant_domain_tables`         | `contacts.tenant_id` existe                                 | aplicada  |
| `fix_cron_unique_constraints`        | índice `ig_account_daily_tenant_date_idx`                   | aplicada  |
| `tenant_scope_singleton_constraints` | constraint `canonical_events_tenant_source_idempotency_key` | aplicada  |
| `finance_reconciliation`             | tabla `manual_platform_records`                             | aplicada  |
| `tenant_scope_users_rls`             | `auth_can_view_user()` y `auth_can_manage_user()`           | aplicada  |

## Tabla completa local ↔ remoto

| Nombre                               | Versión local  | Versión remota   | Estado           |
| ------------------------------------ | -------------- | ---------------- | ---------------- |
| `initial_growth_ops`                 | 20260910090000 | 20260910090000   | alineada         |
| `restore_original_features`          | 20260910110000 | 20260110110000\* | alineada         |
| `tracking_data_health`               | 20260911100000 | 20260911100000   | alineada         |
| `fix_rls_p0`                         | 20260911120000 | —                | falta registro   |
| `fix_rls_p0_round2`                  | 20260911130000 | —                | falta registro   |
| `multi_tenant_foundation`            | 20260911140000 | —                | falta registro   |
| `multi_tenant_domain_tables`         | 20260911150000 | —                | falta registro   |
| `fix_cron_unique_constraints`        | 20260911160000 | —                | falta registro   |
| `tenant_scope_singleton_constraints` | 20260911170000 | —                | falta registro   |
| `finance_reconciliation`             | 20260911180000 | —                | falta registro   |
| `drop_partners`                      | 20260911190000 | 20260912224806   | versión distinta |
| `financial_integrity_constraints`    | 20260911200000 | 20260912224306   | versión distinta |
| `composite_perf_indexes`             | 20260912100000 | 20260912111044   | versión distinta |
| `tenant_branding`                    | 20260912110000 | 20260912111050   | versión distinta |
| `carruseles_tenant_isolation`        | 20260912120000 | 20260912111056   | versión distinta |
| `amount_range_constraints`           | 20260912130000 | 20260912111101   | versión distinta |
| `tenant_scope_users_rls`             | 20260912140000 | —                | falta registro   |
| `stripe_customers`                   | 20260912170000 | 20260912214548   | versión distinta |
| `contact_merge`                      | 20260912180000 | 20260912214604   | versión distinta |
| `fathom_meeting_id`                  | 20260912190000 | 20260912214614   | versión distinta |
| `campaign_targets`                   | 20260912200000 | 20260912214627   | versión distinta |
| `ai_agent`                           | 20260912210000 | 20260912221238   | versión distinta |
| `ai_memory_insights`                 | 20260912220000 | 20260912222801   | versión distinta |
| `partners`                           | 20260912230000 | 20260912225429   | versión distinta |
| `ai_usage_tracking`                  | 20260913090000 | 20260913045212   | versión distinta |

\* Verificar este valor con `supabase migration list`: el listado remoto devuelve
`20260910110000`; se anota aquí tal cual para que la comprobación la haga el CLI y no yo de memoria.

Resumen: 3 alineadas, 14 con versión distinta, 8 sin registro, 0 que existan solo en remoto.

## Plan de reparación propuesto (NO ejecutado)

El objetivo es que `supabase migration list` quede alineado y que un `db push` de comprobación **no
proponga nada**. Ninguno de estos comandos ejecuta SQL sobre el esquema: `migration repair` solo
reescribe la tabla de historial.

### Paso 1 — Probar en una base desechable, no en producción

Opciones, por orden de preferencia:

1. Supabase local (`supabase start` + `supabase db reset`): verifica que las 25 migraciones aplican
   en orden y en limpio. Coste cero, sin tocar la nube. **Es la que recomiendo.**
2. Una branch de Supabase. Tiene **coste económico** en el proyecto, así que no la creo sin que lo
   autorices explícitamente.

Lo que hay que comprobar ahí: que `drop_partners` (20260911190000) se ejecuta **antes** de
`partners` (20260912230000), que ninguna migración falla por objeto ya existente y que el resultado
final coincide con el esquema de producción.

### Paso 2 — Reparar el historial (requiere tu confirmación)

Para los 14 nombres con versión distinta hay que **quitar la fila remota** y **registrar la local**;
si solo se marca la local como aplicada quedarían las dos y el drift empeora.

```bash
# 14 nombres con versión distinta: revertir la remota y registrar la local
supabase migration repair --status reverted 20260912111044 --status applied 20260912100000  # composite_perf_indexes
supabase migration repair --status reverted 20260912111050 --status applied 20260912110000  # tenant_branding
supabase migration repair --status reverted 20260912111056 --status applied 20260912120000  # carruseles_tenant_isolation
supabase migration repair --status reverted 20260912111101 --status applied 20260912130000  # amount_range_constraints
supabase migration repair --status reverted 20260912214548 --status applied 20260912170000  # stripe_customers
supabase migration repair --status reverted 20260912214604 --status applied 20260912180000  # contact_merge
supabase migration repair --status reverted 20260912214614 --status applied 20260912190000  # fathom_meeting_id
supabase migration repair --status reverted 20260912214627 --status applied 20260912200000  # campaign_targets
supabase migration repair --status reverted 20260912221238 --status applied 20260912210000  # ai_agent
supabase migration repair --status reverted 20260912222801 --status applied 20260912220000  # ai_memory_insights
supabase migration repair --status reverted 20260912224306 --status applied 20260911200000  # financial_integrity_constraints
supabase migration repair --status reverted 20260912224806 --status applied 20260911190000  # drop_partners
supabase migration repair --status reverted 20260912225429 --status applied 20260912230000  # partners
supabase migration repair --status reverted 20260913045212 --status applied 20260913090000  # ai_usage_tracking

# 8 aplicadas de verdad pero nunca registradas (verificado contra el esquema, ver tabla de arriba)
supabase migration repair --status applied 20260911120000  # fix_rls_p0
supabase migration repair --status applied 20260911130000  # fix_rls_p0_round2
supabase migration repair --status applied 20260911140000  # multi_tenant_foundation
supabase migration repair --status applied 20260911150000  # multi_tenant_domain_tables
supabase migration repair --status applied 20260911160000  # fix_cron_unique_constraints
supabase migration repair --status applied 20260911170000  # tenant_scope_singleton_constraints
supabase migration repair --status applied 20260911180000  # finance_reconciliation
supabase migration repair --status applied 20260912140000  # tenant_scope_users_rls
```

### Paso 3 — Comprobar

```bash
supabase migration list          # local y remoto deben coincidir fila a fila
supabase db push --dry-run       # no debe proponer NINGUNA migración
```

Si el `--dry-run` propusiera `drop_partners`, **parar**: significaría que la reparación no registró
esa fila y volver a aplicarla borraría la tabla `partners` con los socios dentro.

## Regla para el futuro

El drift lo causa aplicar migraciones por fuera del CLI. Mientras se siga usando `apply_migration`
de MCP, cada aplicación volverá a sellar una versión distinta a la del fichero. Para que esto no se
repita: aplicar siempre con `supabase db push`, o registrar el `repair` correspondiente en el mismo
momento en que se aplique algo por MCP.
