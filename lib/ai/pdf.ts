// Extracción de TEXTO de un PDF, para leer facturas cuando no hay ningún motor con visión
// conectado (Anthropic la lee de forma nativa; los de texto puro no ven documentos).
//
// POR QUÉ UNA DEPENDENCIA. Sin capa de visión, un PDF solo puede analizarse extrayendo su texto.
// Ninguna utilidad del runtime Node lo hace; `unpdf` existe precisamente para funciones serverless
// (empaqueta pdf.js sin workers ni dependencias nativas). Si un día deja de hacer falta, se quita
// aquí y no hay más referencias repartidas por el código.

import { extractText, getDocumentProxy } from 'unpdf'

/** Devuelve el texto del PDF con las páginas concatenadas en orden. */
export async function extraerTextoPdf(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { text } = await extractText(pdf, { mergePages: true })
  return Array.isArray(text) ? text.join('\n\n') : text
}
