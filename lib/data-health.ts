export function normalizeIdentity(value: string | null | undefined): string | null {
  const normalized =
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}@+.]/gu, '') ?? ''
  return normalized || null
}

export function countDuplicateValues(values: Array<string | null | undefined>): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const value of values) {
    const normalized = normalizeIdentity(value)
    if (!normalized) continue
    if (seen.has(normalized)) duplicates += 1
    else seen.add(normalized)
  }
  return duplicates
}

export function countDuplicateKeys(values: Array<string | null | undefined>): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const value of values) {
    if (!value) continue
    if (seen.has(value)) duplicates += 1
    else seen.add(value)
  }
  return duplicates
}

export type SourceHealthStatus = 'connected' | 'needs_attention' | 'not_configured'

export function deriveSourceStatus(configured: boolean, records: number): SourceHealthStatus {
  if (!configured) return 'not_configured'
  return records > 0 ? 'connected' : 'needs_attention'
}
