import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadProviderPresets,
  mergeFetchedModels,
  saveUserProviderPresets,
  userPresetsFile
} from '../../electron/store/provider-presets'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindtrace-presets-'))
})

afterEach(() => {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('provider-presets 外部配置', () => {
  it('没有用户覆盖文件时，从内置 resources/ai-providers.json 加载', () => {
    const presets = loadProviderPresets(dir)
    expect(presets.length).toBeGreaterThan(0)
    const ids = presets.map(p => p.id)
    expect(ids).toContain('deepseek')
    expect(ids).toContain('moonshot')
    // 内置文件应已更新为当前模型，不含已下线的 moonshot-v1 系列
    const moonshot = presets.find(p => p.id === 'moonshot')
    expect(moonshot?.models).toContain('kimi-k3')
    expect(moonshot?.models.some(m => m.startsWith('moonshot-v1'))).toBe(false)
  })

  it('用户覆盖文件优先于内置文件', () => {
    saveUserProviderPresets(dir, [
      { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: ['only-this-one'] }
    ])
    const presets = loadProviderPresets(dir)
    expect(presets).toHaveLength(1)
    expect(presets[0].models).toEqual(['only-this-one'])
  })

  it('用户文件损坏时静默回退到内置文件，不抛错', () => {
    fs.writeFileSync(userPresetsFile(dir), '{ this is not json', 'utf8')
    const presets = loadProviderPresets(dir)
    expect(presets.length).toBeGreaterThan(1)
    expect(presets.map(p => p.id)).toContain('deepseek')
  })

  it('用户文件结构不合法时同样回退（缺 models 字段）', () => {
    fs.writeFileSync(userPresetsFile(dir), JSON.stringify({ presets: [{ id: 'x', name: 'X', baseUrl: '' }] }), 'utf8')
    const presets = loadProviderPresets(dir)
    expect(presets.map(p => p.id)).toContain('deepseek')
  })

  it('保存后可被 load 读回，且是原子写入（不留 .tmp）', () => {
    const next = [{ id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://x', models: ['glm-5.3', 'glm-5.2'] }]
    expect(saveUserProviderPresets(dir, next)).toBe(true)
    expect(fs.existsSync(userPresetsFile(dir))).toBe(true)
    expect(fs.existsSync(userPresetsFile(dir) + '.tmp')).toBe(false)
    const back = loadProviderPresets(dir)
    expect(back).toEqual(next)
  })

  it('mergeFetchedModels 用实时列表覆盖指定提供商，其他提供商不变', () => {
    const presets = loadProviderPresets(dir)
    const before = presets.find(p => p.id === 'zhipu')!.models.slice()
    const merged = mergeFetchedModels(presets, 'deepseek', ['deepseek-v4-pro', 'deepseek-flash'])
    expect(merged.find(p => p.id === 'deepseek')!.models).toEqual(['deepseek-v4-pro', 'deepseek-flash'])
    expect(merged.find(p => p.id === 'zhipu')!.models).toEqual(before)
  })

  it('mergeFetchedModels 去重、去空白、忽略空列表', () => {
    const presets = [{ id: 'a', name: 'A', baseUrl: '', models: ['old'] }]
    const merged = mergeFetchedModels(presets, 'a', [' m1 ', 'm1', '', 'm2'])
    expect(merged[0].models).toEqual(['m1', 'm2'])
    // 空列表不覆盖原有预设，避免一次失败的刷新清空可选模型
    expect(mergeFetchedModels(presets, 'a', [])).toEqual(presets)
  })

  it('mergeFetchedModels 遇到未知提供商时追加而非丢弃', () => {
    const presets: { id: string; name: string; baseUrl: string; models: string[] }[] = []
    const merged = mergeFetchedModels(presets, 'newprovider', ['x'])
    expect(merged).toHaveLength(1)
    expect(merged[0].models).toEqual(['x'])
  })
})
