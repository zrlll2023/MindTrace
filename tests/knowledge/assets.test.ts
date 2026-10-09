import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assetNameFromUrl, assetUrl, normalizeExtension, resolveAssetPath, writeAsset } from '../../electron/knowledge/assets'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindtrace-assets-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('知识库图片资源目录', () => {
  it('按内容命名并去重，同一张图只落盘一次', () => {
    const dir = tempDir()
    const bytes = new Uint8Array([1, 2, 3, 4])
    const a = writeAsset(dir, bytes, '.PNG')
    const b = writeAsset(dir, bytes, 'png')

    expect(a).toEqual(b)
    expect(a.url).toBe(assetUrl(a.name))
    expect(a.name).toMatch(/^[a-f0-9]{20}\.png$/)
    expect(fs.readdirSync(path.join(dir, 'knowledge-assets'))).toHaveLength(1)
  })

  it('扩展名白名单收敛，未知类型按 png 存', () => {
    expect(normalizeExtension('.jpg')).toBe('jpg')
    expect(normalizeExtension('.JPE')).toBe('jpg')
    expect(normalizeExtension('exe')).toBe('png')
    expect(normalizeExtension('html')).toBe('png')
  })

  it('拒绝空图片', () => {
    const dir = tempDir()
    expect(() => writeAsset(dir, new Uint8Array([]), 'png')).toThrow('图片内容为空')
  })
})

describe('图片协议地址取名', () => {
  const name = 'aaaaaaaaaaaaaaaaaaaa.png'

  it('带 host 与不带 host 都取到同一个文件名', () => {
    expect(assetNameFromUrl(`mindtrace-asset://local/${name}`)).toBe(name)
    expect(assetNameFromUrl(`mindtrace-asset:///${name}`)).toBe(name)
    expect(assetNameFromUrl(`mindtrace-asset://local/${name}?t=2`)).toBe(name)
    expect(assetNameFromUrl(`mindtrace-asset://local/${name}#x`)).toBe(name)
    expect(assetNameFromUrl(`mindtrace-asset://local/${encodeURIComponent(name)}`)).toBe(name)
  })

  it('缺少路径段或不是协议地址时返回空串', () => {
    expect(assetNameFromUrl('mindtrace-asset://local')).toBe('')
    expect(assetNameFromUrl('mindtrace-asset://')).toBe('')
    expect(assetNameFromUrl('')).toBe('')
    // 本函数只服务自己的协议：连 host 一起剥掉，交给路径校验去拒绝奇怪名字
    expect(assetNameFromUrl('https://example.com/a.png')).toBe('a.png')
  })

  it('取名后仍要过路径校验，越界地址拿不到文件', () => {
    const dir = tempDir()
    expect(resolveAssetPath(dir, assetNameFromUrl(`mindtrace-asset://local/../../mindtrace.db`))).toBeNull()
    expect(resolveAssetPath(dir, assetNameFromUrl(`mindtrace-asset://local/${name}`))).not.toBeNull()
  })
})

describe('图片协议路径解析', () => {
  it('只认资源目录里的哈希文件名', () => {
    const dir = tempDir()
    const { name } = writeAsset(dir, new Uint8Array([9, 9]), 'png')
    expect(resolveAssetPath(dir, `/${name}`)).toBe(path.resolve(dir, 'knowledge-assets', name))
    expect(resolveAssetPath(dir, `/${name}?x=1`)).toBe(path.resolve(dir, 'knowledge-assets', name))
  })

  it('拒绝路径穿越、目录名与任意文件名', () => {
    const dir = tempDir()
    expect(resolveAssetPath(dir, '/../mindtrace.db')).toBeNull()
    expect(resolveAssetPath(dir, '/..%2Fmindtrace.db')).toBeNull()
    expect(resolveAssetPath(dir, '/a/b.png')).toBeNull()
    expect(resolveAssetPath(dir, '/notes.txt')).toBeNull()
    expect(resolveAssetPath(dir, '/')).toBeNull()
    expect(resolveAssetPath(dir, '')).toBeNull()
  })

  it('拒绝不符合哈希形状的越界名', () => {
    const dir = tempDir()
    expect(resolveAssetPath(dir, '/../../../../Windows/System32/config/sam')).toBeNull()
    expect(resolveAssetPath(dir, `/${'a'.repeat(20)}.png`)).not.toBeNull()
  })
})
