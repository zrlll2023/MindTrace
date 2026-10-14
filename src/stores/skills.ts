import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  AI_SKILL_LIMITS,
  AI_SKILL_SCOPE_META,
  AiSkill,
  AiSkillScope,
  AiSkillScopeMeta
} from '../../electron/types'

/**
 * AI 技能（提示词偏好）的共享状态。
 * 技能只影响主进程里对应区域的 system prompt，前端只负责增删改查与可见性，
 * 不做任何本地拼装，避免界面展示的内容与实际注入的内容不一致。
 */
export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<AiSkill[]>([])
  const scopes = ref<Record<AiSkillScope, AiSkillScopeMeta>>({ ...AI_SKILL_SCOPE_META })
  const limits = ref({ ...AI_SKILL_LIMITS })
  const loading = ref(false)
  const loaded = ref(false)
  const message = ref('')
  const messageOk = ref(true)

  function notify(ok: boolean, text: string): void {
    messageOk.value = ok
    message.value = text
  }

  function apply(result: { skills?: AiSkill[]; scopes?: Record<AiSkillScope, AiSkillScopeMeta>; limits?: typeof AI_SKILL_LIMITS }): void {
    if (Array.isArray(result.skills)) skills.value = result.skills
    if (result.scopes) scopes.value = result.scopes
    if (result.limits) limits.value = { ...result.limits }
  }

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    loading.value = true
    try {
      const result = await window.api.skills.list()
      // 只有主进程明确返回成功才认为「已加载」：失败时保留可重试状态，
      // 否则界面会一直显示「未添加技能」，而主进程其实仍在注入已启用的技能
      if (result && result.ok === false) {
        notify(false, `读取技能失败：${result.error ?? '未知错误'}`)
        return
      }
      apply(result ?? {})
      loaded.value = true
    } catch (error) {
      notify(false, `读取技能失败：${(error as Error).message}`)
    } finally {
      loading.value = false
    }
  }

  const byScope = computed(() => (scope: AiSkillScope) => skills.value.filter(s => s.scope === scope))
  const enabledByScope = computed(() => (scope: AiSkillScope) => skills.value.filter(s => s.scope === scope && s.enabled))

  async function save(input: Partial<AiSkill>): Promise<boolean> {
    const result = await window.api.skills.save(input)
    apply(result ?? {})
    if (result?.ok) {
      notify(true, input.id ? '技能已更新' : '技能已添加')
      return true
    }
    notify(false, result?.error ?? '保存技能失败')
    return false
  }

  async function remove(id: string): Promise<boolean> {
    const result = await window.api.skills.remove(id)
    apply(result ?? {})
    if (result?.ok) {
      notify(true, '技能已删除')
      return true
    }
    notify(false, result?.error ?? '删除技能失败')
    return false
  }

  async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const result = await window.api.skills.setEnabled(id, enabled)
    apply(result ?? {})
    if (result?.ok) {
      notify(true, enabled ? '技能已启用' : '技能已停用')
      return true
    }
    notify(false, result?.error ?? '技能状态切换失败')
    return false
  }

  return {
    skills, scopes, limits, loading, loaded, message, messageOk,
    load, byScope, enabledByScope, save, remove, setEnabled, notify
  }
})
