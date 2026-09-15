import { Repo } from './db/repository'
import { AnalyzeEngine } from './analysis/engine'
import { LLMAdapter } from './adapters/llm'

export class Scheduler {
  constructor(private repo: Repo) {}

  /** 当日首次打开应用时生成今日日报；无当日 entries 返回 null（spec §11.1） */
  async ensureReportForToday(
    llm: LLMAdapter | null,
    opts: { desensitize?: boolean } = {}
  ): Promise<ReturnType<AnalyzeEngine['analyzeDay']>> {
    const today = new Date().toISOString().slice(0, 10)
    const existing = await this.repo.getReport('daily', today)
    if (existing) return existing
    if (!llm) return null
    const engine = new AnalyzeEngine(this.repo, llm, opts)
    try {
      return await engine.analyzeDay(today)
    } catch {
      // 网络失败等场景不阻塞启动
      return null
    }
  }
}
