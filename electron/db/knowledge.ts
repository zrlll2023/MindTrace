import { Database } from 'sql.js'

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
    this.db.run('DELETE FROM kb_items WHERE folder_id = ?', [id])
    this.db.run('DELETE FROM kb_folders WHERE id = ?', [id])
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
    return this.getItem(id)!
  }

  /** 用户编辑主体内容/标题/原因 */
  updateItem(id: number, patch: { title?: string; body?: string; reason?: string }): boolean {
    const cur = this.getItem(id)
    if (!cur) return false
    const body = patch.body ?? cur.body
    const title = patch.title ?? (cur.source_type === 'entry' && patch.body !== undefined
      ? updatedEntryTitle(cur.title, body)
      : cur.title)
    this.db.run(
      `UPDATE kb_items SET title = ?, body = ?, reason = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [title, body, patch.reason ?? cur.reason, id]
    )
    return true
  }

  /** 用户记录感受（reflection 是用户自己的话，AI 不代写） */
  updateReflection(id: number, text: string): boolean {
    if (!this.getItem(id)) return false
    this.db.run(
      `UPDATE kb_items SET reflection = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [text, id]
    )
    return true
  }

  /** AI 一键总结结果（仅此字段由 AI 写入，且只在用户点按钮时） */
  updateSummary(id: number, text: string): void {
    this.db.run('UPDATE kb_items SET ai_summary = ? WHERE id = ?', [text, id])
  }

  deleteItem(id: number): void {
    this.db.run('DELETE FROM kb_items WHERE id = ?', [id])
  }
}
