<template>
  <div class="drawer-mask" @click.self="emit('close')">
    <section class="drawer skill-drawer" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <div class="drawer-head">
        <Icon name="sparkles" :size="16" />
        <h3 :id="titleId">{{ scope ? `${store.scopes[scope].label} · 技能` : 'AI 技能中心' }}</h3>
        <button class="close" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
          <Icon name="close" :size="15" />
        </button>
      </div>

      <p class="hint">
        技能只是写给 AI 的偏好说明。它不改数据库结构、不改输出格式，只在被启用区域的那一次 AI 请求里随提示词一起发出。
      </p>

      <div v-if="scope" class="scope-note">
        <div class="scope-row"><span class="k">生效区域</span><span class="v">{{ store.scopes[scope].surface }}</span></div>
        <div class="scope-row"><span class="k">作用范围</span><span class="v">{{ store.scopes[scope].effect }}</span></div>
        <div class="scope-row">
          <span class="k">注入上限</span>
          <span class="v">本区域最多同时启用 {{ store.limits.perScope }} 个技能，正文合计 {{ store.limits.injectChars }} 字内</span>
        </div>
      </div>
      <div v-else class="scope-note">
        <div class="scope-row">
          <span class="k">隔离规则</span>
          <span class="v">每个技能只属于一个区域，只注入那一个 AI 调用；不同页面的技能互不可见、互不叠加</span>
        </div>
        <div class="scope-row"><span class="k">总容量</span><span class="v">最多 {{ store.limits.total }} 个技能</span></div>
      </div>

      <p v-if="store.message" :class="store.messageOk ? 'msg ok inline' : 'msg err inline'">{{ store.message }}</p>

      <div class="skill-list">
        <article v-for="item in visibleSkills" :key="item.id" class="skill-item" :class="{ off: !item.enabled }">
          <div class="skill-main">
            <div class="skill-title">
              <strong>{{ item.name }}</strong>
              <span v-if="!scope" class="tag accent">{{ store.scopes[item.scope].label }}</span>
              <span class="tag" :class="item.enabled ? 'ok' : ''">{{ item.enabled ? '已启用' : '已停用' }}</span>
            </div>
            <p v-if="item.description" class="skill-desc">{{ item.description }}</p>
            <p class="skill-body">{{ item.content }}</p>
          </div>
          <div class="skill-actions">
            <button class="ghost small" type="button" @click="store.setEnabled(item.id, !item.enabled)">
              {{ item.enabled ? '停用' : '启用' }}
            </button>
            <button class="ghost small" type="button" @click="startEdit(item)">编辑</button>
            <button class="ghost small danger-text" type="button" @click="confirmDelete = item.id">删除</button>
          </div>
          <div v-if="confirmDelete === item.id" class="confirm-row">
            <span>删除后该区域不再注入这条技能，已生成的报告不受影响。</span>
            <button class="danger small" type="button" @click="doDelete(item.id)">确认删除</button>
            <button class="ghost small" type="button" @click="confirmDelete = ''">取消</button>
          </div>
        </article>

        <p v-if="!visibleSkills.length" class="empty-state">
          {{ scope ? '这个区域还没有技能，AI 会使用内置的默认规则。' : '还没有任何技能。技能添加后只在你为它选择的区域生效。' }}
        </p>
      </div>

      <form class="skill-editor" @submit.prevent="submit">
        <div class="editor-head">
          <h4>{{ form.id ? '编辑技能' : '添加技能' }}</h4>
          <button v-if="form.id" class="ghost small" type="button" @click="resetForm">改为新建</button>
        </div>

        <div class="editor-grid">
          <div class="field">
            <label for="skill-scope">生效区域</label>
            <select id="skill-scope" v-model="form.scope" :disabled="!!scope">
              <option v-for="key in scopeKeys" :key="key" :value="key">{{ store.scopes[key].label }}</option>
            </select>
            <p class="hint tiny">{{ store.scopes[form.scope].surface }}</p>
          </div>
          <div class="field">
            <label for="skill-name">技能名称</label>
            <input id="skill-name" v-model="form.name" :maxlength="store.limits.name" placeholder="例如：只写可验证的结论" />
          </div>
        </div>

        <div class="field">
          <label for="skill-description">一句话说明（可选，不注入）</label>
          <input id="skill-description" v-model="form.description" :maxlength="store.limits.description" placeholder="给未来的自己看：这条技能解决什么问题" />
        </div>

        <div class="field">
          <label for="skill-content">指令正文（注入到该区域的 AI 提示词）</label>
          <textarea
            id="skill-content"
            v-model="form.content"
            rows="5"
            :maxlength="store.limits.content"
            placeholder="例如：每个结论后面补一句它来自哪条记录；没有依据时写“暂未观察到”，不要编造趋势。"
          />
          <p class="hint tiny">
            {{ form.content.length }} / {{ store.limits.content }} 字。只写偏好与侧重，不要写输出格式或字段要求——格式契约优先级永远高于技能。
          </p>
        </div>

        <div class="editor-actions">
          <label class="checkbox"><input v-model="form.enabled" type="checkbox" />保存后立即启用</label>
          <span class="spacer" />
          <button class="primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : form.id ? '保存修改' : '添加技能' }}</button>
        </div>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { AiSkill, AiSkillScope, AI_SKILL_SCOPES } from '../../electron/types'
import { useSkillsStore } from '../stores/skills'
import Icon from './Icon.vue'

const props = defineProps<{ scope?: AiSkillScope | null }>()
const emit = defineEmits<{ close: [] }>()

const store = useSkillsStore()
const scope = computed(() => props.scope ?? null)
const titleId = 'skill-drawer-title'
const confirmDelete = ref('')
const saving = ref(false)
const scopeKeys = AI_SKILL_SCOPES

const visibleSkills = computed(() =>
  scope.value ? store.skills.filter(item => item.scope === scope.value) : store.skills
)

const form = reactive<{ id?: string; scope: AiSkillScope; name: string; description: string; content: string; enabled: boolean }>({
  id: undefined,
  scope: scope.value ?? 'capture',
  name: '',
  description: '',
  content: '',
  enabled: true
})

function resetForm(): void {
  form.id = undefined
  form.scope = scope.value ?? 'capture'
  form.name = ''
  form.description = ''
  form.content = ''
  form.enabled = true
}

function startEdit(item: AiSkill): void {
  form.id = item.id
  form.scope = item.scope
  form.name = item.name
  form.description = item.description
  form.content = item.content
  form.enabled = item.enabled
}

async function submit(): Promise<void> {
  saving.value = true
  try {
    const ok = await store.save({
      id: form.id,
      scope: form.scope,
      name: form.name,
      description: form.description,
      content: form.content,
      enabled: form.enabled
    })
    if (ok) resetForm()
  } finally {
    saving.value = false
  }
}

async function doDelete(id: string): Promise<void> {
  confirmDelete.value = ''
  if (form.id === id) resetForm()
  await store.remove(id)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  void store.load()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.skill-drawer { width: 680px; }
.drawer-head h3 { margin: 0; font-size: 15px; }

.scope-note {
  display: grid; gap: 5px;
  margin: 12px 0 14px; padding: 11px 13px;
  border: 1px solid var(--border); border-radius: var(--r);
  background: var(--surface-2);
}
.scope-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; font-size: 12.5px; }
.scope-row .k { color: var(--text-3); }
.scope-row .v { color: var(--text-2); }

.skill-drawer .msg.inline { display: inline-block; margin: 0 0 12px; }

.skill-list { display: grid; gap: 8px; }
.skill-item {
  display: grid; gap: 8px;
  padding: 11px 13px;
  border: 1px solid var(--border); border-radius: var(--r);
  background: var(--surface);
}
.skill-item.off { opacity: 0.72; border-style: dashed; }
.skill-main { min-width: 0; }
.skill-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.skill-title strong { font-size: 13.5px; }
.skill-desc { margin: 4px 0 0; color: var(--text-2); font-size: 12.5px; }
.skill-body {
  margin: 6px 0 0; padding: 8px 10px;
  background: var(--surface-2); border-radius: var(--r-sm);
  color: var(--text-2); font-size: 12.5px; line-height: 1.6;
  white-space: pre-wrap; overflow-wrap: anywhere;
  max-height: min(132px, 22vh); overflow-y: auto;
}
.skill-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.danger-text { color: var(--danger); }
.danger-text:hover:not(:disabled) { background: var(--danger-weak); color: var(--danger); }
.confirm-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 8px 10px; border-radius: var(--r);
  background: var(--danger-weak); color: var(--danger); font-size: 12.5px;
}
.confirm-row span { flex: 1 1 220px; }
.empty-state {
  margin: 0; padding: 22px 16px; text-align: center;
  color: var(--text-3); font-size: 13px;
  border: 1px dashed var(--border-strong); border-radius: var(--r);
}

.skill-editor {
  margin-top: 16px; padding-top: 16px;
  border-top: 1px solid var(--border);
}
.editor-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.editor-head h4 { margin: 0; font-size: 13.5px; }
.editor-head button { margin-left: auto; }
.editor-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.hint.tiny { margin: 5px 0 0; font-size: 11.5px; color: var(--text-3); }
.editor-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }

@media (max-width: 720px) {
  .editor-grid { grid-template-columns: 1fr; }
  .scope-row { grid-template-columns: 1fr; gap: 2px; }
}
</style>
