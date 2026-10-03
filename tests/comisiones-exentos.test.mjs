// REGRESIÓN — usuariosExentosDeComision preguntaba `users.tenant_id`, columna que NO existe
// (la identidad es global; la subcuenta vive en tenant_members). El 42703 degradaba a
// "nadie exento" y se veía en postgres_logs cada pocos minutos:
// `column users.tenant_id does not exist`.
//
// El fake graba contra qué tabla y con qué filtros se pregunta: la consulta debe ir contra
// tenant_members (membresía de ESTA subcuenta) y por users.pays_commissions — nunca contra
// users con un filtro de tenant.
import test from 'node:test'
import assert from 'node:assert/strict'

import { usuariosExentosDeComision } from '../lib/commissions/generate.ts'

const TENANT = '00000000-0000-0000-0000-000000000001'

function clienteFalso(filas) {
  const llamado = { tabla: null, seleccion: null, filtros: [] }
  const builder = {
    select: (columnas) => {
      llamado.seleccion = columnas
      return builder
    },
    eq: (columna, valor) => {
      llamado.filtros.push([columna, valor])
      return builder
    },
    in: () => builder,
    then: (ok, fallo) => Promise.resolve({ data: filas, error: null }).then(ok, fallo),
  }
  const sb = {
    from: (tabla) => {
      llamado.tabla = tabla
      return builder
    },
  }
  return { sb, llamado }
}

test('exentos de comisión: pregunta a tenant_members (membresía), NO a users.tenant_id', async () => {
  const { sb, llamado } = clienteFalso([{ user_id: 'u-socio' }, { user_id: 'u-otro' }])
  const exentos = await usuariosExentosDeComision(sb, TENANT)

  assert.equal(llamado.tabla, 'tenant_members')
  assert.ok(llamado.seleccion.includes('user_id'), 'selecciona user_id de la membresía')
  assert.ok(
    llamado.filtros.some(([c, v]) => c === 'tenant_id' && v === TENANT),
    'filtra por la subcuenta'
  )
  assert.ok(
    llamado.filtros.some(([c, v]) => c === 'users.pays_commissions' && v === false),
    'filtra por users.pays_commissions = false'
  )
  assert.deepEqual([...exentos].sort(), ['u-otro', 'u-socio'])
})

test('exentos de comisión: un fallo de lectura degrada a nadie exento sin lanzar', async () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    then: (ok) => Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok),
  }
  const exentos = await usuariosExentosDeComision({ from: () => builder }, TENANT)
  assert.equal(exentos.size, 0)
})
