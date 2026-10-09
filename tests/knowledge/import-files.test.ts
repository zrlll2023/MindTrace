import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { KnowledgeBase } from '../../electron/db/knowledge'
import { importKnowledgeFiles } from '../../electron/knowledge/import-files'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindtrace-kb-import-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('知识库文件导入', () => {
  it('导入有效文本并报告单个文件失败原因', async () => {
    const dir = tempDir()
    const valid = path.join(dir, '笔记.txt')
    const empty = path.join(dir, '空白.txt')
    fs.writeFileSync(valid, '值得保存的正文', 'utf8')
    fs.writeFileSync(empty, '   ', 'utf8')

    const kb = new KnowledgeBase(await initDb(':memory:'))
    const folder = kb.addFolder('阅读')
    const result = importKnowledgeFiles(kb, dir, folder.id, [valid, empty])

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ title: '笔记', body: '值得保存的正文' })
    expect(result.failures).toEqual([{ fileName: '空白.txt', error: '未提取到可用文本' }])
  })

  it('导入 markdown 时把本地图片搬进资源目录并改写引用', async () => {
    const dir = tempDir()
    const image = path.join(dir, '图.png')
    const file = path.join(dir, '带图.md')
    fs.writeFileSync(image, Buffer.from('89504e470d0a1a0a', 'hex'))
    fs.writeFileSync(file, '# 标题\n\n![配图](./图.png)\n', 'utf8')

    const kb = new KnowledgeBase(await initDb(':memory:'))
    const folder = kb.addFolder('阅读')
    const result = importKnowledgeFiles(kb, dir, folder.id, [file])

    expect(result.failures).toEqual([])
    const body = result.items[0].body
    expect(body).not.toContain('./图.png')
    expect(body).toMatch(/!\[配图\]\(mindtrace-asset:\/\/local\/[a-f0-9]{20}\.png\)/)
    expect(fs.readdirSync(path.join(dir, 'knowledge-assets'))).toHaveLength(1)
  })

  it('拒绝向 AI 快速记录文件夹导入资料', async () => {
    const dir = tempDir()
    const file = path.join(dir, '笔记.md')
    fs.writeFileSync(file, '# 正文', 'utf8')

    const kb = new KnowledgeBase(await initDb(':memory:'))
    const folder = kb.ensureRequiredFolders()[0]
    const result = importKnowledgeFiles(kb, dir, folder.id, [file])

    expect(result.items).toHaveLength(0)
    expect(result.failures[0].error).toContain('只能通过 AI 快速记录')
  })
})
