import { describe, it, expect } from 'vitest'
import { describeLlmError } from '../../electron/adapters/llm-errors'

describe('describeLlmError：把底层错误翻译成用户能看懂的话', () => {
  it('识别模型已下线（英文措辞）', () => {
    const cases = [
      'LLM 请求失败 HTTP 400: {"error":{"code":"model_not_found"}}',
      'LLM 请求失败 HTTP 404: model not found',
      'LLM 请求失败 HTTP 400: The model `moonshot-v1-8k` does not exist',
      'LLM 请求失败 HTTP 400: invalid model: old-model',
      'LLM 请求失败 HTTP 400: unknown model specified'
    ]
    for (const c of cases) {
      const info = describeLlmError(c)
      expect(info.kind, c).toBe('model-not-found')
      expect(info.suggestRefreshModels).toBe(true)
      expect(info.title).toContain('下线')
      expect(info.detail).toContain('刷新')
    }
  })

  it('识别模型已下线（中文措辞）', () => {
    const cases = [
      'LLM 请求失败 HTTP 400: 模型不存在',
      'LLM 请求失败 HTTP 400: 不支持的模型',
      'LLM 请求失败 HTTP 400: 该模型已下线，请迁移'
    ]
    for (const c of cases) {
      expect(describeLlmError(c).kind, c).toBe('model-not-found')
    }
  })

  it('识别鉴权失败', () => {
    expect(describeLlmError('LLM 请求失败 HTTP 401: Incorrect API key provided').kind).toBe('auth')
    expect(describeLlmError('LLM 请求失败 HTTP 401: Unauthorized').kind).toBe('auth')
    expect(describeLlmError('LLM 请求失败 HTTP 403: Forbidden').kind).toBe('auth')
  })

  it('识别限流与额度问题', () => {
    expect(describeLlmError('LLM 请求失败 HTTP 429: rate limit exceeded').kind).toBe('rate-limit')
    expect(describeLlmError('LLM 请求失败 HTTP 429: quota exceeded').kind).toBe('rate-limit')
  })

  it('识别服务端错误与网络问题', () => {
    expect(describeLlmError('LLM 请求失败 HTTP 502: bad gateway').kind).toBe('server')
    expect(describeLlmError('LLM 请求失败 HTTP 503: service unavailable').kind).toBe('server')
    expect(describeLlmError('fetch failed').kind).toBe('network')
    expect(describeLlmError('connect ECONNREFUSED 127.0.0.1:11434').kind).toBe('network')
    expect(describeLlmError('request timeout').kind).toBe('network')
  })

  it('未知错误也给可读提示，不丢原始信息', () => {
    const info = describeLlmError('something totally unexpected')
    expect(info.kind).toBe('unknown')
    expect(info.title.length).toBeGreaterThan(0)
    expect(info.detail.length).toBeGreaterThan(0)
    expect(info.raw).toContain('something totally unexpected')
  })

  it('超长原始信息会被截断，避免撑爆界面', () => {
    const info = describeLlmError('x'.repeat(2000))
    expect(info.raw.length).toBeLessThanOrEqual(401)
    expect(info.raw.endsWith('…')).toBe(true)
  })

  it('接受 Error 对象而非仅字符串', () => {
    const info = describeLlmError(new Error('LLM 请求失败 HTTP 401: Unauthorized'))
    expect(info.kind).toBe('auth')
  })
})
