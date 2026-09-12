'use client'

import * as htmlToImage from 'html-to-image'
import JSZip from 'jszip'
import { wrapSlideHtml, extractFontFamilies } from './slide-html'
import { DIMENSIONS } from './types'
import type { AspectRatio, Slide } from './types'

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'carrusel'
  )
}

async function fetchFontEmbedCSS(families: string[], tenant: string): Promise<string> {
  if (families.length === 0) return ''
  try {
    const res = await fetch(
      `/api/${tenant}/evergreen/carruseles/fonts?families=${encodeURIComponent(families.join(','))}`
    )
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

function waitForIframe(iframe: HTMLIFrameElement, srcDoc: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    iframe.onload = async () => {
      const doc = iframe.contentDocument
      try {
        if (doc?.fonts?.ready) await doc.fonts.ready
      } catch {
        /* ignore */
      }
      // pequeño respiro para imágenes/fuentes
      setTimeout(done, 250)
    }
    iframe.srcdoc = srcDoc
    // fallback por si onload no dispara
    setTimeout(done, 4000)
  })
}

/** Renderiza una slide a PNG (dataURL) usando un iframe oculto same-origin. */
async function renderSlideToPng(slide: Slide, aspectRatio: AspectRatio, fontEmbedCSS: string): Promise<string> {
  const { width, height } = DIMENSIONS[aspectRatio]
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.style.position = 'fixed'
  iframe.style.left = '-100000px'
  iframe.style.top = '0'
  iframe.style.width = `${width}px`
  iframe.style.height = `${height}px`
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  try {
    await waitForIframe(iframe, wrapSlideHtml(slide.html, aspectRatio))
    const body = iframe.contentDocument?.body
    if (!body) throw new Error('No se pudo renderizar la slide')
    const dataUrl = await htmlToImage.toPng(body, {
      width,
      height,
      pixelRatio: 1,
      cacheBust: true,
      fontEmbedCSS: fontEmbedCSS || undefined,
      backgroundColor: '#ffffff',
    })
    return dataUrl
  } finally {
    iframe.remove()
  }
}

function dataUrlToUint8(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || ''
  const bin = atob(base64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Exporta todas las slides. 1 slide → PNG directo; varias → ZIP.
 * onProgress(current,total) para feedback en UI.
 */
export async function exportProject(
  title: string,
  slides: Slide[],
  aspectRatio: AspectRatio,
  tenant: string,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  if (slides.length === 0) return
  const allHtml = slides.map((s) => s.html).join('\n')
  const families = extractFontFamilies(allHtml)
  const fontEmbedCSS = await fetchFontEmbedCSS(families, tenant)

  const base = slugify(title)
  const pngs: { name: string; data: Uint8Array; dataUrl: string }[] = []
  for (let i = 0; i < slides.length; i++) {
    const dataUrl = await renderSlideToPng(slides[i], aspectRatio, fontEmbedCSS)
    pngs.push({ name: `${base}-${String(i + 1).padStart(2, '0')}.png`, data: dataUrlToUint8(dataUrl), dataUrl })
    onProgress?.(i + 1, slides.length)
  }

  if (pngs.length === 1) {
    triggerDownload(new Blob([pngs[0].data as BlobPart], { type: 'image/png' }), pngs[0].name)
    return
  }

  const zip = new JSZip()
  for (const p of pngs) zip.file(p.name, p.data)
  const blob = await zip.generateAsync({ type: 'blob' })
  triggerDownload(blob, `${base}.zip`)
}
