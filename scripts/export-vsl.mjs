import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
import path from "node:path"

const envTxt = fs.readFileSync(".env.local", "utf8"); const env = {}
envTxt.split("\n").forEach((l) => { const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim() })
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

function wrap(html) {
  const fams = new Set(); const re = /font-family:\s*['"]?([^;'"}\n]+?)['"]?\s*[;}"]/g; let m
  while ((m = re.exec(html))) for (const p of m[1].split(",")) { const n = p.trim().replace(/['"]/g, ""); if (n && !["sans-serif", "serif"].includes(n.toLowerCase())) fams.add(n) }
  const link = fams.size ? `<link href="https://fonts.googleapis.com/css2?${[...fams].map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800;900`).join("&")}&display=swap" rel="stylesheet">` : ""
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${link}<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1350px;overflow:hidden}</style></head><body>${html}</body></html>`
}

const DEST = path.join(process.env.HOME, "Desktop", "Carrusels IA", "VSL IA WINNERS - Export")
const TMP = "/tmp/vslexport"
fs.mkdirSync(DEST, { recursive: true })
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true })

const { data, error } = await sb.from("carrusel_projects").select("title,slides,caption,hashtags").like("title", "VSL %").order("title", { ascending: true })
if (error) throw new Error(error.message)

const manifest = []
for (const p of data) {
  const folder = p.title.replace("VSL ", "").replace(/·/g, "-").replace(/\s+/g, " ").trim()
  const dir = path.join(DEST, folder)
  fs.mkdirSync(dir, { recursive: true })
  const cap = (p.caption || "") + "\n\n" + (p.hashtags || []).map((h) => "#" + h).join(" ") + "\n"
  fs.writeFileSync(path.join(dir, "caption.txt"), cap)
  p.slides.forEach((s, i) => {
    const htmlPath = path.join(TMP, `${folder.replace(/[^\w]/g, "_")}_${i + 1}.html`)
    fs.writeFileSync(htmlPath, wrap(s.html))
    const pngPath = path.join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`)
    manifest.push(`${htmlPath}\t${pngPath}`)
  })
}
fs.writeFileSync(path.join(TMP, "manifest.txt"), manifest.join("\n"))
console.log("Proyectos:", data.length, "| Slides totales:", manifest.length)
console.log("DEST:", DEST)
