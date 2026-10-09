import { Database } from 'sql.js'
import { KbAction } from '../types'

export const AI_QUICK_CAPTURE_FOLDER_KEY = 'ai_quick_capture'
export const AI_QUICK_CAPTURE_FOLDER_NAME = 'AI 快速记录'

export const MAX_TAG_COUNT = 6
export const MAX_TAG_LENGTH = 12
export const MAX_ITEM_TITLE = 200

export function normalizeFolderName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
}

export function isReservedFolderName(name: string): boolean {
  return normalizeFolderName(name) === normalizeFolderName(AI_QUICK_CAPTURE_FOLDER_NAME)
}

/** 标签统一口径：去空白、单个截断、去重、限量；非数组输入一律视为没有标签 */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const clean: string[] = []
  for (const raw of tags) {
    const tag = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH)
    if (!tag || clean.includes(tag)) continue
    clean.push(tag)
    if (clean.length >= MAX_TAG_COUNT) break
  }
  return clean
}

/** 标签以 JSON 文本存在 tags 列里（文件夹与资料同口径）；历史脏值不能让列表整体失败 */
function parseTags(raw: unknown): string[] {
  if (raw == null || raw === '') return []
  try {
    return normalizeTags(JSON.parse(String(raw)))
  } catch {
    return []
  }
}

function updatedEntryTitle(currentTitle: string, body: string): string {
  const prefix = currentTitle.match(/^(事件|对话|句子|想法|记录)：/)?.[1] ?? '记录'
  const compact = body.replace(/\s+/g, ' ').trim()
  return `${prefix}：${compact.slice(0, 48) || '未命名'}`
}

/**
 * 知识库数据层（v3）。
 * 文件夹 → 资料条目；条目携带用户的「收录原因」与「感受记录」，以及可选的 AI 总结。
 * AI 只在用户点按钮时写入 ai_summary 辅助字段，绝不垄断增删改。
 */
export interface KbFolder {
  id: number
  name: string
  description: string
  system_key: string | null
  created_at: string
  sort_order: number | null
  tags: string[]
}

export interface KbItem {
  id: number
  folder_id: number
  title: string
  source_type: string // markdown | docx | pptx | xlsx | html | text
  body: string
  file_path: string
  reason: string
  reflection: string
  ai_summary: string
  source_entry_id: number | null
  import_key: string | null
  created_at: string
  updated_at: string
  title_locked: number | null
  tags: string[]
}

/**
 * 写操作的真实结果。
 * 「无改动」必须和「已保存」分开返回：资料没变时数据层不写库也不留痕，
 * 若仍回报成功，界面就会把空点显示成「已保存」。
 */
export type KbUpdateResult =
  | { status: 'saved'; item: KbItem }
  | { status: 'unchanged'; item: KbItem }
  | { status: 'missing'; item: null }
  | { status: 'locked'; item: KbItem }

export interface NewKbItem {
  folderId: number
  title: string
  sourceType: string
  body: string
  filePath?: string
  reason?: string
  sourceEntryId?: number
  importKey?: string
  /** 操作类型；缺省为收录。文件导入与 AI 延伸另存由调用方指定 */
  action?: KbAction
}

export class KnowledgeBase {
  constructor(private db: Database) {}

  // ---------- folders ----------
  listFolders(): KbFolder[] {
    const r = this.db.exec(
      'SELECT id, name, description, system_key, created_at, sort_order, tags FROM kb_folders ORDER BY sort_order IS NULL, sort_order, id'
    )
    if (!r.length) return []
    return r[0].values.map(v => ({
      id: v[0] as number,
      name: String(v[1] ?? ''),
      description: String(v[2] ?? ''),
      system_key: v[3] == null ? null : String(v[3]),
      created_at: String(v[4] ?? ''),
      sort_order: v[5] == null ? null : Number(v[5]),
      tags: parseTags(v[6])
    }))
  }

  /** 新建的文件夹排在手动顺序末尾，不打扰用户已经排好的布局 */
  private nextFolderSortOrder(): number {
    const r = this.db.exec('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM kb_folders')
    return Number(r[0]?.values[0]?.[0] ?? 1)
  }

  addFolder(name: string, description = ''): KbFolder {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('文件夹名不能为空')
    if (isReservedFolderName(cleanName)) throw new Error('“AI 快速记录”是系统保留名称')
    this.db.run('INSERT INTO kb_folders (name, description, sort_order, tags) VALUES (?, ?, ?, ?)', [
      cleanName,
      description,
      this.nextFolderSortOrder(),
      '[]'
    ])
    return this.getFolder(this.lastInsertId())!
  }

  private lastInsertId(): number {
    return this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
  }

  ensureSystemFolder(systemKey: string, defaultName: string): KbFolder {
    const folders = this.listFolders()
    const found = folders.find(f => f.system_key === systemKey)
    if (found) return found
    if (systemKey === AI_QUICK_CAPTURE_FOLDER_KEY) {
      const legacy = folders.find(folder => isReservedFolderName(folder.name))
      if (legacy) {
        this.db.run('UPDATE kb_folders SET name = ?, system_key = ? WHERE id = ?', [defaultName, systemKey, legacy.id])
        return this.getFolder(legacy.id)!
      }
    }
    this.db.run('INSERT INTO kb_folders (name, description, system_key, sort_order) VALUES (?, ?, ?, ?)', [
      defaultName,
      '',
      systemKey,
      this.nextFolderSortOrder()
    ])
    return this.getFolder(this.lastInsertId())!
  }

  ensureRequiredFolders(): KbFolder[] {
    return [this.ensureSystemFolder(AI_QUICK_CAPTURE_FOLDER_KEY, AI_QUICK_CAPTURE_FOLDER_NAME)]
  }

  getFolder(id: number): KbFolder | null {
    return this.listFolders().find(folder => folder.id === id) ?? null
  }

  isAiQuickCaptureFolder(id: number): boolean {
    return this.getFolder(id)?.system_key === AI_QUICK_CAPTURE_FOLDER_KEY
  }

  renameFolder(id: number, name: string, description?: string): KbFolder {
    if (this.isAiQuickCaptureFolder(id)) throw new Error('AI 快速记录文件夹不允许重命名')
    const cleanName = name.trim()
    if (!cleanName) throw new Error('文件夹名不能为空')
    if (isReservedFolderName(cleanName)) throw new Error('“AI 快速记录”是系统保留名称')
    if (description !== undefined) {
      this.db.run('UPDATE kb_folders SET name = ?, description = ? WHERE id = ?', [cleanName, description, id])
    } else {
      this.db.run('UPDATE kb_folders SET name = ? WHERE id = ?', [cleanName, id])
    }
    return this.getFolder(id)!
  }

  setFolderTags(id: number, tags: unknown): KbFolder {
    if (!this.getFolder(id)) throw new Error('文件夹不存在')
    this.db.run('UPDATE kb_folders SET tags = ? WHERE id = ?', [JSON.stringify(normalizeTags(tags)), id])
    return this.getFolder(id)!
  }

  /** 按给定 id 顺序连续写回序号；没有出现在序列里的文件夹保持相对顺序排在后面 */
  reorderFolders(orderedIds: number[]): void {
    const current = this.listFolders()
    const known = new Set(current.map(folder => folder.id))
    const ordered: number[] = []
    for (const id of orderedIds) {
      if (known.has(id) && !ordered.includes(id)) ordered.push(id)
    }
    const sequence = [...ordered, ...current.map(folder => folder.id).filter(id => !ordered.includes(id))]
    this.db.run('BEGIN')
    try {
      sequence.forEach((id, index) => {
        this.db.run('UPDATE kb_folders SET sort_order = ? WHERE id = ?', [index + 1, id])
      })
      this.db.run('COMMIT')
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
  }

  deleteFolder(id: number): void {
    const folder = this.getFolder(id)
    // 不存在也照写流水的话，时间线会凭空多出一条「文件夹「未命名」被删除」
    if (!folder) throw new Error('文件夹不存在')
    if (folder.system_key) {
      throw new Error(
        folder.system_key === AI_QUICK_CAPTURE_FOLDER_KEY
          ? 'AI 快速记录文件夹不允许删除'
          : `系统文件夹「${folder.name}」不允许删除`
      )
    }
    const itemCount = this.countItems(id)
    this.db.run('DELETE FROM kb_items WHERE folder_id = ?', [id])
    this.db.run('DELETE FROM kb_folders WHERE id = ?', [id])
    // 只记一条：逐条写流水会让删除大文件夹时时间线被刷屏
    this.logEvent({ folderId: id, action: 'delete', title: `文件夹「${folder.name}」`, detail: `连同 ${itemCount} 条资料一起删除` })
  }

  private countItems(folderId: number): number {
    const r = this.db.exec('SELECT COUNT(*) FROM kb_items WHERE folder_id = ?', [folderId])
    return Number(r[0]?.values[0]?.[0] ?? 0)
  }

  // ---------- items ----------
  private rowToItem(cols: string[], vals: unknown[]): KbItem {
    const o: Record<string, unknown> = {}
    cols.forEach((c, i) => (o[c] = vals[i]))
    // tags 以 JSON 文本存列：资料查询走的是 SELECT *，不在此统一解析就会把字符串漏到界面
    return { ...o, tags: parseTags(o.tags) } as unknown as KbItem
  }

  getItem(id: number): KbItem | null {
    const r = this.db.exec('SELECT * FROM kb_items WHERE id = ?', [id])
    if (!r.length) return null
    return this.rowToItem(r[0].columns, r[0].values[0])
  }

  listItems(folderId: number): KbItem[] {
    const r = this.db.exec('SELECT * FROM kb_items WHERE folder_id = ? ORDER BY id DESC', [folderId])
    if (!r.length) return []
    return r[0].values.map(v => this.rowToItem(r[0].columns, v))
  }

  addItem(n: NewKbItem): KbItem {
    if (this.isAiQuickCaptureFolder(n.folderId)) {
      throw new Error('AI 快速记录文件夹只能通过 AI 快速记录添加内容')
    }
    return this.insertItem(n)
  }

  addItemFromQuickCapture(n: NewKbItem): KbItem {
    return this.insertItem(n)
  }

  private insertItem(n: NewKbItem): KbItem {
    if (!n.title.trim()) throw new Error('标题不能为空')
    if (!n.body.trim()) throw new Error('资料内容不能为空')
    this.db.run(
      `INSERT INTO kb_items (folder_id, title, source_type, body, file_path, reason, source_entry_id, import_key, title_locked, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '[]')`,
      [n.folderId, n.title, n.sourceType, n.body, n.filePath ?? '', n.reason ?? '', n.sourceEntryId ?? null, n.importKey ?? null]
    )
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    const item = this.getItem(id)!
    // 从某条记录收录而来的资料不另记流水：那条记录本身已在时间线上，并带着跳回资料的入口
    if (!n.sourceEntryId) this.logEvent({ itemId: id, folderId: n.folderId, action: n.action ?? 'collect', title: item.title })
    return item
  }

  /** AI 快速记录文件夹里的正文由时间线记录生成，知识库不得改写 */
  private isBodyLocked(item: KbItem): boolean {
    return this.isAiQuickCaptureFolder(item.folder_id)
  }

  /** 用户编辑主体内容/标题/原因；无实质变更时不写库也不留痕，并如实回报 unchanged */
  updateItem(id: number, patch: { title?: string; body?: string; reason?: string }): KbUpdateResult {
    const cur = this.getItem(id)
    if (!cur) return { status: 'missing', item: null }
    if (this.isBodyLocked(cur) && patch.body !== undefined && patch.body !== cur.body) {
      return { status: 'locked', item: cur }
    }
    const body = patch.body ?? cur.body
    const reason = patch.reason ?? cur.reason
    // title_locked：用户确认过标题之后，正文再改也不能把标题覆盖回正文派生的形式
    const title = patch.title ?? (cur.source_type === 'entry' && !cur.title_locked && patch.body !== undefined
      ? updatedEntryTitle(cur.title, body)
      : cur.title)
    const changed = [body !== cur.body ? '内容' : '', title !== cur.title ? '标题' : '', reason !== cur.reason ? '收录原因' : ''].filter(Boolean)
    if (!changed.length) return { status: 'unchanged', item: cur }
    this.db.run(
      `UPDATE kb_items SET title = ?, body = ?, reason = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [title, body, reason, id]
    )
    this.logEvent({ itemId: id, folderId: cur.folder_id, action: 'edit', title, detail: `修改了${changed.join('、')}` })
    return { status: 'saved', item: this.getItem(id)! }
  }

  /** 用户确认修改标题：同时锁定标题，之后改正文不再被正文派生标题覆盖 */
  setItemTitle(id: number, title: string): KbUpdateResult {
    const cur = this.getItem(id)
    if (!cur) return { status: 'missing', item: null }
    const cleanTitle = title.trim().slice(0, MAX_ITEM_TITLE)
    if (!cleanTitle) return { status: 'unchanged', item: cur }
    if (cleanTitle === cur.title) {
      if (cur.title_locked) return { status: 'unchanged', item: cur }
      this.db.run('UPDATE kb_items SET title_locked = 1 WHERE id = ?', [id])
      return { status: 'saved', item: this.getItem(id)! }
    }
    this.db.run(
      `UPDATE kb_items SET title = ?, title_locked = 1, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [cleanTitle, id]
    )
    this.logEvent({ itemId: id, folderId: cur.folder_id, action: 'edit', title: cleanTitle, detail: '修改了标题' })
    return { status: 'saved', item: this.getItem(id)! }
  }

  /**
   * 资料标签。与文件夹标签同口径：属于整理信息，不写流水也不推 updated_at，
   * 否则每加一个标签就在时间线刷一条「修改了内容」。
   */
  setItemTags(id: number, tags: unknown): KbUpdateResult {
    const cur = this.getItem(id)
    if (!cur) return { status: 'missing', item: null }
    const clean = normalizeTags(tags)
    if (clean.join('\u0000') === cur.tags.join('\u0000')) return { status: 'unchanged', item: cur }
    this.db.run('UPDATE kb_items SET tags = ? WHERE id = ?', [JSON.stringify(clean), id])
    return { status: 'saved', item: this.getItem(id)! }
  }

  /** 用户记录感受（reflection 是用户自己的话，AI 不代写） */
  updateReflection(id: number, text: string): KbUpdateResult {
    const cur = this.getItem(id)
    if (!cur) return { status: 'missing', item: null }
    if (cur.reflection === text) return { status: 'unchanged', item: cur }
    this.db.run(
      `UPDATE kb_items SET reflection = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [text, id]
    )
    this.logEvent({ itemId: id, folderId: cur.folder_id, action: 'reflect', title: cur.title, detail: cur.reflection ? '修改了感受' : '' })
    return { status: 'saved', item: this.getItem(id)! }
  }

  /** AI 一键总结结果（仅此字段由 AI 写入，且只在用户点按钮时） */
  updateSummary(id: number, text: string): void {
    const cur = this.getItem(id)
    this.db.run('UPDATE kb_items SET ai_summary = ? WHERE id = ?', [text, id])
    if (cur) this.logEvent({ itemId: id, folderId: cur.folder_id, action: 'summarize', title: cur.title, detail: 'AI 生成总结' })
  }

  deleteItem(id: number): void {
    const cur = this.getItem(id)
    this.db.run('DELETE FROM kb_items WHERE id = ?', [id])
    // 保留 item_id：时间线点进去仍能明确告知「资料已被删除」，而不是变成无响应的死行
    if (cur) this.logEvent({ itemId: id, folderId: cur.folder_id, action: 'delete', title: cur.title, detail: '资料已被删除' })
  }

  /** 记录条目 → 知识资料的反向关联；content.kbItemId 会被内容契约白名单丢弃，不可作为依据 */
  findItemsForEntries(entryIds: number[]): { entryId: number; itemId: number; title: string }[] {
    if (!entryIds.length) return []
    const found: { entryId: number; itemId: number; title: string }[] = []
    for (let i = 0; i < entryIds.length; i += 500) {
      const chunk = entryIds.slice(i, i + 500)
      const placeholders = chunk.map(() => '?').join(',')
      const r = this.db.exec(
        `SELECT id, source_entry_id, title FROM kb_items WHERE source_entry_id IN (${placeholders}) ORDER BY id DESC`,
        chunk
      )
      if (!r.length) continue
      for (const [itemId, entryId, title] of r[0].values as [number, number, string][]) {
        found.push({ entryId, itemId, title: String(title ?? '') })
      }
    }
    return found
  }

  /** 写一条操作流水；日期时间取 SQLite 本地时钟，与 created_at 同口径 */
  private logEvent(event: { itemId?: number | null; folderId?: number | null; action: KbAction; title: string; detail?: string }): void {
    const now = String(this.db.exec("SELECT datetime('now', 'localtime')")[0].values[0][0])
    this.db.run(
      `INSERT INTO kb_events (item_id, folder_id, action, item_title, detail, event_date, event_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.itemId ?? null, event.folderId ?? null, event.action, event.title, event.detail ?? '', now.slice(0, 10), now.slice(11, 16), now]
    )
  }
}
