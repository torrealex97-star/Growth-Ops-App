import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluarLeadScore } from '../lib/metrics/cualificacion.ts'

test('puntúa alto cuando compromiso, ingresos e inversión son altos', () => {
  const result = evaluarLeadScore([
    { pregunta: 'En una escala del 1 al 10, ¿cuál es tu compromiso?', respuesta: '9' },
    { pregunta: '¿Cuánto estás generando al mes?', respuesta: 'Más de 3.000€' },
    { pregunta: '¿Estás dispuesta a invertir en ti?', respuesta: 'Sí, estoy dispuesta' },
  ])

  assert.equal(result.puntuacion, 90)
  assert.equal(result.nivel, 'alto')
  assert.equal(result.confianza, 'alta')
})

test('una negativa explícita y poca capacidad producen score bajo', () => {
  const result = evaluarLeadScore([
    { pregunta: 'Compromiso del 1 al 10', respuesta: '3' },
    { pregunta: 'Ingresos mensuales', respuesta: 'Menos de 600€' },
    { pregunta: '¿Puedes invertir?', respuesta: 'No puedo invertir ahora' },
  ])

  assert.equal(result.puntuacion, 12)
  assert.equal(result.nivel, 'bajo')
  assert.equal(result.confianza, 'alta')
})

test('no penaliza como cero una dimensión ausente y declara menor confianza', () => {
  const result = evaluarLeadScore([
    { pregunta: 'En una escala del 1 al 10, ¿cuál es tu compromiso?', respuesta: '8' },
    { pregunta: 'Ingresos mensuales', respuesta: 'Entre 1.000 y 2.000€' },
  ])

  assert.equal(result.puntuacion, 71)
  assert.equal(result.nivel, 'medio')
  assert.equal(result.confianza, 'media')
  assert.equal(result.dimensiones.find((d) => d.clave === 'inversion')?.puntuacion, null)
})

test('sin señales legibles devuelve sin datos en vez de inventar una puntuación', () => {
  const result = evaluarLeadScore([{ pregunta: '¿Cómo te llamas?', respuesta: 'Ana' }])

  assert.equal(result.puntuacion, null)
  assert.equal(result.nivel, 'sin_datos')
  assert.equal(result.confianza, 'baja')
})

test('la sílaba si dentro de una palabra no se interpreta como una intención positiva', () => {
  const result = evaluarLeadScore([{ pregunta: '¿Puedes invertir?', respuesta: 'Sin ahorros por ahora' }])

  assert.equal(result.puntuacion, null)
  assert.equal(result.nivel, 'sin_datos')
})
