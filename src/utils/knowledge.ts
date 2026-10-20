import type { KbFolder, KbItem } from '../../electron/types'

export const AI_QUICK_CAPTURE_FOLDER_KEY = 'ai_quick_capture'

// 与数据层 electron/db/knowledge.ts 的同名上限保持一致；
// 渲染进程不直接引主进程模块，否则 sql.js 会被卷进前端产物
export const MAX_TAG_COUNT = 6
export const MAX_TAG_LENGTH = 12

/** 标签列可能来自旧返回值或还没写过，统一容错成数组再进编辑组件 */
export function itemTags(item: KbItem | null): string[] {
  return Array.isArray(item?.tags) ? item!.tags : []
}

/** 系统文件夹由程序保证存在，界面不给删除入口 */
export function isSystemFolder(folder: KbFolder | null): boolean {
  return !!folder?.system_key
}

export function isAiQuickCaptureFolder(folder: KbFolder | null): boolean {
  return folder?.system_key === AI_QUICK_CAPTURE_FOLDER_KEY
}

/** 正文是否只读：AI 快速记录文件夹里的资料由时间线记录生成，知识库不得改写 */
export function isItemBodyLocked(item: KbItem | null, folders: KbFolder[]): boolean {
  if (!item) return false
  const folder = folders.find(candidate => candidate.id === item.folder_id)
  return isAiQuickCaptureFolder(folder ?? null)
}

const TYPE_LABELS: Record<string, string> = {
  markdown: 'Markdown',
  md: 'Markdown',
  txt: '文本',
  text: '文本',
  html: '网页',
  htm: '网页',
  docx: 'Word',
  pptx: 'PPT',
  xlsx: 'Excel',
  'ai-conversation': 'AI 对话',
  entry: 'AI 记录'
}

export function typeLabel(sourceType: string): string {
  return TYPE_LABELS[sourceType] ?? sourceType
}
