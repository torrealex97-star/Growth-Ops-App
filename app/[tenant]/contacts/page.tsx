"use client"

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ContactsTable } from '@/components/contacts/ContactsTable'
import { ContactForm, type ContactFormData } from '@/components/contacts/ContactForm'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { Contact } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'

export default function ContactsPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const fetchContacts = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Error al cargar contactos')
      return
    }
    setContacts(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    fetchContacts()
  }, [])

  const handleCreateContact = async (formData: ContactFormData) => {
    // Se crea vía endpoint service-role: la tabla contacts tiene RLS sin política de
    // INSERT, así que el insert directo desde el cliente falla para roles no-admin.
    const res = await fetch(`/api/${tenant}/evergreen/contacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    })
    const json = await res.json().catch(() => ({}))

    if (!res.ok) {
      toast.error('Error al crear el contacto', { description: json.error })
      return
    }

    toast.success('Contacto creado correctamente')
    setDialogOpen(false)
    fetchContacts()
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contactos</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestiona todos tus contactos y leads</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Nuevo Contacto
        </Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay contactos</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Crea tu primer contacto o espera a recibir leads por webhook
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <UserPlus className="w-4 h-4 mr-2" />
            Nuevo Contacto
          </Button>
        </div>
      ) : (
        <ContactsTable contacts={contacts} />
      )}

      {/* New Contact Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuevo Contacto</DialogTitle>
          </DialogHeader>
          <ContactForm
            onSubmit={handleCreateContact}
            onCancel={() => setDialogOpen(false)}
            submitLabel="Crear Contacto"
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
