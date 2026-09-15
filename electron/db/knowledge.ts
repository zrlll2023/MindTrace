import { Database } from 'sql.js'

/**
 * 知识库数据层（v3）。
 * 文件夹 → 资料条目；条目携带用户的「收录原因」与「感受记录」，以及可选的 AI 总结。
 * AI 只在用户点按钮时写入 ai_summary 辅助字段，绝不垄断增删改。
 */
export interface KbFolder {
  id: number
  name: string
  description: string
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
}

export class KnowledgeBase {
  constructor(private db: Database) {}

  // ---------- folders ----------
  listFolders(): KbFolder[] {
    const r = this.db.exec('SELECT id, name, description, created_at FROM kb_folders ORDER BY id')
    if (!r.length) return []
    return r[0].values.map(v => ({
      id: v[0] as number,
      name: String(v[1] ?? ''),
      description: String(v[2] ?? ''),
      created_at: String(v[3] ?? '')
    }))
  }

  addFolder(name: string, description = ''): KbFolder {
    this.db.run('INSERT INTO kb_folders (name, description) VALUES (?, ?)', [name, description])
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    return { id, name, description, created_at: '' }
  }

  renameFolder(id: number, name: string, description?: string): void {
    if (description !== undefined) {
      this.db.run('UPDATE kb_folders SET name = ?, description = ? WHERE id = ?', [name, description, id])
    } else {
      this.db.run('UPDATE kb_folders SET name = ? WHERE id = ?', [name, id])
    }
  }

  deleteFolder(id: number): void {
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
    this.db.run(
      `INSERT INTO kb_items (folder_id, title, source_type, body, file_path, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [n.folderId, n.title, n.sourceType, n.body, n.filePath ?? '', n.reason ?? '']
    )
    const id = this.db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    return this.getItem(id)!
  }

  /** 用户编辑主体内容/标题/原因 */
  updateItem(id: number, patch: { title?: string; body?: string; reason?: string }): void {
    const cur = this.getItem(id)
    if (!cur) return
    this.db.run(
      `UPDATE kb_items SET title = ?, body = ?, reason = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [patch.title ?? cur.title, patch.body ?? cur.body, patch.reason ?? cur.reason, id]
    )
  }

  /** 用户记录感受（reflection 是用户自己的话，AI 不代写） */
  updateReflection(id: number, text: string): void {
    this.db.run(
      `UPDATE kb_items SET reflection = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`,
      [text, id]
    )
  }

  /** AI 一键总结结果（仅此字段由 AI 写入，且只在用户点按钮时） */
  updateSummary(id: number, text: string): void {
    this.db.run('UPDATE kb_items SET ai_summary = ? WHERE id = ?', [text, id])
  }

  deleteItem(id: number): void {
    this.db.run('DELETE FROM kb_items WHERE id = ?', [id])
  }
}
