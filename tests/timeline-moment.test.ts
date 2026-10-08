import { describe, it, expect } from 'vitest'
import { resolveEntryMoment } from '../electron/timeline-moment'

const existing = { kind: 'idea', entry_date: '2026-09-16', entry_time: '10:00' }

describe('时间线修正发生时间', () => {
  it('采用用户提交的日期与时间', () => {
    const r = resolveEntryMoment(existing, { text: 'x' }, { entryDate: '2026-09-20', entryTime: '08:30' })
    expect(r).toEqual({ ok: true, moment: { entryDate: '2026-09-20', entryTime: '08:30' } })
  })

  it('清空发生时间落库为 null，而不是回显旧值', () => {
    const r = resolveEntryMoment(existing, { text: 'x' }, { entryDate: '2026-09-20', entryTime: '' })
    expect(r).toEqual({ ok: true, moment: { entryDate: '2026-09-20', entryTime: null } })
  })

  it('未提交日期时保持原样', () => {
    expect(resolveEntryMoment(existing, { text: 'x' }, null)).toEqual({
      ok: true,
      moment: { entryDate: '2026-09-16', entryTime: '10:00' }
    })
  })

  it('拒绝不存在的日期与非法时间格式', () => {
    expect(resolveEntryMoment(existing, { text: 'x' }, { entryDate: '2026-02-30' }).ok).toBe(false)
    expect(resolveEntryMoment(existing, { text: 'x' }, { entryDate: '2026-09-20', entryTime: '24:00' }).ok).toBe(false)
  })

  it('睡眠分段与当天累计仍由内容推导，不接受两套输入', () => {
    expect(resolveEntryMoment(
      { kind: 'sleep', entry_date: '2026-09-16', entry_time: null },
      { recordType: 'session', startAt: '2026-09-16 23:00', endAt: '2026-09-17 06:00', hours: 7 },
      { entryDate: '2026-01-01', entryTime: '01:00' }
    )).toEqual({ ok: true, moment: { entryDate: '2026-09-17', entryTime: '06:00' } })

    expect(resolveEntryMoment(
      { kind: 'sleep', entry_date: '2026-09-16', entry_time: '07:00' },
      { recordType: 'daily_total', date: '2026-09-18', hours: 8 },
      null
    )).toEqual({ ok: true, moment: { entryDate: '2026-09-18', entryTime: null } })
  })

  it('旧版仅有时长的睡眠没有可推导来源，采用用户提交值', () => {
    const r = resolveEntryMoment(
      { kind: 'sleep', entry_date: '2026-09-16', entry_time: null },
      { hours: 6 },
      { entryDate: '2026-09-15', entryTime: '23:30' }
    )
    expect(r).toEqual({ ok: true, moment: { entryDate: '2026-09-15', entryTime: '23:30' } })
  })
})
