import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/--[^\n]*/g, '').replace(/\/\/[^\n]*/g, '')

// ---------------------------------------------------------------------------------------------
// #66 · Anotaciones sobre gráficos: nota del equipo anclada a una fecha, para marcar en TrendChart
// por qué un pico/valle pasó lo que pasó. La RLS es el backstop real (la API usa la sesión del
// usuario, no service_role), así que estas pruebas verifican la migración tanto como la ruta.
// ---------------------------------------------------------------------------------------------

const migracion = () => sinComentarios(leer('supabase/migrations/20260924100000_annotations.sql'))

test('la tabla annotations tiene RLS habilitada y aislamiento por tenant', () => {
  const sql = migracion()
  assert.match(sql, /CREATE TABLE public\.annotations/)
  assert.match(sql, /ALTER TABLE public\.annotations ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /annotations_tenant_isolation.*AS RESTRICTIVE FOR ALL/s)
  assert.match(sql, /tenant_id IN \(SELECT public\.auth_tenant_ids\(\)\) OR public\.is_super_admin\(\)/)
})

test('cualquier miembro del equipo puede leer y anotar, solo el autor o admin/director puede corregir/borrar', () => {
  const sql = migracion()
  assert.match(sql, /annotations_select_team.*FOR SELECT\s*\n\s*USING \(get_my_role\(\) IS NOT NULL\)/)
  assert.match(
    sql,
    /annotations_insert_team.*FOR INSERT\s*\n\s*WITH CHECK \(get_my_role\(\) IS NOT NULL AND created_by = auth\.uid\(\)\)/
  )
  assert.match(
    sql,
    /annotations_update_own_or_admin[\s\S]*?USING \(created_by = auth\.uid\(\) OR is_admin_or_director\(\)\)/
  )
  assert.match(
    sql,
    /annotations_delete_own_or_admin[\s\S]*?USING \(created_by = auth\.uid\(\) OR is_admin_or_director\(\)\)/
  )
})

test('la tabla guarda fecha, título, descripción, categoría y autor', () => {
  const sql = migracion()
  for (const columna of [
    'date         DATE NOT NULL',
    'title        TEXT NOT NULL',
    'description  TEXT',
    'category     TEXT',
    'created_by   UUID NOT NULL REFERENCES public.users(id)',
  ]) {
    assert.match(sql, new RegExp(columna.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

const rutaLista = () => sinComentarios(leer('app/api/[tenant]/evergreen/anotaciones/route.ts'))
const rutaBorrado = () => sinComentarios(leer('app/api/[tenant]/evergreen/anotaciones/[id]/route.ts'))

test('la ruta valida el formato de fecha y el tamaño del título antes de insertar', () => {
  const codigo = rutaLista()
  assert.match(codigo, /FECHA\.test\(date\)/)
  assert.match(codigo, /title\.length > 200/)
  assert.match(codigo, /description\.length > 2000/)
})

test('la ruta se lee y se escribe con la sesión del usuario, no con service_role', () => {
  assert.match(rutaLista(), /from '@\/lib\/supabase\/server'/)
  assert.doesNotMatch(rutaLista(), /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(rutaBorrado(), /from '@\/lib\/supabase\/server'/)
})

test('el POST fuerza tenant_id y created_by desde requireTenant, nunca desde el body', () => {
  const codigo = rutaLista()
  const bloqueInsert = codigo.slice(
    codigo.indexOf('.insert({'),
    codigo.indexOf('.select(', codigo.indexOf('.insert({'))
  )
  assert.match(bloqueInsert, /tenant_id: auth\.tenantId/)
  assert.match(bloqueInsert, /created_by: auth\.userId/)
})

test('el DELETE está acotado al tenant, así que no se puede borrar una anotación de otra subcuenta', () => {
  const codigo = rutaBorrado()
  assert.match(codigo, /\.eq\('tenant_id', auth\.tenantId\)/)
})

test('TrendChart acepta anotaciones opcionales y las pinta como ReferenceLine sin romper cuando no se pasan', () => {
  const codigo = sinComentarios(leer('components/os/TrendChart.tsx'))
  assert.match(codigo, /annotations\?: TrendAnnotation\[\]/)
  assert.match(codigo, /import \{ Area, AreaChart, CartesianGrid, ReferenceLine,/)
  assert.match(codigo, /marcas\.map\(\(m\) =>/)
  // Solo se pintan las que caen dentro de la serie: una fecha fuera de rango no debe intentar dibujarse.
  assert.match(codigo, /fechas\.has\(a\.date\)/)
})
