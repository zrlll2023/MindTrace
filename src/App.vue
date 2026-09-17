<template>
  <div class="app-frame">
    <header class="app-titlebar">
      <div class="titlebar-identity">
        <span class="titlebar-mark"><Icon name="trace" :size="13" /></span>
        <span>MindTrace</span>
      </div>
      <div class="window-controls">
        <button title="最小化" aria-label="最小化" @click="minimizeWindow"><Icon name="minus" :size="15" /></button>
        <button title="最大化或还原" aria-label="最大化或还原" @click="toggleMaximizeWindow"><Icon name="maximize" :size="12" /></button>
        <button class="window-close" title="关闭" aria-label="关闭" @click="closeWindow"><Icon name="close" :size="15" /></button>
      </div>
    </header>
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark"><Icon name="trace" :size="17" /></span>
          <span class="brand-text">
            <span class="brand-name">MindTrace</span>
            <span class="brand-sub">心迹追踪</span>
          </span>
        </div>

        <button
          class="nav-order-toggle"
          :class="{ on: reorderMode }"
          :title="reorderMode ? '完成顺序调整' : '调整导航顺序'"
          @click="toggleReorder"
        >
          <Icon name="grip-vertical" :size="16" />
          <span>{{ reorderMode ? '完成调整' : '调整顺序' }}</span>
        </button>

        <nav class="nav-main" :class="{ arranging: reorderMode }">
          <RouterLink
            v-for="item in movableNav"
            :key="item.path"
            :to="item.path"
            :data-nav-path="item.path"
            class="nav-item"
            :class="{ active: route.path === item.path, dragging: draggingPath === item.path, pressing: pressingPath === item.path }"
            :title="reorderMode ? '长按后上下移动' : item.meta?.desc"
            @pointerdown="startLongPress($event, item.path)"
            @pointermove="moveNavItem"
            @pointerup="finishLongPress"
            @pointercancel="finishLongPress"
            @click="handleNavClick"
          >
            <span class="icon"><Icon :name="item.meta?.icon ?? 'pen'" /></span>
            <span class="nav-label">{{ item.meta?.label }}</span>
            <Icon v-if="reorderMode" class="drag-handle" name="grip-vertical" :size="15" />
          </RouterLink>
        </nav>

        <div class="footer">
          <div class="update-widget">
            <button
              class="update-button"
              :disabled="!canRequestUpdate"
              :title="updateButtonTitle"
              @click="requestUpdate"
            >
              <Icon :name="hasUpdate ? 'download' : 'check'" :size="14" />
              <span>{{ updateButtonText }}</span>
            </button>
            <div v-if="updateStatusText" class="update-status" :class="{ error: updateState?.phase === 'error' }" aria-live="polite">
              {{ updateStatusText }}
            </div>
          </div>
          <div class="footer-tools">
            <div class="local-note">
              <b>本地优先</b>数据不出设备
            </div>
            <div class="theme-toggle">
              <button :class="{ on: theme.mode === 'light' }" title="纸 · 浅色" @click="theme.set('light')"><Icon name="sun" :size="14" /></button>
              <button :class="{ on: theme.mode === 'system' }" title="跟随系统" @click="theme.set('system')"><Icon name="monitor" :size="14" /></button>
              <button :class="{ on: theme.mode === 'dark' }" title="墨 · 深色" @click="theme.set('dark')"><Icon name="moon" :size="14" /></button>
            </div>
          </div>
          <RouterLink v-if="settingsRoute" :to="settingsRoute.path" class="nav-item settings-link" :class="{ active: route.path === settingsRoute.path }" :title="settingsRoute.meta?.desc">
            <span class="icon"><Icon :name="settingsRoute.meta?.icon ?? 'sliders'" /></span>
            <span class="nav-label">{{ settingsRoute.meta?.label }}</span>
          </RouterLink>
        </div>
      </aside>

      <main class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NavRoute, routes } from './router'
import Icon from './components/Icon.vue'
import { useThemeStore } from './stores/theme'
import type { UpdateState } from '../electron/updater'

const route = useRoute()
const theme = useThemeStore()
const minimizeWindow = () => window.api.windowControls.minimize()
const toggleMaximizeWindow = () => window.api.windowControls.toggleMaximize()
const closeWindow = () => window.api.windowControls.close()
const updateState = ref<UpdateState | null>(null)
let stopUpdateListener: (() => void) | undefined

function reportWindowError(event: ErrorEvent): void {
  window.api.diagnostics.reportRendererError(`${event.message}\n${event.error?.stack ?? ''}`)
}

function reportUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason instanceof Error ? `${event.reason.message}\n${event.reason.stack ?? ''}` : String(event.reason)
  window.api.diagnostics.reportRendererError(reason)
}

const hasUpdate = computed(() => ['available', 'downloading', 'downloaded', 'error'].includes(updateState.value?.phase ?? ''))
const canRequestUpdate = computed(() => ['available', 'downloaded', 'error'].includes(updateState.value?.phase ?? ''))
const updateButtonText = computed(() => hasUpdate.value
  ? '更新到最新版本'
  : `已是最新版本 v${updateState.value?.currentVersion ?? '0.4.0'}`)
const updateButtonTitle = computed(() => {
  if (updateState.value?.phase === 'available') return `下载 MindTrace v${updateState.value.latestVersion}`
  if (updateState.value?.phase === 'downloaded') return '重启并安装已下载的更新'
  if (updateState.value?.phase === 'error') return '重新检查更新'
  return updateButtonText.value
})
const updateStatusText = computed(() => {
  const value = updateState.value
  if (!value) return '正在检查更新...'
  if (value.phase === 'idle' || value.phase === 'checking') return '正在检查更新...'
  if (value.phase === 'available') return `发现新版本 v${value.latestVersion}`
  if (value.phase === 'downloading') return `正在下载 ${value.percent ?? 0}%`
  if (value.phase === 'downloaded') return '下载完成，再次点击安装'
  if (value.phase === 'error') return `检测失败：${value.error ?? '未知错误'}`
  if (value.phase === 'unsupported') return '开发模式不检查更新'
  return ''
})

async function requestUpdate(): Promise<void> {
  if (!canRequestUpdate.value) return
  updateState.value = await window.api.updater.requestUpdate()
}

onMounted(async () => {
  window.addEventListener('error', reportWindowError)
  window.addEventListener('unhandledrejection', reportUnhandledRejection)
  stopUpdateListener = window.api.updater.onState((state: UpdateState) => { updateState.value = state })
  updateState.value = await window.api.updater.getState()
})
onBeforeUnmount(() => {
  window.removeEventListener('error', reportWindowError)
  window.removeEventListener('unhandledrejection', reportUnhandledRejection)
  stopUpdateListener?.()
})

const ORDER_KEY = 'mt-nav-order'
const movableRoutes = routes.filter(r => r.meta?.nav && r.path !== '/settings')
const settingsRoute = routes.find(r => r.path === '/settings')
const savedOrder = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === 'string') : []
  } catch { return [] as string[] }
})()
const rank = new Map(savedOrder.map((path, index) => [path, index]))
const movableNav = ref<NavRoute[]>([...movableRoutes].sort((a, b) => (rank.get(a.path) ?? 999) - (rank.get(b.path) ?? 999)))
const reorderMode = ref(false)
const draggingPath = ref<string | null>(null)
const pressingPath = ref<string | null>(null)
let holdTimer: ReturnType<typeof setTimeout> | undefined
let pressY = 0
let activePointerId: number | null = null

function clearHold(): void {
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = undefined
  pressingPath.value = null
}

function toggleReorder(): void {
  reorderMode.value = !reorderMode.value
  if (!reorderMode.value) {
    clearHold()
    draggingPath.value = null
  }
}

function startLongPress(event: PointerEvent, path: string): void {
  if (!reorderMode.value || event.button !== 0) return
  clearHold()
  pressY = event.clientY
  activePointerId = event.pointerId
  pressingPath.value = path
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  holdTimer = setTimeout(() => {
    draggingPath.value = path
    pressingPath.value = null
  }, 450)
}

function moveNavItem(event: PointerEvent): void {
  if (!reorderMode.value || activePointerId !== event.pointerId) return
  if (!draggingPath.value) {
    if (Math.abs(event.clientY - pressY) > 7) clearHold()
    return
  }
  event.preventDefault()
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-nav-path]')
  const targetPath = target?.dataset.navPath
  if (!targetPath || targetPath === draggingPath.value) return
  const from = movableNav.value.findIndex(item => item.path === draggingPath.value)
  const to = movableNav.value.findIndex(item => item.path === targetPath)
  if (from < 0 || to < 0) return
  const [moved] = movableNav.value.splice(from, 1)
  movableNav.value.splice(to, 0, moved)
}

function finishLongPress(event: PointerEvent): void {
  if (activePointerId !== event.pointerId) return
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  if (draggingPath.value) localStorage.setItem(ORDER_KEY, JSON.stringify(movableNav.value.map(item => item.path)))
  clearHold()
  draggingPath.value = null
  activePointerId = null
}

function handleNavClick(event: MouseEvent): void {
  if (reorderMode.value) event.preventDefault()
}
</script>
