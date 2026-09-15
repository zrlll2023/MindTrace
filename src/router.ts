import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'

export interface NavRoute {
  path: string
  name: string
  component: () => Promise<unknown>
  props?: Record<string, unknown>
  meta?: { nav?: boolean; icon?: string; label?: string }
}

export const routes: NavRoute[] = [
  {
    path: '/',
    name: 'capture',
    component: () => import('./views/CaptureView.vue'),
    meta: { nav: true, icon: '💬', label: '记录' }
  },
  {
    path: '/timeline',
    name: 'timeline',
    component: () => import('./views/TimelineView.vue'),
    meta: { nav: true, icon: '🗓️', label: '时间线' }
  },
  {
    path: '/reports',
    name: 'reports',
    component: () => import('./views/ReportsView.vue'),
    meta: { nav: true, icon: '📊', label: '报告' }
  },
  {
    path: '/labs',
    name: 'labs',
    component: () => import('./views/LabsView.vue'),
    meta: { nav: true, icon: '🧪', label: '实验室' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./views/SettingsView.vue'),
    meta: { nav: true, icon: '⚙️', label: '设置' }
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})
