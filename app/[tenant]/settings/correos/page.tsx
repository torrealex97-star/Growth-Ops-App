'use client'

import { EmailTemplatesPanel } from '@/components/settings/EmailTemplatesPanel'

// Configuración › Correos: plantillas de los correos transaccionales de esta
// subcuenta (invitación, recovery, contratos, tareas, onboarding). El editor
// vive en EmailTemplatesPanel; esta página es solo el marco.
export default function EmailTemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Correos</h1>
        <p className="text-muted-foreground text-sm mt-1">Plantillas de los correos que envía la plataforma</p>
      </div>
      <EmailTemplatesPanel />
    </div>
  )
}
