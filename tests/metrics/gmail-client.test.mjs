import assert from 'node:assert/strict'
import test from 'node:test'
import { collectAttachments, defaultQuery, isInvoiceAttachment, parseFromEmail } from '../../lib/gmail/client.ts'

test('el remitente se extrae del formato con nombre', () => {
  assert.equal(parseFromEmail('Proveedor SL <facturacion@proveedor.com>'), 'facturacion@proveedor.com')
  assert.equal(parseFromEmail('  FACTURAS@Proveedor.COM  '), 'facturas@proveedor.com')
  for (const malo of [null, '', 'sin arroba', 'nombre <no-es-email>']) {
    assert.equal(parseFromEmail(malo), null, String(malo))
  }
})

test('solo se consideran facturas los PDF', () => {
  assert.equal(isInvoiceAttachment('application/pdf', 'f.pdf'), true)
  assert.equal(isInvoiceAttachment('application/pdf; charset=binary', 'f.pdf'), true)
  // Un MIME genérico se acepta SOLO si la extensión rescata el caso: el MIME manda.
  assert.equal(isInvoiceAttachment('application/octet-stream', 'factura.PDF'), true)
  assert.equal(isInvoiceAttachment('application/octet-stream', 'factura.exe'), false)
  for (const [mime, name] of [
    ['image/png', 'logo.png'],
    ['text/calendar', 'cita.ics'],
    ['application/zip', 'todo.zip'],
    ['', 'x.pdf'],
  ]) {
    assert.equal(isInvoiceAttachment(mime, name), false, `${mime} ${name}`)
  }
})

const msg = (parts, over = {}) => ({
  id: 'm1',
  internalDate: '1789000000000',
  payload: {
    headers: [
      { name: 'From', value: 'Proveedor <facturas@proveedor.com>' },
      { name: 'Subject', value: 'Factura de septiembre' },
    ],
    parts,
  },
  ...over,
})

test('se recogen los adjuntos con sus metadatos', () => {
  const [a] = collectAttachments(
    msg([{ filename: 'f.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att1', size: 2048 } }])
  )
  assert.equal(a.messageId, 'm1')
  assert.equal(a.attachmentId, 'att1')
  assert.equal(a.fileName, 'f.pdf')
  assert.equal(a.sizeBytes, 2048)
  assert.equal(a.fromEmail, 'facturas@proveedor.com')
  assert.equal(a.subject, 'Factura de septiembre')
  assert.match(a.receivedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('se recorren las partes anidadas', () => {
  const out = collectAttachments(
    msg([
      {
        mimeType: 'multipart/mixed',
        parts: [{ filename: 'hondo.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a2', size: 10 } }],
      },
    ])
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].fileName, 'hondo.pdf')
})

test('un adjunto que aparece dos veces al recorrer el árbol se devuelve una sola vez', () => {
  // payload y payload.parts se recorren ambos; sin deduplicar por attachmentId se intentaría
  // importar el mismo adjunto dos veces en la misma pasada.
  const m = msg([{ filename: 'f.pdf', mimeType: 'application/pdf', body: { attachmentId: 'dup', size: 5 } }])
  m.payload.filename = 'f.pdf'
  m.payload.mimeType = 'application/pdf'
  m.payload.body = { attachmentId: 'dup', size: 5 }
  const out = collectAttachments(m)
  assert.equal(out.length, 1)
})

test('se ignoran las partes sin nombre, sin id o de tamaño cero', () => {
  const out = collectAttachments(
    msg([
      { filename: '', mimeType: 'application/pdf', body: { attachmentId: 'a', size: 10 } },
      { filename: 'sin-id.pdf', mimeType: 'application/pdf', body: { size: 10 } },
      { filename: 'vacio.pdf', mimeType: 'application/pdf', body: { attachmentId: 'b', size: 0 } },
      { filename: 'malo.pdf', mimeType: 'application/pdf', body: { attachmentId: 'c', size: 'x' } },
    ])
  )
  assert.deepEqual(out, [])
})

test('un mensaje sin id no produce adjuntos', () => {
  assert.deepEqual(collectAttachments({ payload: { parts: [] } }), [])
  assert.deepEqual(collectAttachments({}), [])
})

test('una fecha ilegible deja receivedAt en null en vez de una fecha inventada', () => {
  const [a] = collectAttachments(
    msg([{ filename: 'f.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a', size: 1 } }], {
      internalDate: 'no-es-una-fecha',
    })
  )
  assert.equal(a.receivedAt, null)
})

test('la consulta acota el buzón y excluye lo enviado', () => {
  const q = defaultQuery(30)
  assert.match(q, /has:attachment/)
  assert.match(q, /-in:sent/)
  assert.match(q, /newer_than:30d/)
  // Los días se acotan: ni 0 ni valores absurdos.
  assert.match(defaultQuery(0), /newer_than:30d/)
  assert.match(defaultQuery(-5), /newer_than:1d/)
  assert.match(defaultQuery(99999), /newer_than:365d/)
})
