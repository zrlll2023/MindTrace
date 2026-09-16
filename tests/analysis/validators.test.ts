import { describe, it, expect } from 'vitest'
import {
  validateParsedEntry,
  validateReportPayload,
  validateEntryMoment,
  sanitizeText,
  KIND_VALUES
} from '../../electron/analysis/validators'

describe('sanitizeText', () => {
  it('剥离 HTML/Markdown 标签', () => {
    expect(sanitizeText('<script>alert(1)</script>好句子')).toBe('alert(1)好句子')
    expect(sanitizeText('**粗体**和*斜体*')).toBe('粗体和斜体')
    expect(sanitizeText('[链接](http://x.com)')).toBe('链接(http://x.com)')
  })

  it('超长截断到 2000 字', () => {
    expect(sanitizeText('a'.repeat(3000)).length).toBe(2000)
  })

  it('非字符串返回空串', () => {
    expect(sanitizeText(null as never)).toBe('')
    expect(sanitizeText(123 as never)).toBe('')
  })
})

describe('validateParsedEntry', () => {
  it('合法条目原样通过', () => {
    const e = { kind: 'sleep', content: { hours: 6.5 }, confidence: 0.9 }
    const r = validateParsedEntry(e)
    expect(r.ok).toBe(true)
    expect(r.entry!.content.hours).toBe(6.5)
  })

  it('kind 白名单外拒绝', () => {
    expect(validateParsedEntry({ kind: 'alien', content: {}, confidence: 1 }).ok).toBe(false)
    expect(KIND_VALUES).toHaveLength(6)
  })

  it('content 非对象拒绝', () => {
    expect(validateParsedEntry({ kind: 'idea', content: '字符串', confidence: 1 }).ok).toBe(false)
    expect(validateParsedEntry({ kind: 'idea', content: null, confidence: 1 }).ok).toBe(false)
  })

  it('sleep.hours 越界拒绝', () => {
    expect(validateParsedEntry({ kind: 'sleep', content: { hours: 30 }, confidence: 1 }).ok).toBe(false)
    expect(validateParsedEntry({ kind: 'sleep', content: { hours: -1 }, confidence: 1 }).ok).toBe(false)
    expect(validateParsedEntry({ kind: 'sleep', content: { hours: '很多' }, confidence: 1 }).ok).toBe(false)
  })

  it('未知键丢弃并记录 _dropped；_ 开头键拒绝', () => {
    const r = validateParsedEntry({ kind: 'idea', content: { text: 'x', hacker: 1, _meta: 'no' }, confidence: 1 })
    expect(r.ok).toBe(true)
    expect(r.entry!.content.hacker).toBeUndefined()
    expect(r.entry!.content._dropped).toContain('hacker')
    // _meta 被 _ 前缀规则拦截 → 进 _dropped
    expect(r.entry!.content._dropped).toContain('_meta')
  })

  it('文本字段剥离标签并截断', () => {
    const r = validateParsedEntry({ kind: 'quote', content: { text: '<b>纸上</b>得来' + 'x'.repeat(2500) }, confidence: 1 })
    expect(r.ok).toBe(true)
    const text = (r.entry!.content as { text: string }).text
    expect(text).not.toContain('<b>')
    expect(text.length).toBeLessThanOrEqual(2000)
  })

  it('confidence 越界收敛到 [0,1]', () => {
    const hi = validateParsedEntry({ kind: 'idea', content: { text: 'x' }, confidence: 5 })
    expect(hi.entry!.confidence).toBe(1)
    const lo = validateParsedEntry({ kind: 'idea', content: { text: 'x' }, confidence: -2 })
    expect(lo.entry!.confidence).toBe(0)
  })

  it('文本型缺 text 时拒绝（other 兜底交给上层）', () => {
    expect(validateParsedEntry({ kind: 'idea', content: {}, confidence: 1 }).ok).toBe(false)
  })
})

describe('validateEntryMoment', () => {
  it('接受真实日期和可选分钟时间', () => {
    expect(validateEntryMoment('2026-09-16', '08:05').ok).toBe(true)
    expect(validateEntryMoment('2024-02-29', undefined).ok).toBe(true)
  })

  it('拒绝自动进位日期和非法时间', () => {
    expect(validateEntryMoment('2026-02-30', '').ok).toBe(false)
    expect(validateEntryMoment('2026-09-16', '24:00').ok).toBe(false)
    expect(validateEntryMoment('2026-09-16', '9:30').ok).toBe(false)
  })
})

describe('validateReportPayload', () => {
  it('合法载荷通过', () => {
    const p = {
      report_md: '## 今天概况\n- 睡眠 6.5 小时',
      threads: [{ title: 'RAG 学习线', description: 'd', status: 'active', linked_entry_ids: [1, 2] }]
    }
    const r = validateReportPayload(p)
    expect(r.ok).toBe(true)
    expect(r.payload!.threads).toHaveLength(1)
  })

  it('report_md 非字符串/空/超长拒绝', () => {
    expect(validateReportPayload({ report_md: 123 }).ok).toBe(false)
    expect(validateReportPayload({ report_md: '' }).ok).toBe(false)
    expect(validateReportPayload({ report_md: 'x'.repeat(60000) }).ok).toBe(false)
  })

  it('threads 非数组降级为空数组（宽松）', () => {
    const r = validateReportPayload({ report_md: '# ok', threads: 'not-array' })
    expect(r.ok).toBe(true)
    expect(r.payload!.threads).toEqual([])
  })

  it('thread 标题超长截断、status 白名单外归 active、linked_entry_ids 非数字过滤', () => {
    const p = {
      report_md: '# ok',
      threads: [
        {
          title: 't'.repeat(100),
          status: 'weird',
          linked_entry_ids: [1, 'x', null, 3]
        }
      ]
    }
    const r = validateReportPayload(p)
    expect(r.payload!.threads[0].title.length).toBeLessThanOrEqual(60)
    expect(r.payload!.threads[0].status).toBe('active')
    expect(r.payload!.threads[0].linked_entry_ids).toEqual([1, 3])
  })
})
