'use client'

import { useState } from 'react'
import { EmailTemplatesPanel } from '@/components/settings/EmailTemplatesPanel'
import { EmailSettingsPanel, EmailHistoryPanel } from '@/components/settings/EmailSettingsPanel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// Configuración › Emails (§32 — responsabilidades separadas):
//   · Configuración → identidad de envío (from/reply-to) + estado del proveedor.
//   · Plantillas    → asunto/cuerpo de cada correo, variables, vista previa.
//   · Historial     → envíos con estado de entrega (webhook de Resend).
// Las credenciales de Resend NO viven aquí: están en Integraciones (única fuente).
export default function EmailPage() {
  const [tab, setTab] = useState('configuracion')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Emails</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Remitente, plantillas y historial de los correos que envía la plataforma
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="configuracion">Configuración</TabsTrigger>
          <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>
        <TabsContent value="configuracion" className="mt-4">
          <EmailSettingsPanel />
        </TabsContent>
        <TabsContent value="plantillas" className="mt-4">
          <EmailTemplatesPanel />
        </TabsContent>
        <TabsContent value="historial" className="mt-4">
          <EmailHistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
