import { describe, it, expect } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { KnowledgeBase } from '../../electron/db/knowledge'
import { extractText } from '../../electron/import/office'

describe('知识库存储', () => {
  it('初始化并保护 AI 快速记录系统文件夹', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const first = kb.ensureRequiredFolders()[0]
    const second = kb.ensureRequiredFolders()[0]
    expect(second.id).toBe(first.id)
    expect(second.name).toBe('AI 快速记录')
    expect(() => kb.renameFolder(first.id, '我的 AI 记录')).toThrow('不允许重命名')
    expect(() => kb.deleteFolder(first.id)).toThrow('不允许删除')
    expect(() => kb.addItem({ folderId: first.id, title: '手动资料', sourceType: 'markdown', body: '内容' }))
      .toThrow('只能通过 AI 快速记录')
    expect(kb.addItemFromQuickCapture({ folderId: first.id, title: 'AI 记录', sourceType: 'entry', body: '内容' }).id)
      .toBeGreaterThan(0)
  })

  it('系统文件夹被异常删除后可以重建', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const first = kb.ensureRequiredFolders()[0]
    db.run('DELETE FROM kb_folders WHERE id = ?', [first.id])

    const rebuilt = kb.ensureRequiredFolders()[0]
    expect(rebuilt.id).not.toBe(first.id)
    expect(rebuilt.system_key).toBe('ai_quick_capture')
    expect(() => kb.deleteFolder(rebuilt.id)).toThrow('不允许删除')
  })

  it('将历史同名目录升级为系统目录并保留资料', async () => {
    const db = await initDb(':memory:')
    db.run("INSERT INTO kb_folders (name, description) VALUES ('AI快速记录', '旧目录')")
    const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number
    db.run("INSERT INTO kb_items (folder_id, title, source_type, body) VALUES (?, '旧资料', 'text', '内容')", [id])

    const kb = new KnowledgeBase(db)
    const folder = kb.ensureRequiredFolders()[0]
    expect(folder).toMatchObject({ id, name: 'AI 快速记录', system_key: 'ai_quick_capture' })
    expect(kb.listItems(id)).toHaveLength(1)
  })

  it('拒绝创建或重命名为系统保留名称', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    expect(() => kb.addFolder('AI快速记录')).toThrow('系统保留名称')
    expect(() => kb.addFolder('  AI 快速记录  ')).toThrow('系统保留名称')
    const folder = kb.addFolder('普通目录')
    expect(() => kb.renameFolder(folder.id, 'AI  快速  记录')).toThrow('系统保留名称')
  })

  it('文件夹：创建/重命名/删除（级联删条目）', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const f1 = kb.addFolder('喜欢的句子', '句子摘抄与延伸')
    kb.addFolder('技术学习')
    expect(kb.listFolders().length).toBe(2)

    kb.renameFolder(f1.id, '句子收藏')
    expect(kb.listFolders()[0].name).toBe('句子收藏')

    const it1 = kb.addItem({ folderId: f1.id, title: '纸上得来终觉浅', sourceType: 'markdown', body: '纸上得来终觉浅，绝知此事要躬行。' })
    kb.deleteFolder(f1.id)
    expect(kb.listFolders().length).toBe(1)
    expect(kb.listItems(f1.id).length).toBe(0)
    void it1
  })

  it('条目：写入 reason/reflection/summary，按文件夹列出', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const f = kb.addFolder('阅读')
    const item = kb.addItem({ folderId: f.id, title: '我的笔记', sourceType: 'markdown', body: '# 笔记\n内容', reason: '方法值得记录' })
    expect(item.reason).toBe('方法值得记录')

    expect(kb.updateReflection(item.id, '让我意识到实践的重要性').status).toBe('saved')
    kb.updateSummary(item.id, '这篇笔记讲了……')
    const items = kb.listItems(f.id)
    expect(items[0].reflection).toContain('实践')
    expect(items[0].ai_summary).toContain('笔记')

    expect(kb.updateItem(item.id, { title: '改名', body: '新内容', reason: '新原因' }).status).toBe('saved')
    expect(kb.getItem(item.id)!.title).toBe('改名')
    expect(kb.getItem(item.id)!.updated_at.length).toBeGreaterThan(0)
  })

  it('无实质改动时如实回报 unchanged，不写库也不留痕', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const f = kb.addFolder('阅读')
    const item = kb.addItem({ folderId: f.id, title: '标题', sourceType: 'markdown', body: '正文', reason: '原因' })

    expect(kb.updateItem(item.id, { body: '正文', reason: '原因' }).status).toBe('unchanged')
    expect(kb.updateReflection(item.id, '').status).toBe('unchanged')
    expect(db.exec('SELECT updated_at FROM kb_items WHERE id = ?', [item.id])[0].values[0][0]).toBe(item.updated_at)
    expect(Number(db.exec('SELECT COUNT(*) FROM kb_events')[0].values[0][0])).toBe(1)
  })

  it('AI 快速记录的资料正文只读，但收录原因与感受仍可保存', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const folder = kb.ensureRequiredFolders()[0]
    const item = kb.addItemFromQuickCapture({
      folderId: folder.id,
      title: '记录：原内容',
      sourceType: 'entry',
      body: '原内容',
      reason: '原原因',
      sourceEntryId: 12
    })

    expect(kb.updateItem(item.id, { body: '修改后的内容' }).status).toBe('locked')
    expect(kb.getItem(item.id)!.body).toBe('原内容')
    // 同一份正文原样送回不算改动，不能因此拒掉原因的保存
    expect(kb.updateItem(item.id, { body: '原内容', reason: '修改后的原因' }).status).toBe('saved')
    expect(kb.getItem(item.id)).toMatchObject({ body: '原内容', reason: '修改后的原因' })
    expect(kb.updateReflection(item.id, '修改后的感受').status).toBe('saved')
    expect(kb.getItem(item.id)?.reflection).toBe('修改后的感受')
    expect(kb.updateItem(99999, { body: '不存在' }).status).toBe('missing')
    expect(kb.updateReflection(99999, '不存在').status).toBe('missing')
  })

  it('普通文件夹里的 AI 记录资料仍可改正文，改后同步标题前缀', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const folder = kb.addFolder('随手记')
    const item = kb.addItemFromQuickCapture({
      folderId: folder.id,
      title: '想法：原来的想法',
      sourceType: 'entry',
      body: '原来的想法'
    })
    const newBody = `新的想法 ${'很长的内容'.repeat(20)}`

    expect(kb.updateItem(item.id, { body: newBody }).status).toBe('saved')
    expect(kb.getItem(item.id)?.title).toBe(`想法：${newBody.replace(/\s+/g, ' ').slice(0, 48)}`)
  })

  it('确认过的标题不再被正文改动覆盖', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const folder = kb.addFolder('随手记')
    const item = kb.addItemFromQuickCapture({
      folderId: folder.id,
      title: '想法：原来的想法',
      sourceType: 'entry',
      body: '原来的想法'
    })

    expect(kb.setItemTitle(item.id, '  我改过的标题  ').status).toBe('saved')
    expect(kb.getItem(item.id)?.title).toBe('我改过的标题')
    kb.updateItem(item.id, { body: '正文又改了一版' })
    expect(kb.getItem(item.id)?.title).toBe('我改过的标题')
    expect(kb.setItemTitle(item.id, '   ').status).toBe('unchanged')
  })

  it('删除条目', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const f = kb.addFolder('f')
    const item = kb.addItem({ folderId: f.id, title: 't', sourceType: 'markdown', body: 'b' })
    kb.deleteItem(item.id)
    expect(kb.getItem(item.id)).toBeNull()
  })

  it('拒绝创建标题或内容为空的资料', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const folder = kb.addFolder('阅读')
    expect(() => kb.addItem({ folderId: folder.id, title: '', sourceType: 'markdown', body: '正文' })).toThrow('标题不能为空')
    expect(() => kb.addItem({ folderId: folder.id, title: '标题', sourceType: 'markdown', body: '  ' })).toThrow('资料内容不能为空')
  })

  it('新建文件夹带回真实创建时间并排在手动顺序末尾', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const first = kb.addFolder('先建的')
    const second = kb.addFolder('后建的')
    expect(first.created_at).toMatch(/^\d{4}-\d{2}-\d{2} /)
    expect(first.sort_order).not.toBeNull()
    expect(kb.listFolders().map(f => f.name)).toEqual(['先建的', '后建的'])
    expect(kb.ensureRequiredFolders()[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} /)
    void second
  })

  it('手动排序写回序号，未被点名的文件夹排在后面', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const a = kb.addFolder('A')
    const b = kb.addFolder('B')
    const c = kb.addFolder('C')

    kb.reorderFolders([c.id, a.id])
    expect(kb.listFolders().map(f => f.name)).toEqual(['C', 'A', 'B'])
    // 重复 id 只取第一次，不能把序号写出空洞
    kb.reorderFolders([b.id, b.id, c.id, a.id])
    expect(kb.listFolders().map(f => f.name)).toEqual(['B', 'C', 'A'])
    expect(kb.listFolders().map(f => f.sort_order)).toEqual([1, 2, 3])
  })

  it('文件夹标签去空去重截断限量，脏数据不阻断列表', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const folder = kb.addFolder('阅读')

    const long = '这个标签名字长得必须被截断才行'
    const saved = kb.setFolderTags(folder.id, [' 诗词 ', '诗词', '', '  ', long, '三', '四', '五', '六', '七'])
    expect(saved.tags).toEqual(['诗词', long.slice(0, 12), '三', '四', '五', '六'])
    expect(kb.getFolder(folder.id)!.tags).toEqual(saved.tags)

    kb.setFolderTags(folder.id, '不是数组')
    expect(kb.getFolder(folder.id)!.tags).toEqual([])
    db.run('UPDATE kb_folders SET tags = ? WHERE id = ?', ['{坏 JSON', folder.id])
    expect(kb.getFolder(folder.id)!.tags).toEqual([])
    expect(() => kb.setFolderTags(99999, ['x'])).toThrow('文件夹不存在')
  })

  it('资料标签同样归一化，但不推 updated_at 也不写流水', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const folder = kb.addFolder('阅读')
    const item = kb.addItem({ folderId: folder.id, title: '题', sourceType: 'markdown', body: '正文' })
    expect(item.tags).toEqual([])

    const eventsBefore = Number(db.exec('SELECT COUNT(*) FROM kb_events')[0].values[0][0])
    const saved = kb.setItemTags(item.id, [' 重读 ', '重读', '', '句子', '第三个标签名字很长很长很长'])
    expect(saved.status).toBe('saved')
    expect(saved.item!.tags).toEqual(['重读', '句子', '第三个标签名字很长很长很'])

    const after = kb.getItem(item.id)!
    expect(after.tags).toEqual(saved.item!.tags)
    expect(after.updated_at).toBe(item.updated_at)
    expect(Number(db.exec('SELECT COUNT(*) FROM kb_events')[0].values[0][0])).toBe(eventsBefore)

    // 原样再提交一次不能谎报「已保存」
    expect(kb.setItemTags(item.id, after.tags).status).toBe('unchanged')
    expect(kb.setItemTags(99999, ['x']).status).toBe('missing')

    db.run('UPDATE kb_items SET tags = ? WHERE id = ?', ['{"不是":"数组"}', item.id])
    expect(kb.getItem(item.id)!.tags).toEqual([])
  })

  it('所有系统文件夹都不可删除，普通文件夹仍可删', async () => {
    const db = await initDb(':memory:')
    const kb = new KnowledgeBase(db)
    const quick = kb.ensureRequiredFolders()[0]
    const imported = kb.ensureSystemFolder('ai_conversation_import', 'AI 对话导入')
    const mine = kb.addFolder('我的收藏')

    expect(() => kb.deleteFolder(quick.id)).toThrow('不允许删除')
    expect(() => kb.deleteFolder(imported.id)).toThrow('系统文件夹「AI 对话导入」不允许删除')
    expect(() => kb.renameFolder(quick.id, '改成别的')).toThrow('不允许重命名')
    // 其他系统文件夹只是不给删除入口，改名仍可用
    expect(kb.renameFolder(imported.id, '对话归档', '从 ChatGPT 导出的会话').name).toBe('对话归档')
    kb.deleteFolder(mine.id)
    expect(kb.listFolders().map(f => f.id)).toEqual([quick.id, imported.id])
    // 不存在的文件夹不能悄悄写一条「文件夹「未命名」被删除」的流水
    const eventsBefore = Number(db.exec('SELECT COUNT(*) FROM kb_events')[0].values[0][0])
    expect(() => kb.deleteFolder(-1)).toThrow('文件夹不存在')
    expect(Number(db.exec('SELECT COUNT(*) FROM kb_events')[0].values[0][0])).toBe(eventsBefore)
  })
})

describe('办公文档文本提取（纯 JS）', () => {
  it('docx：从 word/document.xml 提取段落', () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
      <w:p><w:r><w:t>第一段文字</w:t></w:r></w:p>
      <w:p><w:r><w:t>第二段文字</w:t></w:r></w:p>
    </w:body></w:document>`
    const zip: Record<string, Uint8Array> = {
      'word/document.xml': new TextEncoder().encode(xml)
    }
    const out = extractText('docx', zip)
    expect(out).toContain('第一段文字')
    expect(out).toContain('第二段文字')
  })

  it('pptx：每个 slide 一个换行分隔', () => {
    const zip: Record<string, Uint8Array> = {
      'ppt/slides/slide1.xml': new TextEncoder().encode('<a:t>标题一</a:t>'),
      'ppt/slides/slide2.xml': new TextEncoder().encode('<a:t>要点甲</a:t><a:t>要点乙</a:t>')
    }
    const out = extractText('pptx', zip)
    expect(out).toContain('标题一')
    expect(out).toContain('要点甲')
    expect(out.indexOf('标题一')).toBeLessThan(out.indexOf('要点甲'))
  })

  it('xlsx：共享字符串表提取', () => {
    const zip: Record<string, Uint8Array> = {
      'xl/sharedStrings.xml': new TextEncoder().encode('<sst><si><t>单元格A</t></si><si><t>单元格B</t></si></sst>')
    }
    expect(extractText('xlsx', zip)).toContain('单元格A')
  })
})
