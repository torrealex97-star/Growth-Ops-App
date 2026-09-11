'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Shield, Upload, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'

type VerificationStatus = 'pending' | 'verified' | 'rejected'

interface DocumentVerification {
  id: string
  status: VerificationStatus
  document_url: string | null
  verified_at: string | null
  rejection_reason: string | null
  country_code: string | null
  document_type: string | null
}

type DocumentType = 'dni' | 'pasaporte' | 'nie' | 'otro'

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  dni: 'DNI',
  pasaporte: 'Pasaporte',
  nie: 'NIE',
  otro: 'Otro',
}

interface SaleDocumentState {
  documents_verified: boolean
  documents_verified_at: string | null
  documents_verified_by?: { full_name?: string } | null
  documents_verified_override: boolean
  documents_override_reason: string | null
  documents_override_by?: { full_name?: string } | null
  documents_override_at: string | null
  student_document_type: DocumentType | null
  student_document_number: string | null
}

export function DocumentVerificationSection({
  saleId,
  contactCountry,
  contactEmail,
  userRole
}: {
  saleId: string
  contactCountry?: string | null
  contactEmail?: string | null
  userRole?: string | null
}) {
  const tenant = useTenant()
  const [docs, setDocs] = useState<SaleDocumentState | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [documentType, setDocumentType] = useState<DocumentType | ''>('')
  const [documentNumber, setDocumentNumber] = useState('')

  useEffect(() => {
    loadDocumentState()
  }, [saleId])

  const loadDocumentState = async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/documents/state?saleId=${saleId}`)
      const data = await res.json()
      if (res.ok) setDocs(data)
    } finally {
      setLoading(false)
    }
  }

  const submitDocument = async () => {
    if (!documentType) {
      toast.error('Elige el tipo de documento')
      return
    }
    if (documentType !== 'otro' && !documentNumber.trim()) {
      toast.error('Escribe el número de documento')
      return
    }

    setApplying(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/documents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId, documentType, documentNumber }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'No se pudo verificar el documento')
        return
      }

      toast.success('Documento verificado. Ya se puede enviar el contrato.')
      setDocumentType('')
      setDocumentNumber('')
      loadDocumentState()
    } finally {
      setApplying(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-4 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3"></div>
      </div>
    )
  }

  if (!docs) return null

  const isVerified = docs.documents_verified || docs.documents_verified_override
  const isOverridden = docs.documents_verified_override

  return (
    <div className="space-y-4">
      {/* Estado General */}
      <div className={`rounded-lg border p-4 ${
        isVerified
          ? 'border-emerald-500/30 bg-emerald-500/10'
          : 'border-amber-500/30 bg-amber-500/10'
      }`}>
        <div className="flex items-start gap-3">
          {isVerified ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold text-sm ${
              isVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              {isVerified ? 'Verificación de documento completada' : 'Falta verificar el documento'}
            </h3>

            {isVerified && (
              <div className="mt-2 text-sm text-foreground space-y-1">
                {docs.student_document_type && (
                  <p>Documento: {DOCUMENT_TYPE_LABELS[docs.student_document_type]}{docs.student_document_number ? ` — ${docs.student_document_number}` : ''}</p>
                )}
                {docs.documents_verified && (
                  <p>✓ Verificado el {formatDateTime(docs.documents_verified_at)}</p>
                )}
                {docs.documents_verified_override && (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <Zap className="h-4 w-4" />
                    <span>Excepción aplicada — motivo: {docs.documents_override_reason}</span>
                  </div>
                )}
              </div>
            )}

            {!isVerified && (
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                Esta venta se cerró sin verificar el documento de identidad del cliente. Indica el tipo y número de documento antes de enviar el contrato.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Acción: registrar tipo + número de documento (sin foto) */}
      {!isVerified && (userRole === 'admin' || userRole === 'director' || userRole === 'closer') && (
        <div className="rounded-lg border border-amber-200/50 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-3">
              <div>
                <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-200">Verificar documento de identidad</h4>
                <p className="text-sm text-amber-700 dark:text-amber-300/80 mt-1">
                  Elige el tipo de documento y escribe el número. DNI y NIE se comprueban al momento; si el cliente no tiene ninguno de estos, elige &quot;Otro&quot; y se verifica sin más trámite.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                  className="px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Tipo de documento…</option>
                  <option value="dni">DNI</option>
                  <option value="pasaporte">Pasaporte</option>
                  <option value="nie">NIE</option>
                  <option value="otro">Otro</option>
                </select>
                {documentType !== 'otro' && (
                  <input
                    type="text"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    placeholder="Número de documento"
                    className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                )}
              </div>
              <button
                onClick={submitDocument}
                disabled={applying || !documentType}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {applying ? 'Verificando…' : 'Verificar documento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
