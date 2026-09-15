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
          <span class="icon">{{ item.meta?.icon }}</span>{{ item.meta?.label }}
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
body { margin: 0; font-family: 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif; background: #f6f7f9; color: #1f2328; }
.layout { display: flex; min-height: 100vh; }
.sidebar {
  width: 200px; background: #1b1f27; color: #dfe3ea; display: flex; flex-direction: column;
  padding: 18px 12px; box-sizing: border-box;
}
.brand { font-size: 18px; font-weight: 700; padding: 0 10px 16px; letter-spacing: .5px; }
nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item {
  display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 8px;
  color: #b9c0cc; text-decoration: none; font-size: 14px;
}
.nav-item:hover { background: #2a3040; color: #fff; }
.nav-item.active { background: #4f7cff; color: #fff; }
.icon { width: 20px; text-align: center; }
.footer { font-size: 11px; color: #6b7280; padding: 10px; }
.content { flex: 1; padding: 24px 28px; overflow-y: auto; }
</style>
