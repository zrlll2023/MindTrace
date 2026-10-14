import { Repo } from './db/repository'
import { AnalyzeEngine } from './analysis/engine'
import { LLMAdapter } from './adapters/llm'
import { AiSkillInjection, EMPTY_SKILL_INJECTION } from './types'

export class Scheduler {
  constructor(private repo: Repo) {}

  /**
   * 当日首次打开应用时生成今日日报；无当日 entries 返回 null（spec §11.1）
   * skills 由调用方按「日报」区域构建：自动生成的日报与手动点击生成必须用同一套技能，
   * 否则用户会看到「配了技能但首份日报没生效」。
   */
  async ensureReportForToday(
    llm: LLMAdapter | null,
    opts: {
      desensitize?: boolean
      search?: import('./adapters/search').SearchAdapter | null
      semantic?: import('./analysis/semantic').SemanticSearch | null
      skills?: AiSkillInjection
    } = {}
  ): Promise<ReturnType<AnalyzeEngine['analyzeDay']>> {
    const today = new Date().toISOString().slice(0, 10)
    const existing = await this.repo.getReport('daily', today)
    if (existing) return existing
    if (!llm) return null
    const engine = new AnalyzeEngine(this.repo, llm, opts)
    try {
      return await engine.analyzeDay(today, opts.skills ?? EMPTY_SKILL_INJECTION)
    } catch {
      // 网络失败等场景不阻塞启动
      return null
    }
  }
}
