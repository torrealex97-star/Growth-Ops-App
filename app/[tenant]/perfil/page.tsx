"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, User as UserIcon, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

export default function PerfilPage() {
  const [email, setEmail] = useState<string>('')
  const [fullName, setFullName] = useState<string>('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setEmail(data.user.email ?? '')
      const { data: row } = await sb.from('users').select('full_name').eq('id', data.user.id).single()
      setFullName((row as { full_name?: string } | null)?.full_name ?? '')
    })
  }, [])

  const changePassword = async () => {
    if (!current || !next || !confirm) {
      toast.error('Rellena todos los campos')
      return
    }
    if (next.length < 8) {
      toast.error('La nueva contraseña debe tener al menos 8 caracteres')
      return
    }
    if (next !== confirm) {
      toast.error('La nueva contraseña y su confirmación no coinciden')
      return
    }
    setSaving(true)
    const sb = createClient()
    try {
      // 1) Verifica la contraseña ACTUAL reautenticando (no cambia la sesión si acierta).
      const { error: signErr } = await sb.auth.signInWithPassword({ email, password: current })
      if (signErr) {
        toast.error('La contraseña actual no es correcta')
        return
      }
      // 2) Establece la nueva contraseña.
      const { error: updErr } = await sb.auth.updateUser({ password: next })
      if (updErr) throw updErr
      toast.success('Contraseña actualizada')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) {
      toast.error('No se pudo cambiar la contraseña', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <UserIcon className="w-5 h-5 text-brand-400" /> Mi perfil
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Tus datos de cuenta y seguridad.</p>
      </div>

      <div className="rounded-xl border border-border bg-card/50 p-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-muted-foreground">Nombre</Label>
            <Input value={fullName} disabled className="bg-background border-border text-foreground" />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground">Email</Label>
            <Input value={email} disabled className="bg-background border-border text-foreground" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/50 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-brand-400" /> Cambiar contraseña
        </h2>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cur" className="text-muted-foreground">Contraseña actual</Label>
            <Input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="bg-background border-border text-foreground" autoComplete="current-password" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new" className="text-muted-foreground">Nueva contraseña</Label>
            <Input id="new" type="password" value={next} onChange={(e) => setNext(e.target.value)} className="bg-background border-border text-foreground" autoComplete="new-password" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="conf" className="text-muted-foreground">Repite la nueva contraseña</Label>
            <Input id="conf" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="bg-background border-border text-foreground" autoComplete="new-password" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={changePassword} disabled={saving} className="bg-brand-600 hover:bg-brand-500 text-white">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</> : 'Cambiar contraseña'}
          </Button>
        </div>
      </div>
    </div>
  )
}
