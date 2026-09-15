import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'

export interface NavRoute {
  path: string
  name: string
  component: () => Promise<unknown>
  props?: Record<string, unknown>
  meta?: { nav?: boolean; icon?: string; label?: string; desc?: string }
}

export const routes: NavRoute[] = [
  {
    path: '/',
    name: 'capture',
    component: () => import('./views/CaptureView.vue'),
    meta: { nav: true, icon: 'pen', label: '记录', desc: '写下此刻，归档为可回溯的条目' }
  },
  {
    path: '/timeline',
    name: 'timeline',
    component: () => import('./views/TimelineView.vue'),
    meta: { nav: true, icon: 'activity', label: '时间线', desc: '按日回溯你的心迹轨迹' }
  },
  {
    path: '/reports',
    name: 'reports',
    component: () => import('./views/ReportsView.vue'),
    meta: { nav: true, icon: 'file-text', label: '报告', desc: 'AI 基于记录生成的日报与周报' }
  },
  {
    path: '/knowledge',
    name: 'knowledge',
    component: () => import('./views/KnowledgeView.vue'),
    meta: { nav: true, icon: 'book', label: '知识库', desc: '收录资料，写下原因与感受' }
  },
  {
    path: '/labs',
    name: 'labs',
    component: () => import('./views/LabsView.vue'),
    meta: { nav: true, icon: 'flask', label: '实验室', desc: '相关性分析与引导式研究' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./views/SettingsView.vue'),
    meta: { nav: true, icon: 'sliders', label: '设置', desc: 'AI 服务、外观与本地数据' }
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes
})
