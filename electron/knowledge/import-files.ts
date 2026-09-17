import fs from 'node:fs'
import path from 'node:path'
import { KbItem, KnowledgeBase } from '../db/knowledge'
import { extractText, unzipOffice } from '../import/office'

const SUPPORTED_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'html', 'htm', 'docx', 'pptx', 'xlsx'])

export interface KnowledgeImportFailure {
  fileName: string
  error: string
}

export interface KnowledgeImportResult {
  items: KbItem[]
  failures: KnowledgeImportFailure[]
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '无法读取或解析文件'
}

function stripHtml(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function importKnowledgeFiles(
  kb: KnowledgeBase,
  folderId: number,
  filePaths: string[],
  reason?: string
): KnowledgeImportResult {
  const items: KbItem[] = []
  const failures: KnowledgeImportFailure[] = []

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath)
    try {
      const ext = path.extname(filePath).toLowerCase().replace('.', '')
      if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error('不支持此文件类型')

      const sourceType = ext === 'markdown' ? 'markdown' : ext
      let body: string
      if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
        body = extractText(ext, unzipOffice(new Uint8Array(fs.readFileSync(filePath))))
      } else {
        const source = fs.readFileSync(filePath, 'utf8')
        body = ext === 'html' || ext === 'htm' ? stripHtml(source) : source
      }
      if (!body.trim()) throw new Error('未提取到可用文本')

      items.push(kb.addItem({
        folderId,
        title: path.basename(filePath, path.extname(filePath)),
        sourceType,
        body,
        filePath,
        reason: reason?.trim() ?? ''
      }))
    } catch (error) {
      failures.push({ fileName, error: readableError(error) })
    }
  }

  return { items, failures }
}
