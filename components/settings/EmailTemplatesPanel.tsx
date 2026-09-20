'use client'

import { useCallback, useEffect, useState } from 'react'
import { Mail, Loader2, RotateCcw, Save, Eye, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { LABELS } from './email-labels'

// ── Editor de plantillas de correo (Configuración › Correos) ────────────────
// Lista los 8 correos transaccionales del sistema. Cada uno puede:
//  · Usar el DEFAULT del sistema (sin fila en email_templates).
//  · Tener override por subcuenta (asunto + cuerpo HTML con {{variables}}).
// La vista previa renderiza el HTML con variables de muestra; guardar expande las
// directivas {{boton:…}} del esqueleto a HTML puro (lo hace la API).

type TemplateRow = {
  key: string
  personalizada: boolean
  subject: string
  body_html: string
  skeleton: { subject: string; body: string }
  updated_at: string | null
}

const VARIABLES_DOC: Record<string, string> = {
  invite: '{{empresa}} {{nombre}} {{enlace}} {{firma}}',
  recovery: '{{empresa}} {{enlace}}',
  contract: '{{empresa}} {{nombre}} {{enlace}} {{firma}}',
  contract_signed: '{{empresa}} {{nombre}} {{enlace_pdf}} {{firma}}',
  student_contract: '{{empresa}} {{nombre}} {{enlace}} {{bienvenida}}',
  student_onboarding: '{{empresa}} {{nombre}} {{enlace}} {{firma}}',
  student_contract_signed: '{{empresa}} {{nombre}} {{enlace_pdf}} {{firma}}',
  task_assigned: '{{empresa}} {{nombre}} {{tarea}} {{descripcion}} {{meta}} {{enlace}}',
}

// ¿El cuerpo del usuario es la directiva de esqueleto sin expandir (o lo trae)?
// La vista previa en cliente también necesita expandir {{boton:…}} / {{enlace_fallback}}.
function expandDirectives(body: string): string {
  return body
    .replace(
      /\{\{boton:([^:}]+):([^}]+)\}\}/g,
      (_m, color: string, label: string) =>
        `<div style="text-align:center;margin:28px 0"><a href="{{enlace}}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600">${label}</a></div>`
    )
    .replace(
      /\{\{boton_pdf\}\}/g,
      () =>
        `<div style="text-align:center;margin:28px 0"><a href="{{enlace_pdf}}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-size:15px;font-weight:600">Descargar contrato firmado</a></div>`
    )
    .replace(
      /\{\{enlace_fallback\}\}/g,
      `<p style="font-size:12px;color:#71717a;line-height:1.6">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="color:#7c3aed;word-break:break-all">{{enlace}}</span></p>`
    )
}

// Sustituye {{var}} por valores de muestra para la vista previa.
function renderPreview(html: string, empresa: string): string {
  const samples: Record<string, string> = {
    empresa,
    nombre: 'Ana García',
    enlace: 'https://ejemplo.com/enlace',
    enlace_pdf: 'https://ejemplo.com/contrato-firmado.pdf',
    bienvenida: 'Bienvenida al programa',
    firma: `Un saludo,\nEl equipo de ${empresa}`,
    tarea: 'Llamada de seguimiento',
    descripcion: 'Contactar con el lead antes de las 18:00.',
    meta: 'Prioridad: Alta · Vence: 30/09',
  }
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => samples[name] ?? '')
}

export function EmailTemplatesPanel() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [empresa, setEmpresa] = useState('Tu Empresa')
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/settings/email-templates`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error cargando plantillas')
      setTemplates(json.templates)
      // Empresa para la vista previa: del perfil (primera plantilla ya la trae renderizada con defaults).
      const supabase = (await import('@/lib/supabase/client')).createClient()
      const { data } = await supabase
        .from('company_profile')
        .select('name')
        .eq('id', 1)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (data?.name) setEmpresa(data.name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error cargando plantillas')
      setTemplates([])
    }
  }, [tenant, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const selectTemplate = (t: TemplateRow) => {
    setSelected(t.key)
    // Si hay override, se edita el override; si no, se parte del ESQUELETO (con {{vars}})
    // para que la personalización empiece del esqueleto, no del HTML ya renderizado.
    if (t.personalizada) {
      setSubject(t.subject)
      setBody(t.body_html)
    } else {
      setSubject(t.skeleton.subject)
      setBody(t.skeleton.body)
    }
    setPreview(false)
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/settings/email-templates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: selected, subject, body_html: body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al guardar')
      toast.success('Plantilla guardada')
      await load()
      // Recargar la selección para reflejar el estado "personalizada".
      const t = templates?.find((x) => x.key === selected)
      if (t) selectTemplate({ ...t, personalizada: true, subject, body_html: body })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // Enviar prueba (§14): renderiza esta plantilla con datos ficticios y la envía
  // al email indicado. La API NO ejecuta ningún flujo de negocio y el envío se
  // marca is_test en el historial.
  const enviarPrueba = async () => {
    if (!selected || !testTo.trim()) return
    setSendingTest(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: selected, to: testTo.trim() }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Error al enviar la prueba')
      toast.success(`Prueba enviada a ${testTo.trim()}${json.usedGlobalFallback ? ' (credencial global)' : ''}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al enviar la prueba')
    } finally {
      setSendingTest(false)
    }
  }

  const restaurar = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/settings/email-templates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_key: selected, restaurar: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al restaurar')
      toast.success('Restaurada al default del sistema')
      await load()
      const t = templates?.find((x) => x.key === selected)
      if (t) selectTemplate({ ...t, personalizada: false })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al restaurar')
    } finally {
      setSaving(false)
    }
  }

  if (templates === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const sel = templates.find((t) => t.key === selected) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
          <Mail className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h3 className="font-medium text-foreground">Correos del sistema</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Personaliza asunto y cuerpo de cada correo. Usa variables como{' '}
            <code className="text-xs">{'{{nombre}}'}</code> o <code className="text-xs">{'{{enlace}}'}</code> — se
            rellenan al enviar. Sin personalizar, se usa el diseño del sistema.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Lista de plantillas */}
        <div className="bg-card border border-border rounded-lg divide-y divide-border">
          {templates.map((t) => (
            <button
              key={t.key}
              onClick={() => selectTemplate(t)}
              className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-muted/50 transition-colors ${
                selected === t.key ? 'bg-muted/60' : ''
              }`}
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground truncate">{LABELS[t.key] ?? t.key}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.personalizada ? 'Personalizada' : 'Diseño del sistema'}
                </span>
              </span>
              {t.personalizada && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-label="Personalizada" />
              )}
            </button>
          ))}
        </div>

        {/* Editor */}
        {sel && (
          <div className="bg-card border border-border rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-medium text-foreground">{LABELS[sel.key] ?? sel.key}</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPreview((p) => !p)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" /> {preview ? 'Editar' : 'Vista previa'}
                </button>
                {sel.personalizada && (
                  <button
                    onClick={restaurar}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Restaurar
                  </button>
                )}
                <button
                  onClick={save}
                  disabled={saving || !subject.trim() || !body.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-brand-600 hover:bg-brand-700 text-white transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar
                </button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Variables: <span className="font-mono">{VARIABLES_DOC[sel.key]}</span>
            </p>

            <div className="flex flex-wrap items-center gap-2 border-t border-border mt-3 pt-3">
              <input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="tu@email.com"
                type="email"
                className="bg-muted border border-border rounded-md px-3 py-1.5 text-xs text-foreground w-56"
              />
              <button
                onClick={enviarPrueba}
                disabled={sendingTest || !testTo.trim() || !subject.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 disabled:opacity-50"
              >
                {sendingTest ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{' '}
                Enviar prueba
              </button>
            </div>

            {preview ? (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 border-b border-border text-sm text-foreground">
                  <span className="text-muted-foreground text-xs block">Asunto</span>
                  {renderPreview(subject, empresa)}
                </div>
                <iframe
                  title="Vista previa del correo"
                  className="w-full bg-white"
                  style={{ height: 480, border: 0 }}
                  srcDoc={renderPreview(expandDirectives(body), empresa)}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Asunto</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Cuerpo (HTML con <code>{'{{variables}}'}</code>; el esqueleto usa {'{{boton:color:texto}}'} para el
                    botón)
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={16}
                    className="w-full bg-muted border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground"
                    spellCheck={false}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
