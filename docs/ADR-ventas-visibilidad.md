# Decisión: las ventas del equipo son visibles para todo el equipo

**Estado:** aceptada · **Decide:** Alex (dueño del negocio) · **Fecha:** 2026-09-15

## Qué se decidió

Cualquier persona con rol en la subcuenta puede LEER las ventas y los cobros de las demás. No se
restringe a "lo mío" aunque su `users.data_scope` sea `'own'`.

## Por qué está escrito aquí

Porque **parece un bug y no lo es**, y sin este documento la siguiente auditoría lo volverá a marcar
como hallazgo y alguien lo "arreglará" rompiendo el ranking del equipo.

El detalle técnico que lo hace parecer un fallo: `sales` y `collections` tienen **dos** políticas
PERMISIVAS de SELECT cada una, y las permisivas se combinan con **OR**, no con AND:

| Tabla   | Política             | Condición                                                                                                |
| ------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `sales` | `sales_select_team`  | `get_my_role() IS NOT NULL`                                                                              |
| `sales` | `sales_select_scope` | `is_admin_or_director() OR my_data_scope() = 'team' OR setter_id = auth.uid() OR closer_id = auth.uid()` |

La primera concede a cualquiera del equipo, así que la segunda **nunca puede negar nada**: es
decorativa. En la práctica, `data_scope = 'own'` NO se respeta en base de datos para ventas ni cobros
— solo lo aplica el código de las pantallas, que es más estricto que la base.

## Lo que esto implica, y se acepta a sabiendas

- Una consulta directa a PostgREST con la sesión de un closer devuelve las ventas de todo el equipo,
  aunque la pantalla se las filtre. La barrera de "solo lo mío" es de interfaz, no de datos.
- El aislamiento **entre subcuentas** NO se ve afectado: lo sostiene la política RESTRICTIVE
  `*_tenant_isolation`, que se combina con AND y sigue aplicándose entera.
- Lo que sí se cerró es la escalada de rol entre subcuentas: ver
  `supabase/migrations/20260915130000_rol_acotado_por_subcuenta.sql`.

## Qué haría falta para revertirla

Fusionar las dos políticas de SELECT en una sola con la condición de `sales_select_scope`. Consecuencia
directa: un closer con `data_scope = 'own'` dejaría de ver el ranking del equipo y las pantallas de
analítica comparativa. Es una decisión de producto, no una corrección técnica.
