import { describe, expect, it } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { clearResearchDraft, getResearchDraft, researchWeekKey, saveResearchDraft } from '../../electron/store/research-draft'

describe('实验室研究计划草稿', () => {
  it('按自然周保存、恢复并清空完整草稿', async () => {
    const db = await initDb(':memory:')
    const repo = new Repo(db, ':memory:')
    const weekKey = '2026-W38'
    const saved = await saveResearchDraft(repo, {
      weekKey,
      requirement: '弄清睡眠与写作产出的关系',
      queries: ['TypeScript Electron 日志'],
      note: '本周关注桌面应用可靠性',
      finding: '待整理的研究收获',
      findingFrom: 'https://example.com',
      generatedAt: '2026-09-17T08:00:00.000Z'
    })

    expect(saved.updatedAt).toBeTruthy()
    expect(await getResearchDraft(repo, weekKey)).toMatchObject({
      requirement: '弄清睡眠与写作产出的关系',
      queries: ['TypeScript Electron 日志'],
      finding: '待整理的研究收获',
      findingFrom: 'https://example.com'
    })

    await clearResearchDraft(repo, weekKey)
    expect(await getResearchDraft(repo, weekKey)).toBeNull()
  })

  it('研究需求随草稿持久化，超长时截断到 2000 字，缺失时回退为空串', async () => {
    const db = await initDb(':memory:')
    const repo = new Repo(db, ':memory:')
    const weekKey = '2026-W39'

    const saved = await saveResearchDraft(repo, { weekKey, requirement: '需求'.repeat(1050) })
    expect(saved.requirement).toHaveLength(2000)
    expect(saved.queries).toEqual([])
    expect((await getResearchDraft(repo, weekKey))?.requirement).toHaveLength(2000)

    // 旧版本草稿没有 requirement 字段，读取侧必须容错成空串而不是 undefined
    await repo.setSetting('labs.research-plan.2026-W40', JSON.stringify({ queries: ['旧计划'] }))
    const legacy = await getResearchDraft(repo, '2026-W40')
    expect(legacy?.requirement).toBe('')
    expect(legacy?.queries).toEqual(['旧计划'])
  })

  it('隔离不同周并忽略损坏草稿', async () => {
    const db = await initDb(':memory:')
    const repo = new Repo(db, ':memory:')
    await repo.setSetting('labs.research-plan.2026-W37', '{broken')

    expect(await getResearchDraft(repo, '2026-W37')).toBeNull()
    expect(await getResearchDraft(repo, '2026-W38')).toBeNull()
    expect(researchWeekKey(new Date(2026, 8, 17))).toBe('2026-W38')
  })
})
