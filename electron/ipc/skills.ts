import { ipcMain } from 'electron'
import { getContext } from '../context'
import { AI_SKILL_LIMITS, AI_SKILL_SCOPE_META } from '../types'
import { listSkills, removeSkill, saveSkill, setSkillEnabled } from '../skills/registry'
import { logError } from '../logger'

export function registerSkillHandlers(): void {
  // ---------- AI 技能（仅存提示词，不写业务数据） ----------
  // 注意：动作型处理器都必须 repo.save()——本机是 sql.js 内存库，只改内存不落盘，
  // 用户改完技能不做别的写操作就退出会静默丢失。
  ipcMain.handle('skills:list', async () => {
    const skills = await listSkills(getContext().repo)
    return { ok: true, skills, scopes: AI_SKILL_SCOPE_META, limits: AI_SKILL_LIMITS }
  })
  ipcMain.handle('skills:save', async (_e, skill: unknown) => {
    const c = getContext()
    try {
      const result = await saveSkill(c.repo, skill)
      if (result.ok) c.repo.save()
      return { ...result, scopes: AI_SKILL_SCOPE_META, limits: AI_SKILL_LIMITS }
    } catch (error) {
      logError('skills.save.failed', error)
      return { ok: false, error: (error as Error).message, skills: [] }
    }
  })
  ipcMain.handle('skills:delete', async (_e, id: string) => {
    const c = getContext()
    try {
      const result = await removeSkill(c.repo, String(id ?? ''))
      if (result.ok) c.repo.save()
      return result
    } catch (error) {
      logError('skills.delete.failed', error)
      return { ok: false, error: (error as Error).message, skills: [] }
    }
  })
  ipcMain.handle('skills:setEnabled', async (_e, id: string, enabled: boolean) => {
    const c = getContext()
    try {
      const result = await setSkillEnabled(c.repo, String(id ?? ''), enabled === true)
      if (result.ok) c.repo.save()
      return result
    } catch (error) {
      logError('skills.toggle.failed', error)
      return { ok: false, error: (error as Error).message, skills: [] }
    }
  })
}
