export function localDateString(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** SQLite 的 datetime('now','localtime') 已是不带时区的本地串，只能按位取，不能 new Date 解析 */
export function sqlDatePart(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  return text.length >= 10 ? text.slice(0, 10) : ''
}

export function formatSqlDateTime(value: string | null | undefined): string {
  const date = sqlDatePart(value)
  if (!date) return ''
  const text = String(value ?? '').trim()
  if (text.length < 16) return date
  return `${date} ${text.slice(11, 16)}`
}
