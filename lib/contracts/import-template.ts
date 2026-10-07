import { extraerTextoPdf } from '@/lib/ai/pdf'

export const MAX_CONTRACT_TEMPLATE_BYTES = 4 * 1024 * 1024
export const MAX_CONTRACT_TEMPLATE_CHARS = 120_000

const TEXT_TYPES = new Set(['text/plain', 'text/markdown'])
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown'])

export type ImportedContractTemplate = {
  body: string
  suggestedName: string
}

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function cleanName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function normalizeBody(value: string): string {
  return value.replace(/\0/g, '').replace(/\r\n?/g, '\n').trim()
}

export async function importContractTemplateFile(file: File): Promise<ImportedContractTemplate> {
  if (!file.size) throw new Error('El archivo está vacío.')
  if (file.size > MAX_CONTRACT_TEMPLATE_BYTES) throw new Error('El archivo supera el límite de 4 MB.')

  const ext = extension(file.name)
  const isPdf = file.type === 'application/pdf' || ext === 'pdf'
  const isText = TEXT_TYPES.has(file.type) || TEXT_EXTENSIONS.has(ext)
  if (!isPdf && !isText) throw new Error('Formato no admitido. Usa PDF, TXT o Markdown.')

  const bytes = Buffer.from(await file.arrayBuffer())
  if (isPdf && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('El archivo no es un PDF válido.')
  }
  const extracted = isPdf ? await extraerTextoPdf(bytes) : bytes.toString('utf8')
  const body = normalizeBody(extracted)

  if (!body) {
    throw new Error(
      isPdf
        ? 'El PDF no contiene texto seleccionable. Usa un PDF con texto o pega el contenido manualmente.'
        : 'El archivo no contiene texto.'
    )
  }
  if (body.length > MAX_CONTRACT_TEMPLATE_CHARS) {
    throw new Error('El contrato supera el límite de 120.000 caracteres.')
  }

  return { body, suggestedName: cleanName(file.name) || 'Contrato importado' }
}
