import { validateEntryMoment } from './analysis/validators'

export interface EntryMoment {
  /** YYYY-MM-DD */
  entryDate: string
  /** HH:mm；null 表示用户未标记具体时间 */
  entryTime: string | null
}

export type MomentInput = { entryDate?: string; entryTime?: string | null } | null | undefined

/**
 * 计算一条记录修正后的「发生于」时间。
 * 睡眠分段与当天累计仍由内容里的起止/日期推导，避免与两套输入互相打架；
 * 旧版仅有时长的睡眠没有可推导的来源，采用用户提交的值。
 */
export function resolveEntryMoment(
  existing: { kind: string; entry_date: string; entry_time: string | null },
  content: Record<string, unknown>,
  moment?: MomentInput
): { ok: true; moment: EntryMoment } | { ok: false; error: string } {
  if (existing.kind === 'sleep' && content.recordType === 'session') {
    const endAt = String(content.endAt ?? '')
    return { ok: true, moment: { entryDate: endAt.slice(0, 10), entryTime: endAt.slice(11, 16) || null } }
  }
  if (existing.kind === 'sleep' && content.recordType === 'daily_total') {
    return { ok: true, moment: { entryDate: String(content.date ?? existing.entry_date), entryTime: null } }
  }
  if (!moment?.entryDate) {
    return { ok: true, moment: { entryDate: existing.entry_date, entryTime: existing.entry_time } }
  }
  const entryTime = moment.entryTime || null
  const check = validateEntryMoment(moment.entryDate, entryTime)
  if (!check.ok) return { ok: false, error: check.reason ?? '发生时间无效' }
  return { ok: true, moment: { entryDate: moment.entryDate, entryTime } }
}
