/** Reading the tenant inbox does not grant permission to register a payment. */
export function canViewPaymentInbox(role: string | null | undefined, isSuperAdmin = false): boolean {
  return isSuperAdmin || ['admin', 'director', 'closer', 'setter'].includes(role ?? '')
}
