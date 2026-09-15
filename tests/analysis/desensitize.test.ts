import { describe, it, expect } from 'vitest'
import { desensitizeText } from '../../electron/analysis/desensitize'

describe('desensitizeText', () => {
  it('替换邮箱', () => {
    expect(desensitizeText('联系我 zrl@example.com 谢谢')).toBe('联系我 [邮箱] 谢谢')
  })

  it('替换手机号', () => {
    expect(desensitizeText('我手机 13812345678 随时联系')).toBe('我手机 [手机号] 随时联系')
  })

  it('替换 @账号', () => {
    expect(desensitizeText('推特的 @zrl_2023 说得对')).toBe('推特的 [账号] 说得对')
  })

  it('替换身份证号', () => {
    expect(desensitizeText('证件号 110101199003077758')).toContain('[证件号]')
  })

  it('替换链接保留域名提示', () => {
    const out = desensitizeText('参考 https://example.com/very/long/path?q=1 这篇')
    expect(out).toBe('参考 [链接:example.com] 这篇')
  })

  it('「和/跟/被 + 人名」模式替换为某人', () => {
    expect(desensitizeText('今天和王小明吃饭')).toBe('今天和[某人]吃饭')
    expect(desensitizeText('被李雷骂了')).toBe('被[某人]骂了')
  })

  it('关系称谓不误伤', () => {
    expect(desensitizeText('和导师聊了，跟妈妈打电话，与朋友聚餐')).toBe(
      '和导师聊了，跟妈妈打电话，与朋友聚餐'
    )
  })

  it('普通内容原样保留', () => {
    const t = '睡了6.5小时，想到RAG评估的新方法，纸上得来终觉浅'
    expect(desensitizeText(t)).toBe(t)
  })
})
