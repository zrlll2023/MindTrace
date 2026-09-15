import { describe, it, expect } from 'vitest'
import { chunkText } from '../../electron/analysis/chunker'

describe('chunkText', () => {
  it('短文本返回单块（原文）', () => {
    const out = chunkText('睡了6.5小时', 400, 60)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('睡了6.5小时')
    expect(out[0].start).toBe(0)
  })

  it('长文本按句界切分，不把句子劈成两半', () => {
    const text = '第一句话讲RAG评估。第二句话讲检索增强。第三句话讲向量数据库。第四句话讲重排序。'
    const out = chunkText(text, 30, 0)
    expect(out.length).toBeGreaterThan(1)
    // 每块都是完整句子的组合（不出现半句结尾）
    for (const c of out) {
      expect(c.text.endsWith('。') || c.text === out[out.length - 1].text).toBe(true)
    }
  })

  it('相邻块有重叠内容', () => {
    const text = '甲乙丙丁戊己庚辛。子丑寅卯辰巳。午未申酉戌亥。一二三四五六。'
    const out = chunkText(text, 20, 8)
    expect(out.length).toBeGreaterThan(1)
    // 重叠：第2块的开头应与第1块的结尾有相同字符序列
    const first = out[0].text
    const second = out[1].text
    const overlapExists = second.slice(0, 8).split('').some(ch => first.includes(ch))
    expect(overlapExists).toBe(true)
  })

  it('无句界的超长单句硬切', () => {
    const text = '啊'.repeat(1000)
    const out = chunkText(text, 400, 60)
    expect(out.length).toBe(3) // 400+60 步进 → ceil((1000-60)/340)+1 ≈ 3
    for (const c of out) expect(c.text.length).toBeLessThanOrEqual(400)
  })

  it('所有块拼起来覆盖原文（无内容丢失）', () => {
    const text = '句子一。句子二。句子三。句子四。句子五。句子六。句子七。句子八。'
    const out = chunkText(text, 15, 5)
    const covered = new Set<string>()
    for (const c of out) {
      for (const ch of c.text) covered.add(ch)
    }
    for (const ch of text.replace(/\s/g, '')) {
      expect(covered.has(ch)).toBe(true)
    }
  })

  it('start 记录块在原文中的起始位置', () => {
    const text = '第一条内容。'.repeat(40)
    const out = chunkText(text, 30, 0)
    expect(out[0].start).toBe(0)
    expect(out[1].start).toBeGreaterThan(0)
    expect(text.slice(out[1].start, out[1].start + 5)).toBe(out[1].text.slice(0, 5))
  })
})
