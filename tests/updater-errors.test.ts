import { describe, expect, it } from 'vitest'
import { readableUpdateError } from '../electron/updater-errors'

describe('更新错误提示', () => {
  it('将网络错误转换为可操作提示', () => {
    expect(readableUpdateError(new Error('getaddrinfo ENOTFOUND github.com')))
      .toBe('无法连接更新服务器，请检查网络')
  })

  it('将鉴权和更新清单错误转换为明确提示', () => {
    expect(readableUpdateError(new Error('HTTP 403 forbidden'))).toBe('更新服务器拒绝了访问')
    expect(readableUpdateError(new Error('Cannot find latest.yml: 404'))).toBe('暂时找不到可用的更新信息')
  })

  it('限制未知错误在界面中的长度', () => {
    expect(readableUpdateError(new Error(`Error: ${'x'.repeat(200)}`))).toHaveLength(160)
  })
})
