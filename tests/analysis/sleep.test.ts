import { describe, expect, it } from 'vitest'
import { summarizeSleepDay, sleepContext } from '../../electron/analysis/sleep'
import type { Entry } from '../../electron/db/repository'
import { parseSleepContent, readableSleepSnapshot, sessionLabel, shortDate } from '../../src/utils/sleep'

function sleepEntry(id: number, content: Record<string, unknown>): Entry {
  return {
    id,
    raw_text: 'snapshot',
    kind: 'sleep',
    content: JSON.stringify(content),
    confidence: 1,
    source: 'manual',
    entry_date: '2026-09-17',
    entry_time: null,
    created_at: '2026-09-17 08:00:00'
  }
}

describe('sleep summaries', () => {
  it('sums sessions while preserving continuity details', () => {
    const entries = [
      sleepEntry(1, { recordType: 'session', startAt: '2026-09-16 23:00', endAt: '2026-09-17 06:00', hours: 7 }),
      sleepEntry(2, { recordType: 'session', startAt: '2026-09-17 13:30', endAt: '2026-09-17 14:30', hours: 1 })
    ]
    expect(summarizeSleepDay(entries)).toMatchObject({
      totalHours: 8,
      sessionCount: 2,
      longestHours: 7,
      dataMode: 'sessions'
    })
    expect(sleepContext('2026-09-17', entries)).toContain('记录方式：分段记录')
  })

  it('does not present a daily total as continuous sleep', () => {
    const entries = [sleepEntry(1, { recordType: 'daily_total', date: '2026-09-17', hours: 8 })]
    expect(summarizeSleepDay(entries)).toMatchObject({ totalHours: 8, sessionCount: 0, longestHours: null, dataMode: 'daily_total' })
    expect(sleepContext('2026-09-17', entries)).toContain('不要推断为连续睡眠')
  })

  it('formats local dates without leaking the time into the day number', () => {
    expect(shortDate('2026-09-15 23:00')).toBe('9月15日')
    expect(sessionLabel('2026-09-15 23:00', '2026-09-16 07:00')).toBe('9月15日 23:00 至 9月16日 07:00')
    expect(parseSleepContent({ hours: 8 })).toEqual({ mode: 'legacy', hours: 8 })
    expect(readableSleepSnapshot(
      '9月NaN日 23:00 至 9月NaN日 07:00，共 8.0 小时',
      '2026-09-16',
      JSON.stringify({ hours: 8 })
    )).toBe('9月15日 23:00 至 9月16日 07:00，共 8.0 小时')
  })
})
