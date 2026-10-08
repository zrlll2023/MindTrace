import { Database } from 'sql.js'
import { KbAction } from '../types'

export const AI_QUICK_CAPTURE_FOLDER_KEY = 'ai_quick_capture'
export const AI_QUICK_CAPTURE_FOLDER_NAME = 'AI 快速记录'

export function normalizeFolderName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
}

export function isReservedFolderName(name: string): boolean {
  return normalizeFolderName(name) === normalizeFolderName(AI_QUICK_CAPTURE_FOLDER_NAME)
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
}

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
    const r = this.db.exec('SELECT id, name, description, system_key, created_at FROM kb_folders ORDER BY id')
    if (!r.length) return []
    return r[0].values.map(v => ({
      id: v[0] as number,
      name: String(v[1] ?? ''),
      description: String(v[2] ?? ''),
      system_key: v[3] == null ? null : String(v[3]),
      created_at: String(v[4] ?? '')
    }))
  }

  addFolder(name: string, description = ''): KbFolder {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('文件夹名不能为空')
    if (isReservedFolderName(cleanName)) throw new Error('“AI 快速记录”是系统保留名称')
    this.db.run('INSERT INTO kb_folders (name, description) VALUES (?, ?)', [cleanName, description])
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    return { id, name: cleanName, description, system_key: null, created_at: '' }
  }

  ensureSystemFolder(systemKey: string, defaultName: string): KbFolder {
    const folders = this.listFolders()
    const found = folders.find(f => f.system_key === systemKey)
    if (found) return found
    if (systemKey === AI_QUICK_CAPTURE_FOLDER_KEY) {
      const legacy = folders.find(folder => isReservedFolderName(folder.name))
      if (legacy) {
        this.db.run('UPDATE kb_folders SET name = ?, system_key = ? WHERE id = ?', [defaultName, systemKey, legacy.id])
        return { ...legacy, name: defaultName, system_key: systemKey }
      }
    }
    this.db.run('INSERT INTO kb_folders (name, description, system_key) VALUES (?, ?, ?)', [defaultName, '', systemKey])
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    return { id, name: defaultName, description: '', system_key: systemKey, created_at: '' }
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

  renameFolder(id: number, name: string, description?: string): void {
    if (this.isAiQuickCaptureFolder(id)) throw new Error('AI 快速记录文件夹不允许重命名')
    const cleanName = name.trim()
    if (!cleanName) throw new Error('文件夹名不能为空')
    if (isReservedFolderName(cleanName)) throw new Error('“AI 快速记录”是系统保留名称')
    if (description !== undefined) {
      this.db.run('UPDATE kb_folders SET name = ?, description = ? WHERE id = ?', [cleanName, description, id])
    } else {
      this.db.run('UPDATE kb_folders SET name = ? WHERE id = ?', [cleanName, id])
    }
  }

  deleteFolder(id: number): void {
    if (this.isAiQuickCaptureFolder(id)) throw new Error('AI 快速记录文件夹不允许删除')
    const folder = this.getFolder(id)
    const itemCount = this.countItems(id)
    this.db.run('DELETE FROM kb_items WHERE folder_id = ?', [id])
    this.db.run('DELETE FROM kb_folders WHERE id = ?', [id])
    // 只记一条：逐条写流水会让删除大文件夹时时间线被刷屏
    this.logEvent({ folderId: id, action: 'delete', title: `文件夹「${folder?.name ?? '未命名'}」`, detail: `连同 ${itemCount} 条资料一起删除` })
  }

  private countItems(folderId: number): number {
    const r = this.db.exec('SELECT COUNT(*) FROM kb_items WHERE folder_id = ?', [folderId])
    return Number(r[0]?.values[0]?.[0] ?? 0)
  }

  // ---------- items ----------
  private rowToItem(cols: string[], vals: unknown[]): KbItem {
    const o: Record<string, unknown> = {}
    cols.forEach((c, i) => (o[c] = vals[i]))
    return o as unknown as KbItem
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
      `INSERT INTO kb_items (folder_id, title, source_type, body, file_path, reason, source_entry_id, import_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [n.folderId, n.title, n.sourceType, n.body, n.filePath ?? '', n.reason ?? '', n.sourceEntryId ?? null, n.importKey ?? null]
    )
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    const item = this.getItem(id)!
    // 从某条记录收录而来的资料不另记流水：那条记录本身已在时间线上，并带着跳回资料的入口
    if (!n.sourceEntryId) this.logEvent({ itemId: id, folderId: n.folderId, action: n.action ?? 'collect', title: item.title })
    return item
  }

  /** 用户编辑主体内容/标题/原因；无实质变更时不写库也不留痕 */
  updateItem(id: number, patch: { title?: string; body?: string; reason?: string }): boolean {
    const cur = this.getItem(id)
    if (!cur) return false
    const body = patch.body ?? cur.body
    const reason = patch.reason ?? cur.reason
    const title = patch.title ?? (cur.source_type === 'entry' && patch.body !== undefined
      ? updatedEntryTitle(cur.title, body)
      : cur.title)
    const changed = [body !== cur.body ? '内容' : '', title !== cur.title ? '标题' : '', reason !== cur.reason ? '收录原因' : ''].filter(Boolean)
    if (!changed.length) return true
    this.db.run(
      `UPDATE kb_items SET title = ?, body = ?, reason = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [title, body, reason, id]
    )
    this.logEvent({ itemId: id, folderId: cur.folder_id, action: 'edit', title, detail: `修改了${changed.join('、')}` })
    return true
  }

  /** 用户记录感受（reflection 是用户自己的话，AI 不代写） */
  updateReflection(id: number, text: string): boolean {
    const cur = this.getItem(id)
    if (!cur) return false
    if (cur.reflection === text) return true
    this.db.run(
      `UPDATE kb_items SET reflection = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [text, id]
    )
    this.logEvent({ itemId: id, folderId: cur.folder_id, action: 'reflect', title: cur.title, detail: cur.reflection ? '修改了感受' : '' })
    return true
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
