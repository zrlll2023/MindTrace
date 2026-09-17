export type SleepDisplay =
  | { mode: 'session'; hours: number; startAt: string; endAt: string }
  | { mode: 'daily_total'; hours: number; date: string }
  | { mode: 'legacy'; hours: number }

export function parseSleepContent(content: string | Record<string, unknown>): SleepDisplay | null {
  try {
    const value = typeof content === 'string' ? JSON.parse(content) as Record<string, unknown> : content
    if (typeof value.hours !== 'number' || !Number.isFinite(value.hours)) return null
    if (value.recordType === 'session' && typeof value.startAt === 'string' && typeof value.endAt === 'string') {
      return { mode: 'session', hours: value.hours, startAt: value.startAt, endAt: value.endAt }
    }
    if (value.recordType === 'daily_total' && typeof value.date === 'string') {
      return { mode: 'daily_total', hours: value.hours, date: value.date }
    }
    return { mode: 'legacy', hours: value.hours }
  } catch {
    return null
  }
}

export function shortDate(value: string): string {
  const [, month, day] = value.slice(0, 10).split('-').map(Number)
  return `${month}月${day}日`
}

export function sessionLabel(startAt: string, endAt: string): string {
  const startDate = startAt.slice(0, 10)
  const endDate = endAt.slice(0, 10)
  const start = `${shortDate(startAt)} ${startAt.slice(11, 16)}`
  const end = startDate === endDate ? endAt.slice(11, 16) : `${shortDate(endAt)} ${endAt.slice(11, 16)}`
  return `${start} 至 ${end}`
}

/** Repair the presentation of snapshots created by the old day parser without mutating stored raw_text. */
export function readableSleepSnapshot(rawText: string, entryDate: string, content: string): string {
  if (!rawText.includes('NaN')) return rawText
  const sleep = parseSleepContent(content)
  if (!sleep) return rawText
  const times = rawText.match(/(?:[01]\d|2[0-3]):[0-5]\d/g)
  if (times?.length && times.length >= 2) {
    const endAt = `${entryDate} ${times[1]}`
    const startDate = new Date(`${entryDate}T00:00:00`)
    if (times[0] > times[1]) startDate.setDate(startDate.getDate() - 1)
    const pad = (value: number) => String(value).padStart(2, '0')
    const startAt = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())} ${times[0]}`
    return `${sessionLabel(startAt, endAt)}，共 ${sleep.hours.toFixed(1)} 小时`
  }
  return `${shortDate(entryDate)} 睡眠 ${sleep.hours.toFixed(1)} 小时（具体时段未知）`
}
