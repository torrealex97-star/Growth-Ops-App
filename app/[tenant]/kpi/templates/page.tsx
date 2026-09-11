"use client"

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KPITemplateEditor } from '@/components/kpi/KPITemplateEditor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import type { KpiFormTemplate } from '@/lib/types/database'
import { useTenantId } from '@/lib/tenant-context'

export default function KPITemplatesPage() {
  const tenantId = useTenantId()
  const [setterTemplates, setSetterTemplates] = useState<KpiFormTemplate[]>([])
  const [closerTemplates, setCloserTemplates] = useState<KpiFormTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTemplates = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('kpi_form_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('sort_order')

    if (error) {
      toast.error('Error al cargar plantillas')
      return
    }

    const all = data ?? []
    setSetterTemplates(all.filter(t => t.role_key === 'setter'))
    setCloserTemplates(all.filter(t => t.role_key === 'closer'))
    setLoading(false)
  }, [tenantId])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Formularios KPI</h1>
        <p className="text-muted-foreground text-sm mt-1">Configura los campos de informe diario por rol</p>
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : (
        <Tabs defaultValue="setter">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="setter">Setter</TabsTrigger>
            <TabsTrigger value="closer">Closer</TabsTrigger>
          </TabsList>

          <TabsContent value="setter" className="mt-4">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Campos para Setters</h3>
              <KPITemplateEditor
                roleKey="setter"
                templates={setterTemplates}
                onUpdate={fetchTemplates}
              />
            </div>
          </TabsContent>

          <TabsContent value="closer" className="mt-4">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Campos para Closers</h3>
              <KPITemplateEditor
                roleKey="closer"
                templates={closerTemplates}
                onUpdate={fetchTemplates}
              />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
