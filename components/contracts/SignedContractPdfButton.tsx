'use client'

import { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export function SignedContractPdfButton({
  tenant,
  contractId,
  label = 'PDF firmado',
}: {
  tenant: string
  contractId: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setBusy(true)
    try {
      const response = await fetch(
        `/api/${tenant}/evergreen/contracts/pdf-url?contractId=${encodeURIComponent(contractId)}`
      )
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.url) {
        toast.error(data.error ?? 'No se pudo abrir el PDF')
        return
      }
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('No se pudo abrir el PDF')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      className="inline-flex items-center gap-1 text-emerald-400 hover:underline disabled:opacity-60"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
      {busy ? 'Abriendo…' : label}
    </button>
  )
}
