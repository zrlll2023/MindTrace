<template>
  <div class="skill-bar" :class="{ empty: !enabledSkills.length }">
    <span class="bar-icon"><Icon name="shield" :size="14" /></span>
    <span class="bar-label">{{ store.scopes[scope].label }}技能</span>

    <span class="bar-chips">
      <template v-if="skills.length">
        <span
          v-for="item in shownSkills"
          :key="item.id"
          class="tag skill-chip"
          :class="{ off: !item.enabled }"
          :title="item.content"
        >
          {{ item.name }}<template v-if="!item.enabled">（停用）</template>
        </span>
        <span v-if="skills.length > shownSkills.length" class="tag">+{{ skills.length - shownSkills.length }}</span>
      </template>
      <span v-else class="bar-empty">未添加技能，AI 使用默认规则</span>
    </span>

    <button class="ghost small bar-action" type="button" :title="store.scopes[scope].effect" @click="open = true">
      <Icon :name="skills.length ? 'sliders' : 'plus'" :size="14" />
      {{ skills.length ? '管理技能' : '添加技能' }}
    </button>

    <SkillDrawer v-if="open" :scope="scope" @close="open = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AiSkillScope } from '../../electron/types'
import { useSkillsStore } from '../stores/skills'
import Icon from './Icon.vue'
import SkillDrawer from './SkillDrawer.vue'

const props = defineProps<{ scope: AiSkillScope }>()
const store = useSkillsStore()
const open = ref(false)
const scope = computed(() => props.scope)
const skills = computed(() => store.byScope(scope.value))
const enabledSkills = computed(() => store.enabledByScope(scope.value))
/** 内联条只展示前 3 个名字，避免把页面挤长 */
const shownSkills = computed(() => skills.value.slice(0, 3))

onMounted(() => void store.load())
</script>

<style scoped>
.skill-bar {
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  margin-bottom: 12px;
  padding: 7px 10px 7px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--surface-2);
  font-size: 12px;
  min-width: 0;
}
/* 有技能时用强调色点一下，提醒用户这段提示词会影响输出 */
.skill-bar:not(.empty) { border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); }
.bar-icon {
  display: grid; place-items: center;
  width: 22px; height: 22px; flex: 0 0 22px;
  border-radius: var(--r-sm);
  background: var(--surface); color: var(--text-3);
}
.skill-bar:not(.empty) .bar-icon { color: var(--accent); }
.bar-label { color: var(--text-2); font-weight: 600; white-space: nowrap; }
.bar-chips { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
.skill-chip { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.skill-chip.off { opacity: 0.62; border-style: dashed; }
.bar-empty { color: var(--text-3); }
.bar-action { margin-left: auto; white-space: nowrap; }
</style>
