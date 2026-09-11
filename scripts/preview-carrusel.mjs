import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const t = fs.readFileSync('.env.local', 'utf8')
const e = {}
t.split('\n').forEach((l) => {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
})
const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

function wrap(html) {
  const fams = new Set()
  const re = /font-family:\s*['"]?([^;'"}\n]+?)['"]?\s*[;}"]/g
  let m
  while ((m = re.exec(html)))
    for (const p of m[1].split(',')) {
      const n = p.trim().replace(/['"]/g, '')
      if (n && !['sans-serif', 'serif'].includes(n.toLowerCase())) fams.add(n)
    }
  const link = fams.size
    ? `<link href="https://fonts.googleapis.com/css2?${[...fams].map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800;900`).join('&')}&display=swap" rel="stylesheet">`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${link}<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1350px;overflow:hidden}</style></head><body>${html}</body></html>`
}

const id = process.argv[2]
const { data } = await sb.from('carrusel_projects').select('slides,title').eq('id', id).single()
console.log('Proyecto:', data.title, '-', data.slides.length, 'slides')
data.slides.forEach((s, i) => {
  fs.writeFileSync(`/tmp/slide_${i}.html`, wrap(s.html))
})
console.log('OK slides escritas:', data.slides.length)
