import { pedir } from '@/lib/ui/pedir'
import type { PendingPayment } from '@/lib/sales/payment-inbox'

type Scope = { tenant: string; userId: string; role: string | null; isSuperAdmin: boolean }
type Inbox = { rows: PendingPayment[]; total: number }
const pending = new Map<string, Promise<Inbox>>()
const keyFor = (scope: Scope) => JSON.stringify([scope.tenant, scope.userId, scope.role, scope.isSuperAdmin])

/** Share only concurrent reads, never settled data or reads from another identity. */
export function loadPaymentInbox(scope: Scope): Promise<Inbox> {
  const key = keyFor(scope)
  const existing = pending.get(key)
  if (existing) return existing
  const request = pedir<Inbox>(`/api/${scope.tenant}/evergreen/sales/payment-inbox`, { cache: 'no-store' })
    .then((result) => {
      if (!result.ok) throw new Error(result.mensaje)
      return result.data
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
  pending.set(key, request)
  return request
}

/** A successful write must not reuse a read started before that write. */
export function invalidatePaymentInbox(scope: Scope): void {
  pending.delete(keyFor(scope))
}
