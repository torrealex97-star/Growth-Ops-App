export type EventProcessingStatus = 'received' | 'matched' | 'processed' | 'rejected' | 'pending'
export type MatchStatus = 'proposed' | 'confirmed' | 'rejected' | 'needs_review'
export type DeliveryStatus = 'pending' | 'sending' | 'accepted' | 'rejected' | 'retrying' | 'failed' | 'deduplicated'

export interface ConsentSnapshot {
  analytics?: boolean
  advertising?: boolean
  source?: string
  captured_at?: string
  purposes?: string[]
}

export interface CanonicalEventInput {
  event_id: string
  event_name: string
  occurred_at: string
  source: string
  schema_version?: string
  idempotency_key: string
  visitor_id?: string | null
  session_id?: string | null
  touchpoint_id?: string | null
  contact_id?: string | null
  appointment_id?: string | null
  sale_id?: string | null
  revenue?: number | null
  currency?: string | null
  consent_snapshot: ConsentSnapshot
  properties?: Record<string, unknown>
}

export interface DataHealthSummary {
  events: number
  matched: number
  pending: number
  rejected: number
  identityReview: number
  deliveryAttempts: number
  accepted: number
  failed: number
  lastReceivedAt: string | null
}
