import type { Entry } from '../db/repository'

export interface SleepDaySummary {
  totalHours: number | null
  sessionCount: number
  longestHours: number | null
  dataMode: 'sessions' | 'daily_total' | 'duration_only' | 'none'
  sessions: { startAt: string; endAt: string; hours: number }[]
}

export function summarizeSleepDay(entries: Entry[]): SleepDaySummary {
  const sleep = entries.flatMap(entry => {
    if (entry.kind !== 'sleep') return []
    try { return [JSON.parse(entry.content) as Record<string, unknown>] } catch { return [] }
  })
  const dailyTotal = sleep.find(content => content.recordType === 'daily_total' && typeof content.hours === 'number')
  const sessions = sleep.flatMap(content =>
    content.recordType === 'session' && typeof content.startAt === 'string' && typeof content.endAt === 'string' && typeof content.hours === 'number'
      ? [{ startAt: content.startAt, endAt: content.endAt, hours: content.hours }]
      : []
  )
  const durationOnly = sleep.filter(content => content.recordType == null && typeof content.hours === 'number')
  if (dailyTotal) {
    return { totalHours: dailyTotal.hours as number, sessionCount: 0, longestHours: null, dataMode: 'daily_total', sessions: [] }
  }
  if (sessions.length) {
    const total = sessions.reduce((sum, session) => sum + session.hours, 0)
    return {
      totalHours: Math.round(total * 10) / 10,
      sessionCount: sessions.length,
      longestHours: Math.max(...sessions.map(session => session.hours)),
      dataMode: 'sessions',
      sessions
    }
  }
  if (durationOnly.length) {
    const total = durationOnly.reduce((sum, content) => sum + (content.hours as number), 0)
    return { totalHours: Math.round(total * 10) / 10, sessionCount: 0, longestHours: null, dataMode: 'duration_only', sessions: [] }
  }
  return { totalHours: null, sessionCount: 0, longestHours: null, dataMode: 'none', sessions: [] }
}

export function sleepContext(date: string, entries: Entry[]): string | null {
  const summary = summarizeSleepDay(entries)
  if (summary.totalHours == null) return null
  if (summary.dataMode === 'sessions') {
    const lines = summary.sessions.map(session => `- ${session.startAt} 至 ${session.endAt}：${session.hours} 小时`)
    return `${date} 睡眠总计：${summary.totalHours} 小时\n记录方式：分段记录\n${lines.join('\n')}\n睡眠段数：${summary.sessionCount}\n最长连续睡眠：${summary.longestHours} 小时`
  }
  return `${date} 睡眠总计：${summary.totalHours} 小时\n记录方式：${summary.dataMode === 'daily_total' ? '当天累计值' : '仅有时长的旧记录'}\n具体睡眠分段：未知。不要推断为连续睡眠。`
}
