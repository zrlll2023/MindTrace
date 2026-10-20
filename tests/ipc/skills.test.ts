import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getContext } from '../../electron/context'
import { initDb } from '../../electron/db/connection'
import { Repo } from '../../electron/db/repository'
import { registerIpcHandlers } from '../../electron/ipc/handlers'
import { registerSkillHandlers } from '../../electron/ipc/skills'
import { logError } from '../../electron/logger'
import * as registry from '../../electron/skills/registry'
import { AI_SKILL_LIMITS, AI_SKILL_SCOPE_META, type AiSkill } from '../../electron/types'

type Handler = (...args: unknown[]) => unknown
type SkillResponse = {
  ok: boolean
  skills: AiSkill[]
  skill?: AiSkill
  error?: string
  scopes?: unknown
  limits?: unknown
}

const ipc = vi.hoisted(() => ({
  callbacks: new Map<string, Handler>(),
  registrations: [] as string[]
}))

vi.mock('electron', () => ({
  app: {}, BrowserWindow: {}, dialog: {}, shell: {},
  ipcMain: {
    handle(channel: string, callback: Handler) {
      if (ipc.callbacks.has(channel)) throw new Error('重复通道: ' + channel)
      ipc.registrations.push(channel)
      ipc.callbacks.set(channel, callback)
    },
    on(channel: string) { ipc.registrations.push('on:' + channel) }
  }
}))
vi.mock('../../electron/context', () => ({ getContext: vi.fn() }))
vi.mock('../../electron/logger', () => ({
  logError: vi.fn(), logInfo: vi.fn(), logsDirectory: vi.fn(),
  buildDiagnosticArchive: vi.fn(), clearDiagnosticLogs: vi.fn()
}))
vi.mock('../../electron/skills/registry', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/skills/registry')>()
  return {
    ...actual,
    listSkills: vi.fn(actual.listSkills),
    saveSkill: vi.fn(actual.saveSkill),
    removeSkill: vi.fn(actual.removeSkill),
    setSkillEnabled: vi.fn(actual.setSkillEnabled)
  }
})

const actualRegistry = await vi.importActual<typeof registry>('../../electron/skills/registry')
const channels = ['skills:list', 'skills:save', 'skills:delete', 'skills:setEnabled'] as const
const writes = [
  { channel: 'skills:save', operation: 'saveSkill', tag: 'skills.save.failed', args: [{ name: 'test' }] },
  { channel: 'skills:delete', operation: 'removeSkill', tag: 'skills.delete.failed', args: ['id'] },
  { channel: 'skills:setEnabled', operation: 'setSkillEnabled', tag: 'skills.toggle.failed', args: ['id', true] }
] as const
const repo = { save: vi.fn() }
const skills: AiSkill[] = [{
  id: 'id', scope: 'capture', name: '简洁', content: '使用短句', description: '',
  enabled: true, createdAt: '2026-10-19', updatedAt: '2026-10-19'
}]

async function invoke(channel: string, ...args: unknown[]): Promise<SkillResponse> {
  const callback = ipc.callbacks.get(channel)
  if (!callback) throw new Error('未注册通道: ' + channel)
  return await callback({}, ...args) as SkillResponse
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  repo.save.mockReset()
  vi.mocked(getContext).mockReset()
  vi.mocked(getContext).mockReturnValue({ repo } as unknown as ReturnType<typeof getContext>)
  vi.mocked(registry.listSkills).mockReset().mockImplementation(actualRegistry.listSkills)
  vi.mocked(registry.saveSkill).mockReset().mockImplementation(actualRegistry.saveSkill)
  vi.mocked(registry.removeSkill).mockReset().mockImplementation(actualRegistry.removeSkill)
  vi.mocked(registry.setSkillEnabled).mockReset().mockImplementation(actualRegistry.setSkillEnabled)
  ipc.callbacks.clear()
  ipc.registrations.length = 0
  registerSkillHandlers()
})

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })

describe('技能 IPC 注册与主入口接线', () => {
  it('模块只注册四个技能通道，注册时不读取上下文', () => {
    expect(ipc.registrations).toEqual(channels)
    expect(getContext).not.toHaveBeenCalled()
  })

  it('模块加载不依赖已初始化的上下文', async () => {
    vi.mocked(getContext).mockImplementation(() => { throw new Error('未初始化') })
    vi.resetModules()
    await import('../../electron/ipc/skills')
    expect(getContext).not.toHaveBeenCalled()
  })

  it('主入口保持全部 90 个注册项及其顺序，且每个技能通道只注册一次', () => {
    ipc.callbacks.clear()
    ipc.registrations.length = 0
    registerIpcHandlers()
    // 抽取前的有序通道基线；on 使用显式前缀以区分注册种类。
    const expected = `
      window:minimize window:toggleMaximize window:close settings:get
      settings:save settings:openDataDir settings:openPreviousDataDir settings:selectDataDir
      settings:selectExportDir settings:clearExportDir settings:inspectDataMigration settings:migrateData
      settings:undoDataMigration settings:restoreDefaultDataDir settings:restart settings:getPresets
      settings:refreshModels diagnostics:openLogs diagnostics:export diagnostics:clear on:diagnostics:rendererError
      llm:listModels llm:testConnection skills:list skills:save
      skills:delete skills:setEnabled capture:list capture:sessions
      capture:defaultTitle capture:usage capture:generateTitle capture:parse
      capture:commit capture:undoCommit capture:archive timeline:list
      timeline:search timeline:get timeline:updateContent timeline:delete
      timeline:setHidden timeline:hiddenCount entries:manual profile:get
      profile:save profile:confirmDraft accounts:summary accounts:link
      accounts:refresh accounts:unlink reports:get reports:list
      reports:generate reports:generateWeekly export:md backup:run
      import:exportZip semantic:search semantic:index semantic:status
      hybrid:search kb:listFolders kb:addFolder kb:renameFolder
      kb:deleteFolder kb:reorderFolders kb:setFolderTags kb:listItems
      kb:getItem kb:addItem kb:findItemsForEntries kb:updateItem
      kb:setItemTags kb:setItemTitle kb:suggestTitle kb:updateReflection
      kb:deleteItem kb:summarize kb:extend kb:importFiles
      kb:saveImageAsset kb:exportItem shell:openExternal labs:metrics
      labs:planResearch labs:getResearchDraft labs:saveResearchDraft labs:clearResearchDraft
      labs:saveFinding
    `.trim().split(/\s+/)
    expect(ipc.registrations).toEqual(expected)
    expect(ipc.callbacks.size).toBe(89)
    expect(getContext).not.toHaveBeenCalled()
  })
})

describe('技能 IPC 返回、异常与落盘边界', () => {
  it('读取返回技能、区域和限制，不触发保存', async () => {
    vi.mocked(registry.listSkills).mockResolvedValue(skills)
    expect(await invoke('skills:list')).toEqual({
      ok: true, skills, scopes: AI_SKILL_SCOPE_META, limits: AI_SKILL_LIMITS
    })
    expect(registry.listSkills).toHaveBeenCalledExactlyOnceWith(repo)
    expect(repo.save).not.toHaveBeenCalled()
  })

  it('读取失败继续拒绝，不改成写接口的失败对象', async () => {
    const failure = new Error('读取失败')
    vi.mocked(registry.listSkills).mockRejectedValue(failure)
    await expect(invoke('skills:list')).rejects.toBe(failure)
    expect(logError).not.toHaveBeenCalled()
    expect(repo.save).not.toHaveBeenCalled()
  })

  it.each(channels)('%s 的上下文错误继续拒绝，不进入写接口 catch', async channel => {
    const failure = new Error('未初始化')
    vi.mocked(getContext).mockImplementation(() => { throw failure })
    await expect(invoke(channel, 'id', true)).rejects.toBe(failure)
    expect(logError).not.toHaveBeenCalled()
    expect(repo.save).not.toHaveBeenCalled()
  })

  describe.each(writes)('$channel', ({ channel, operation, tag, args }) => {
    it('成功结果保留字段，仅在操作成功后落盘一次', async () => {
      const result = { ok: true, skills, skill: skills[0] }
      vi.mocked(registry[operation]).mockResolvedValue(result)
      const expected = channel === 'skills:save'
        ? { ...result, scopes: AI_SKILL_SCOPE_META, limits: AI_SKILL_LIMITS } : result
      expect(await invoke(channel, ...args)).toEqual(expected)
      expect(registry[operation]).toHaveBeenCalledExactlyOnceWith(repo, ...args)
      expect(repo.save).toHaveBeenCalledTimes(1)
      expect(vi.mocked(registry[operation]).mock.invocationCallOrder[0])
        .toBeLessThan(repo.save.mock.invocationCallOrder[0])
      expect(logError).not.toHaveBeenCalled()
    })

    it('业务拒绝不保存，save 仍附带区域和限制', async () => {
      const result = { ok: false, error: '业务拒绝', skills }
      vi.mocked(registry[operation]).mockResolvedValue(result)
      expect(await invoke(channel, ...args)).toEqual(channel === 'skills:save'
        ? { ...result, scopes: AI_SKILL_SCOPE_META, limits: AI_SKILL_LIMITS } : result)
      expect(repo.save).not.toHaveBeenCalled()
      expect(logError).not.toHaveBeenCalled()
    })

    it('注册表抛错返回原失败对象及日志标签，不落盘', async () => {
      const failure = new Error('操作失败')
      vi.mocked(registry[operation]).mockRejectedValue(failure)
      expect(await invoke(channel, ...args)).toEqual({ ok: false, error: failure.message, skills: [] })
      expect(logError).toHaveBeenCalledExactlyOnceWith(tag, failure)
      expect(repo.save).not.toHaveBeenCalled()
    })

    it('落盘自身抛错返回失败，不重试，也不附区域和限制', async () => {
      const failure = new Error('磁盘写入失败')
      vi.mocked(registry[operation]).mockResolvedValue({ ok: true, skills })
      repo.save.mockImplementation(() => { throw failure })
      expect(await invoke(channel, ...args)).toEqual({ ok: false, error: failure.message, skills: [] })
      expect(logError).toHaveBeenCalledExactlyOnceWith(tag, failure)
      expect(repo.save).toHaveBeenCalledTimes(1)
    })
  })

  it.each([null, undefined, 42, ''])('删除 ID %s 使用原有字符串归一规则', async id => {
    vi.mocked(registry.removeSkill).mockResolvedValue({ ok: false, skills: [] })
    await invoke('skills:delete', id)
    expect(registry.removeSkill).toHaveBeenCalledExactlyOnceWith(repo, String(id ?? ''))
    expect(repo.save).not.toHaveBeenCalled()
  })

  it.each([null, undefined, 42, ''])('启停 ID %s 使用原有字符串归一规则', async id => {
    vi.mocked(registry.setSkillEnabled).mockResolvedValue({ ok: false, skills: [] })
    await invoke('skills:setEnabled', id, true)
    expect(registry.setSkillEnabled).toHaveBeenCalledExactlyOnceWith(repo, String(id ?? ''), true)
    expect(repo.save).not.toHaveBeenCalled()
  })

  it.each([true, false, 'true', 1, 0, null, undefined])('启停值 %s 仅接受布尔 true', async enabled => {
    vi.mocked(registry.setSkillEnabled).mockResolvedValue({ ok: false, skills: [] })
    await invoke('skills:setEnabled', 'id', enabled)
    expect(registry.setSkillEnabled).toHaveBeenCalledExactlyOnceWith(repo, 'id', enabled === true)
    expect(repo.save).not.toHaveBeenCalled()
  })
})

describe('技能 IPC 的真实文件库持久化', () => {
  it('新增、更新、停用、启用和删除后，关闭再打开数据库仍保留各阶段结果', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindtrace-skills-ipc-'))
    let db: Awaited<ReturnType<typeof initDb>> | undefined
    try {
      db = await initDb(dir)
      let currentRepo = new Repo(db, dir)
      let save = vi.spyOn(currentRepo, 'save')
      vi.mocked(getContext).mockImplementation(() => ({ repo: currentRepo } as ReturnType<typeof getContext>))

      async function reopen(): Promise<SkillResponse> {
        db!.close()
        db = undefined
        db = await initDb(dir)
        currentRepo = new Repo(db, dir)
        save = vi.spyOn(currentRepo, 'save')
        const snapshot = fs.readFileSync(path.join(dir, 'mindtrace.db'))
        const result = await invoke('skills:list')
        expect(save).not.toHaveBeenCalled()
        expect(fs.readFileSync(path.join(dir, 'mindtrace.db')).equals(snapshot)).toBe(true)
        return result
      }

      const created = await invoke('skills:save', { scope: 'capture', name: '简洁', content: '使用短句' })
      expect(created.ok).toBe(true)
      expect(save).toHaveBeenCalledTimes(1)
      const id = created.skill!.id
      expect((await reopen()).skills).toEqual(created.skills)

      const updated = await invoke('skills:save', { id, scope: 'capture', name: '更简洁', content: '只写重点' })
      expect(updated.ok).toBe(true)
      expect(save).toHaveBeenCalledTimes(1)
      expect((await reopen()).skills).toEqual(updated.skills)

      for (const enabled of [false, true]) {
        const toggled = await invoke('skills:setEnabled', id, enabled)
        expect(toggled.ok).toBe(true)
        expect(save).toHaveBeenCalledTimes(1)
        const persisted = await reopen()
        expect(persisted.skills).toEqual(toggled.skills)
        expect(persisted.skills[0].enabled).toBe(enabled)
      }

      const snapshot = fs.readFileSync(path.join(dir, 'mindtrace.db'))
      expect((await invoke('skills:delete', 'missing')).ok).toBe(false)
      expect(save).not.toHaveBeenCalled()
      expect(fs.readFileSync(path.join(dir, 'mindtrace.db')).equals(snapshot)).toBe(true)

      expect((await invoke('skills:delete', id)).ok).toBe(true)
      expect(save).toHaveBeenCalledTimes(1)
      expect((await reopen()).skills).toEqual([])
    } finally {
      db?.close()
      // dir 仅来自本测试的 mkdtempSync；在清理前核对父目录与专用前缀。
      if (path.dirname(dir) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('mindtrace-skills-ipc-')) {
        throw new Error('拒绝清理非本测试目录')
      }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
