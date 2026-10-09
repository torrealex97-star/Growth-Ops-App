export interface VslWatchInterval {
  start: number
  end: number
  rate: number
}

const MAX_VIDEO_SECONDS = 86_400

export function sanitizeWatchIntervals(input: unknown): VslWatchInterval[] {
  if (!Array.isArray(input)) return []

  return input
    .slice(0, 240)
    .map((value) => {
      const row = value as Partial<VslWatchInterval>
      const start = Number(row.start)
      const end = Number(row.end)
      const rate = Number(row.rate) || 1
      return { start, end, rate }
    })
    .filter(
      ({ start, end, rate }) =>
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        Number.isFinite(rate) &&
        start >= 0 &&
        end > start &&
        end <= MAX_VIDEO_SECONDS &&
        end - start <= 5 &&
        rate > 0 &&
        rate <= 4
    )
}

export function secondsFromIntervals(intervals: VslWatchInterval[]): number[] {
  const seconds = new Set<number>()
  for (const interval of intervals) {
    const first = Math.floor(interval.start)
    const last = Math.ceil(interval.end)
    for (let second = first; second < last; second += 1) seconds.add(second)
  }
  return Array.from(seconds).sort((a, b) => a - b)
}
