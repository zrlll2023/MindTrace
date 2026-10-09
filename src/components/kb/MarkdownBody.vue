<template>
  <div class="kb-body-render">
    <div v-if="html" class="prose kb-prose" v-html="html" @click="onBodyClick" />
    <p v-else class="empty-body">这份资料还没有正文。</p>
    <div v-if="zoom" class="drawer-mask zoom-mask" @click="zoom = ''">
      <img class="zoom-image" :src="zoom" alt="放大的资料图片" />
      <p class="zoom-hint">点击任意处关闭</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { renderBody, type RenderFormat } from '../../utils/kb-render'

const props = defineProps<{ text: string; format: RenderFormat }>()

const zoom = ref('')
const html = computed(() => renderBody(props.text, props.format))

watch(() => [props.text, props.format], () => { zoom.value = '' })

async function onBodyClick(event: MouseEvent): Promise<void> {
  const target = event.target as HTMLElement | null
  const image = target?.closest?.('img') as HTMLImageElement | null
  if (image?.src) {
    zoom.value = image.src
    return
  }
  // 正文里的链接一律交给系统浏览器，主窗口绝不导航
  const anchor = target?.closest?.('a') as HTMLAnchorElement | null
  if (!anchor?.href) return
  event.preventDefault()
  const r = await window.api.external.openUrl(anchor.href)
  if (!r.ok) console.warn('打开链接失败：', r.error)
}
</script>

<style scoped>
.kb-prose {
  max-width: 68ch;
  padding: 4px 0;
}
.kb-prose :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--r);
  border: 1px solid var(--border);
  background: var(--surface-2);
  cursor: zoom-in;
}
.kb-prose :deep(a) { color: var(--accent-text); text-decoration: underline; }
.empty-body { color: var(--text-3); font-size: 13px; margin: 0; }
.zoom-mask { cursor: zoom-out; }
.zoom-image {
  max-width: 92vw;
  max-height: 84vh;
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  background: var(--surface);
}
.zoom-hint {
  position: absolute;
  bottom: 18px;
  left: 0;
  right: 0;
  text-align: center;
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}
</style>
