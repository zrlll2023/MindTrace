import { KIND_LABELS, EntryKind } from '../../electron/types'

/**
 * 去掉 KIND_LABELS 前缀的 emoji，得到纯文字标签。
 * 新设计的类型标识改用语义色点，不再依赖 emoji。
 */
export const KIND_PLAIN: Record<EntryKind, string> = Object.fromEntries(
  Object.entries(KIND_LABELS).map(([k, v]) => [
    k,
    String(v).replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '')
  ])
) as Record<EntryKind, string>

/** 记录类型 → 语义色 class（对应 style.css 中的 .k-* 变量组） */
export function kindClass(kind: string): string {
  return `k-${kind in KIND_LABELS ? kind : 'other'}`
}

/** 记录类型 → 纯文字标签 */
export function kindLabel(kind: string): string {
  return KIND_PLAIN[kind as EntryKind] ?? kind
}
