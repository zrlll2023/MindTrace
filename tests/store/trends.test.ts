import { describe, expect, it } from 'vitest'
import type { DayMetrics } from '../../electron/types'
import { filterTrendMetrics, totalNegativeEvents } from '../../src/utils/trends'

function metric(date: string, entryCount: number): DayMetrics {
  return {
    date,
    sleep_hours: null,
    negative_count: 0,
    classified_event_count: 0,
    entry_count: entryCount,
    idea_count: 0,
    sleep_sessions: 0,
    longest_sleep_hours: null,
    sleep_data_mode: 'none'
  }
}

describe('生活趋势显示范围', () => {
  const metrics = [metric('2026-09-15', 0), metric('2026-09-16', 2)]

  it('默认只显示有记录日期', () => {
    expect(filterTrendMetrics(metrics, 'recorded').map(item => item.date)).toEqual(['2026-09-16'])
  })

  it('全部日期模式保留空日期', () => {
    expect(filterTrendMetrics(metrics, 'all')).toEqual(metrics)
  })

  it('未填写事件分类时不将缺失数据统计为零', () => {
    expect(totalNegativeEvents(metrics)).toBeNull()
    expect(totalNegativeEvents([{ ...metrics[1], classified_event_count: 1, negative_count: 0 }])).toBe(0)
  })
})
