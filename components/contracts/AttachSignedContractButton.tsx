'use client'

import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

export function AttachSignedContractButton({
  tenant,
  contractId,
  onDone,
}: {
  tenant: string
  contractId: string
  onDone?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const attach = async (file: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.set('contractId', contractId)
      form.set('file', file)
      const response = await fetch(`/api/${tenant}/evergreen/contracts/attach`, { method: 'POST', body: form })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        toast.error(data.error ?? 'No se pudo adjuntar el contrato')
        return
      }
      toast.success('Contrato firmado adjuntado', {
        description: 'El acceso queda habilitado y el PDF queda guardado en la ficha.',
      })
      onDone?.()
    } catch {
      toast.error('No se pudo adjuntar el contrato')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void attach(file)
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-600/20 text-amber-300 border border-amber-600/30 hover:bg-amber-600/30 disabled:opacity-60"
        title="Adjuntar un contrato firmado fuera de la app"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        Adjuntar firmado
      </button>
    </>
  )
}
