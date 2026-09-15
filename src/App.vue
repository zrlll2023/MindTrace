<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"><Icon name="trace" :size="17" /></span>
        <span class="brand-text">
          <span class="brand-name">MindTrace</span>
          <span class="brand-sub">心迹追踪</span>
        </span>
      </div>

      <nav>
        <RouterLink
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
          :title="item.meta?.desc"
        >
          <span class="icon"><Icon :name="item.meta?.icon ?? 'pen'" /></span>
          <span>{{ item.meta?.label }}</span>
        </RouterLink>
      </nav>

      <div class="footer">
        <div class="local-note">
          <b>本地优先</b>数据不出设备
        </div>
        <div class="theme-toggle">
          <button
            :class="{ on: theme.mode === 'light' }"
            title="纸 · 浅色"
            @click="theme.set('light')"
          >
            <Icon name="sun" :size="14" />
          </button>
          <button
            :class="{ on: theme.mode === 'system' }"
            title="跟随系统"
            @click="theme.set('system')"
          >
            <Icon name="monitor" :size="14" />
          </button>
          <button
            :class="{ on: theme.mode === 'dark' }"
            title="墨 · 深色"
            @click="theme.set('dark')"
          >
            <Icon name="moon" :size="14" />
          </button>
        </div>
      </div>
    </aside>

    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { routes } from './router'
import Icon from './components/Icon.vue'
import { useThemeStore } from './stores/theme'

const route = useRoute()
const theme = useThemeStore()

const nav = routes.filter(r => r.meta?.nav)
</script>
