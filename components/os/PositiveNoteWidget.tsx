'use client'

import { useEffect, useState, useCallback } from 'react'
import { Heart, Users } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'

type Note = { id: string; period_type: 'daily' | 'weekly'; content: string; is_shared: boolean } | null
type WallEntry = {
  id: string
  period_type: 'daily' | 'weekly'
  content: string
  created_at: string
  users?: { full_name?: string } | null
}

const TABS: { key: 'daily' | 'weekly'; label: string; placeholder: string }[] = [
  { key: 'daily', label: 'Hoy', placeholder: '¿Qué te llevas positivo de hoy?' },
  { key: 'weekly', label: 'Esta semana', placeholder: '¿Qué te llevas positivo de esta semana?' },
]

function timeAgo(iso: string): string {
  const diffH = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000))
  if (diffH < 1) return 'hace un momento'
  if (diffH < 24) return `hace ${diffH}h`
  return `hace ${Math.round(diffH / 24)}d`
}

// Nota "qué me llevo positivo" — privada por defecto, con opción de compartirla en el muro del
// equipo. Es journaling ligero para cerrar el día/semana con foco en lo bueno, no un reporte más.
export function PositiveNoteWidget() {
  const tenant = useTenant()
  const [tab, setTab] = useState<'daily' | 'weekly'>('daily')
  const [daily, setDaily] = useState<Note>(null)
  const [weekly, setWeekly] = useState<Note>(null)
  const [wall, setWall] = useState<WallEntry[]>([])
  const [content, setContent] = useState('')
  const [isShared, setIsShared] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [showWall, setShowWall] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/positive-notes`)
      if (!res.ok) {
        setLoading(false)
        return
      }
      const data = await res.json()
      setDaily(data.daily ?? null)
      setWeekly(data.weekly ?? null)
      setWall(data.wall ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const current = tab === 'daily' ? daily : weekly
    setContent(current?.content ?? '')
    setIsShared(current?.is_shared ?? false)
  }, [tab, daily, weekly])

  async function save() {
    if (!content.trim()) return
    setSaving(true)
    setSavedMsg('')
    try {
      const res = await fetch(`/api/${tenant}/evergreen/positive-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_type: tab, content, is_shared: isShared }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (tab === 'daily') setDaily(data.note)
      else setWeekly(data.note)
      setSavedMsg('Guardado ✓')
      setTimeout(() => setSavedMsg(''), 3000)
      if (isShared) load() // refresca el muro si acaba de entrar/salir de él
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="rounded-lg border border-border bg-card p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Heart className="w-4 h-4 text-rose-400" /> Qué me llevo positivo
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                tab === t.key ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={TABS.find((t) => t.key === tab)?.placeholder}
        rows={3}
        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-brand-500 transition-colors resize-none"
      />

      <div className="flex items-center justify-between mt-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={isShared}
            onChange={(e) => setIsShared(e.target.checked)}
            className="accent-brand-500"
          />
          Compartir con el equipo
        </label>
        <div className="flex items-center gap-2">
          {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
          <button
            onClick={save}
            disabled={saving || !content.trim()}
            className="text-xs font-medium bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>

      {wall.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border">
          <button
            onClick={() => setShowWall((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Users className="w-3.5 h-3.5" /> Muro del equipo ({wall.length}) {showWall ? '▲' : '▼'}
          </button>
          {showWall && (
            <div className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
              {wall.map((w) => (
                <div key={w.id} className="text-xs bg-muted/50 rounded-lg px-3 py-2">
                  <p className="text-foreground">{w.content}</p>
                  <p className="text-muted-foreground mt-1">
                    {w.users?.full_name ?? 'Alguien del equipo'} · {timeAgo(w.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
