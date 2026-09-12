'use client'

import { NAV_PAGES, DEPARTMENT_LABELS, type Department } from '@/lib/auth/permissions'

// Selector de visibilidad página-a-página, agrupado por departamento. `value` es la lista de hrefs
// permitidos; vacío = sin restricción (según el rol). Cada casilla activa/desactiva una página; la
// cabecera del departamento activa/desactiva todas las suyas.
export function PageAccessSelector({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const depts = Array.from(new Set(NAV_PAGES.map((p) => p.dept))) as Department[]
  const set = new Set(value)
  const toggle = (href: string) => {
    const next = new Set(set)
    next.has(href) ? next.delete(href) : next.add(href)
    onChange(Array.from(next))
  }
  const toggleDept = (dept: Department, on: boolean) => {
    const next = new Set(set)
    NAV_PAGES.filter((p) => p.dept === dept).forEach((p) => (on ? next.add(p.href) : next.delete(p.href)))
    onChange(Array.from(next))
  }

  return (
    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
      {depts.map((dept) => {
        const pages = NAV_PAGES.filter((p) => p.dept === dept)
        const allOn = pages.every((p) => set.has(p.href))
        return (
          <div key={dept} className="rounded-md border border-border bg-muted/30 p-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-foreground uppercase tracking-wide px-1 pb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={allOn}
                onChange={(e) => toggleDept(dept, e.target.checked)}
                className="accent-brand-500"
              />
              {DEPARTMENT_LABELS[dept]}
            </label>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              {pages.map((p) => (
                <label
                  key={p.href}
                  className="flex items-center gap-2 text-sm text-foreground rounded px-2 py-1 cursor-pointer hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={set.has(p.href)}
                    onChange={() => toggle(p.href)}
                    className="accent-emerald-500"
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
