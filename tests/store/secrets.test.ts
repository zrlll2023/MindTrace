import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SecretBox } from '../../electron/store/secrets'

describe('SecretBox', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-secrets-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('set 后 get 返回原文（round-trip）', () => {
    const box = new SecretBox(dir)
    box.set('llm_api_key', 'sk-secret-123')
    expect(box.get('llm_api_key')).toBe('sk-secret-123')
  })

  it('未设置的 key 返回 null', () => {
    const box = new SecretBox(dir)
    expect(box.get('nothing')).toBeNull()
  })

  it('文件落盘且内容不包含明文（加密校验）', () => {
    const box = new SecretBox(dir)
    box.set('llm_api_key', 'sk-secret-123')
    const file = fs.readdirSync(dir).find(f => f.endsWith('.bin'))
    expect(file).toBeTruthy()
    const raw = fs.readFileSync(path.join(dir, file!), 'utf8')
    expect(raw).not.toContain('sk-secret-123')
  })

  it('删除 key', () => {
    const box = new SecretBox(dir)
    box.set('llm_api_key', 'x')
    box.delete('llm_api_key')
    expect(box.get('llm_api_key')).toBeNull()
  })
})
