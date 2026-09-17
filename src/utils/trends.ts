import type { DayMetrics } from '../../electron/types'

export type TrendVisibility = 'recorded' | 'all'

export function filterTrendMetrics(metrics: DayMetrics[], visibility: TrendVisibility): DayMetrics[] {
  if (visibility === 'all') return metrics
  return metrics.filter(metric => metric.entry_count > 0)
}

export function totalNegativeEvents(metrics: DayMetrics[]): number | null {
  if (!metrics.some(metric => metric.classified_event_count > 0)) return null
  return metrics.reduce((total, metric) => total + metric.negative_count, 0)
}
