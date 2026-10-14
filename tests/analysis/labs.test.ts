import { describe, expect, it } from 'vitest'
import { planResearch } from '../../electron/analysis/labs'

type Message = { role: 'system' | 'user'; content: string }

/** 假 LLM：既当模型又记录真实发出的提示词，便于断言需求是否被带进去 */
function stubLlm(reply: string, seen: Message[][]) {
  return {
    chat: async (messages: Message[]): Promise<string> => {
      seen.push(messages)
      return reply
    }
  }
}

describe('引导式周度研究：按用户需求出题', () => {
  it('研究需求进入提示词，并明确要求 AI 不得替换成自己推测的主题', async () => {
    const seen: Message[][] = []
    const plan = await planResearch(
      stubLlm('{"queries":["睡眠不足 写作产出 研究","睡眠限制 认知表现 证据"],"note":"围绕你的问题找证据"}', seen),
      ['写作线'],
      ['想验证睡眠与产出'],
      '弄清睡眠不足是否真的拖慢我的写作产出'
    )

    expect(plan).toEqual({
      queries: ['睡眠不足 写作产出 研究', '睡眠限制 认知表现 证据'],
      note: '围绕你的问题找证据'
    })
    const [system, user] = seen[0]
    expect(system.role).toBe('system')
    expect(system.content).toContain('必须严格按它出题')
    expect(system.content).toContain('需求没提到的方向一律不要出现')
    expect(user.content).toContain('研究需求：弄清睡眠不足是否真的拖慢我的写作产出')
    expect(user.content).toContain('兴趣线')
    expect(user.content).toContain('写作线')
    expect(user.content).toContain('想验证睡眠与产出')
  })

  it('需求为空时标注未填写，并保留按兴趣线推断的说明要求', async () => {
    const seen: Message[][] = []
    await planResearch(stubLlm('{"queries":["a","b","c"],"note":"推断"}', seen), ['兴趣线'], [], '   ')

    expect(seen[0][1].content).toContain('研究需求：（用户未填写）')
    expect(seen[0][0].content).toContain('在 note 中说明这是推断')
  })

  it('超长需求截断到 2000 字，避免提示词被撑爆', async () => {
    const seen: Message[][] = []
    await planResearch(stubLlm('{"queries":["a"],"note":""}', seen), [], [], '需求'.repeat(1050))

    expect(seen[0][1].content).toContain('需求'.repeat(1000))
    expect(seen[0][1].content).not.toContain('需求'.repeat(1001))
  })

  it('最多保留 5 个搜索词，并丢弃非字符串项', async () => {
    const seen: Message[][] = []
    const reply = JSON.stringify({ queries: ['1', '2', '3', '4', '5', '6', 7, null], note: 'n' })
    const plan = await planResearch(stubLlm(reply, seen), [], [], '')

    expect(plan.queries).toEqual(['1', '2', '3', '4', '5'])
    expect(plan.queries.every(q => typeof q === 'string')).toBe(true)
  })

  it('模型没给 JSON 时返回可读说明而不是抛错', async () => {
    const plan = await planResearch(stubLlm('抱歉，我无法完成', []), [], [], '需求')
    expect(plan.queries).toEqual([])
    expect(plan.note).toBe('（研究计划生成失败，请稍后重试）')
  })
})
