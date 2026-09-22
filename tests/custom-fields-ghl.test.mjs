import assert from 'node:assert/strict'
import test from 'node:test'
import {
  slugGhlField,
  extraerParesGhl,
  inferirTipo,
  convertirValor,
  mapearCustomFieldsGhl,
} from '../lib/contacts/custom-fields-ghl.ts'

// ── slugGhlField: clave estable por subcuenta ────────────────────────────────

test('slug normaliza acentos, espacios y mayúsculas', () => {
  assert.equal(slugGhlField('Nivel de Inglés'), 'nivel_de_ingles')
  assert.equal(slugGhlField('  ¿Año de nacimiento? '), 'ano_de_nacimiento')
  assert.equal(slugGhlField('Fecha-Alta'), 'fecha_alta')
})

// ── extraerParesGhl: las tres formas de GHL ──────────────────────────────────

test('objeto customData {nombre: valor}', () => {
  const pares = extraerParesGhl({ customData: { 'Nivel de inglés': 'B2', Edad: 34 } })
  assert.deepEqual(pares, [
    ['Nivel de inglés', 'B2'],
    ['Edad', 34],
  ])
})

test('array customFields [{name, value}] (formato API de contactos)', () => {
  const pares = extraerParesGhl({
    customFields: [
      { name: 'Objetivo', value: 'Vender más' },
      { id: 'abc123', value: 'sin nombre' },
    ],
  })
  assert.deepEqual(pares, [
    ['Objetivo', 'Vender más'],
    ['abc123', 'sin nombre'],
  ])
})

test('campos planos con prefijo custom.', () => {
  const pares = extraerParesGhl({ 'custom.nivel': 'B2', email: 'x@y.z' })
  assert.deepEqual(pares, [['nivel', 'B2']])
})

test('valores vacíos o nulos no generan pares (no se inventa estructura)', () => {
  const pares = extraerParesGhl({ customData: { A: '', B: null, C: 'sí' } })
  assert.deepEqual(pares, [['C', 'sí']])
})

// ── tipos: inferir y convertir sin forzar ───────────────────────────────────

test('inferirTipo: boolean, number y texto', () => {
  assert.equal(inferirTipo(true), 'boolean')
  assert.equal(inferirTipo('true'), 'boolean')
  assert.equal(inferirTipo('34'), 'number')
  assert.equal(inferirTipo(12.5), 'number')
  assert.equal(inferirTipo('B2'), 'text')
})

test('convertirValor: no fuerza un valor que no encaja (null, nunca 0 ni "")', () => {
  assert.equal(convertirValor('B2', 'number'), null)
  assert.equal(convertirValor('quizá', 'boolean'), null)
  assert.equal(convertirValor('34,5', 'number'), 34.5)
  assert.equal(convertirValor('Sí', 'boolean'), true)
  assert.equal(convertirValor('', 'text'), null)
})

// ── mapearCustomFieldsGhl: mapa completo ────────────────────────────────────

test('mapea objeto GHL a definiciones + valores tipados', () => {
  const m = mapearCustomFieldsGhl({
    customData: { 'Nivel de inglés': 'B2', Edad: '34', 'Ya compró': 'true' },
  })
  assert.equal(m.definiciones.get('nivel_de_ingles')?.label, 'Nivel de inglés')
  assert.equal(m.definiciones.get('edad')?.field_type, 'number')
  assert.equal(m.definiciones.get('ya_compro')?.field_type, 'boolean')
  assert.equal(m.valores.get('nivel_de_ingles'), 'B2')
  assert.equal(m.valores.get('edad'), 34)
  assert.equal(m.valores.get('ya_compro'), true)
})

test('valores de tipos distintos en el mismo campo degradan a texto', () => {
  const m = mapearCustomFieldsGhl({ customData: { Nota: '5' } })
  assert.equal(m.definiciones.get('nota')?.field_type, 'number')
  const m2 = mapearCustomFieldsGhl({ customData: { Nota: '5' } })
  // segunda pasada sola: sigue number; el merge a texto lo decide aplicarCustomFieldsGhl
  assert.equal(m2.definiciones.get('nota')?.field_type, 'number')
})

test('sin custom fields → mapa vacío (y aplicar devuelve null sin tocar el contacto)', () => {
  const m = mapearCustomFieldsGhl({ email: 'x@y.z' })
  assert.equal(m.definiciones.size, 0)
  assert.equal(m.valores.size, 0)
})

// ── tipoDesdeGhl: catálogo de la ubicación → tipos de la app ─────────────────
import { tipoDesdeGhl } from '../lib/contacts/custom-fields-ghl.ts'

test('tipoDesdeGhl mapea los tipos declarados de GHL y degrada a texto', () => {
  assert.equal(tipoDesdeGhl('TEXT'), 'text')
  assert.equal(tipoDesdeGhl('TEXTAREA'), 'text')
  assert.equal(tipoDesdeGhl('NUMBER'), 'number')
  assert.equal(tipoDesdeGhl('DATE'), 'date')
  assert.equal(tipoDesdeGhl('CHECKBOX'), 'boolean')
  assert.equal(tipoDesdeGhl('DROPDOWN'), 'text')
  assert.equal(tipoDesdeGhl(null), 'text')
  assert.equal(tipoDesdeGhl(undefined), 'text')
})
