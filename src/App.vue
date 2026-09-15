<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">MindTrace</div>
      <nav>
        <RouterLink
          v-for="item in nav"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: route.path === item.path }"
        >
          <span class="icon">{{ item.meta?.icon }}</span><span>{{ item.meta?.label }}</span>
        </RouterLink>
      </nav>
      <div class="footer">本地优先 · 数据不出设备</div>
    </aside>
    <main class="content">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { routes } from './router'

const route = useRoute()
const router = useRouter()
void router

const nav = routes.filter(r => r.meta?.nav)
</script>

<style>
/* 组件级样式已全部迁移到 src/style.css 设计系统 */
</style>
