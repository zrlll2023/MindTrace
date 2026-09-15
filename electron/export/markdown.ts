import fs from 'node:fs'
import path from 'node:path'
import { Report, ReportType } from '../db/repository'

const TYPE_NAMES: Record<ReportType, string> = {
  daily: '日报',
  weekly: '周报'
}

/** 导出报告为 Markdown 文件到 <dataDir>/exports/；同名覆盖 */
export async function exportMarkdown(
  report: Pick<Report, 'type' | 'period' | 'content_md' | 'meta'>,
  dataDir: string
): Promise<{ path: string }> {
  const dir = path.join(dataDir, 'exports')
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `${report.period}-${TYPE_NAMES[report.type]}.md`
  const filePath = path.join(dir, fileName)

  let header = `# ${TYPE_NAMES[report.type]} · ${report.period}\n\n`
  try {
    const meta = JSON.parse(report.meta) as Record<string, unknown>
    if (meta.entries_count != null) {
      header += `> 共 ${meta.entries_count} 条记录 · 生成于 ${String(meta.generated_at ?? '').slice(0, 19).replace('T', ' ')}\n\n`
    }
  } catch {
    // meta 解析失败不影响导出
  }
  header += '---\n\n'

  fs.writeFileSync(filePath, header + report.content_md + '\n', 'utf8')
  return { path: filePath }
}
