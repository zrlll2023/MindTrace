import { describe, expect, it } from 'vitest'
import { sanitizeDiagnosticText } from '../electron/logger'

describe('诊断日志脱敏', () => {
  it('隐藏常见密钥、令牌和 sk key', () => {
    const value = sanitizeDiagnosticText('api_key=secret-value Authorization: Bearer abcdef token: xyz sk-1234567890abcdef')
    expect(value).not.toContain('secret-value')
    expect(value).not.toContain('abcdef')
    expect(value).not.toContain('xyz')
    expect(value).not.toContain('1234567890abcdef')
    expect(value).toContain('[REDACTED]')
  })

  it('限制异常文本大小', () => {
    expect(sanitizeDiagnosticText(new Error('x'.repeat(20000))).length).toBeLessThanOrEqual(12000)
  })
})
