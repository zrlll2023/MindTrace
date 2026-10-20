import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { ProviderPreset, DEFAULT_PROVIDER_PRESETS } from '../types'

/**
 * AI 提供商预设的加载与缓存。
 *
 * 三级来源，优先级从高到低：
 *   1. 用户数据目录下的 ai-providers.json —— 用户自己改过或程序自动刷新后的结果
 *   2. 应用内置 resources/ai-providers.json —— 随版本分发，换模型只需改这个文件
 *   3. 代码内 DEFAULT_PROVIDER_PRESETS —— 兜底，保证文件全部缺失时仍可用
 *
 * 任何一级损坏都不抛错，直接降级到下一级；预设永远不应阻塞应用启动。
 */

interface ProvidersFile {
  $schemaVersion?: number
  updatedAt?: string
  note?: string
  presets?: ProviderPreset[]
}

/** 内置预设文件的候选位置：开发态在仓库根，打包态在 extraResources */
function bundledCandidates(): string[] {
  const list: string[] = []
  // 打包后：resources/ai-providers.json（extraResources 复制到 process.resourcesPath）
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, 'ai-providers.json'))
  // 开发态：仓库根 resources/ai-providers.json（__dirname 在 dist-electron/）
  list.push(path.join(__dirname, '../../resources/ai-providers.json'))
  // 直接用 app.getAppPath() 兜底（asar 内）
  try {
    list.push(path.join(app.getAppPath(), 'resources/ai-providers.json'))
  } catch {
    // app 未就绪时忽略
  }
  return list
}

function readPresetsFile(file: string): ProviderPreset[] | null {
  try {
    if (!fs.existsSync(file)) return null
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as ProvidersFile
    const presets = raw?.presets
    if (!Array.isArray(presets) || presets.length === 0) return null
    // 最小结构校验：id/name/baseUrl/models 必须存在，模型名必须是字符串
    for (const p of presets) {
      if (!p || typeof p.id !== 'string' || !p.id) return null
      if (typeof p.name !== 'string' || !p.name) return null
      if (typeof p.baseUrl !== 'string') return null
      if (!Array.isArray(p.models) || !p.models.every(m => typeof m === 'string')) return null
    }
    return presets.map(p => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      models: [...p.models],
      ...(typeof p.note === 'string' ? { note: p.note } : {}),
      ...(typeof p.docsUrl === 'string' ? { docsUrl: p.docsUrl } : {})
    }))
  } catch {
    return null
  }
}

/** 用户数据目录下的预设文件（可写，用于缓存自动刷新的模型列表） */
export function userPresetsFile(dataDir: string): string {
  return path.join(dataDir, 'ai-providers.json')
}

/**
 * 读取预设。dataDir 提供时优先读用户目录的覆盖文件。
 * 永远返回非空数组。
 */
export function loadProviderPresets(dataDir?: string): ProviderPreset[] {
  if (dataDir) {
    const userPresets = readPresetsFile(userPresetsFile(dataDir))
    if (userPresets) return userPresets
  }
  for (const candidate of bundledCandidates()) {
    const presets = readPresetsFile(candidate)
    if (presets) return presets
  }
  return DEFAULT_PROVIDER_PRESETS.map(p => ({ ...p, models: [...p.models] }))
}

/** 原子写入用户目录的预设文件；失败不抛错（预设缓存不是关键数据） */
export function saveUserProviderPresets(dataDir: string, presets: ProviderPreset[]): boolean {
  const target = userPresetsFile(dataDir)
  const tmp = `${target}.tmp`
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    const body: ProvidersFile = {
      $schemaVersion: 1,
      updatedAt: new Date().toISOString().slice(0, 10),
      note: '本文件由 MindTrace 维护：自动刷新模型列表后会写入这里。删除它即可恢复随版本内置的预设。',
      presets
    }
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8')
    fs.renameSync(tmp, target)
    return true
  } catch {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true })
    } catch {
      // 清理失败无需处理
    }
    return false
  }
}

/**
 * 用实时拉取到的模型列表覆盖某个提供商的预设模型。
 * 只更新 models 字段，其余保持不变；未知 id 追加为自定义预设。
 */
export function mergeFetchedModels(
  presets: ProviderPreset[],
  providerId: string,
  models: string[]
): ProviderPreset[] {
  if (!models.length) return presets
  const clean = Array.from(new Set(models.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim())))
  if (!clean.length) return presets
  let found = false
  const next = presets.map(p => {
    if (p.id !== providerId) return p
    found = true
    return { ...p, models: clean }
  })
  if (!found) next.push({ id: providerId, name: providerId, baseUrl: '', models: clean })
  return next
}
