import { unzipSync, strFromU8 } from 'fflate'

/**
 * 办公文档纯 JS 文本提取（契约约束：禁原生模块）。
 * docx/pptx/xlsx 都是 ZIP 容器，直接解包读 XML，无需 office 套件。
 */
export type OfficeKind = 'docx' | 'pptx' | 'xlsx'

const XML_EXT = /\.(xml|rels)$/i

/** 递归找 document.xml / slideN.xml / sharedStrings.xml 等目标文件 */
export function extractText(kind: OfficeKind, files: Record<string, Uint8Array>): string {
  const parts: string[] = []
  const names = Object.keys(files).sort()

  if (kind === 'docx') {
    const xml = files['word/document.xml']
    if (xml) parts.push(paragraphs(strFromU8(xml), 'w:p', /<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
  } else if (kind === 'pptx') {
    for (const n of names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      parts.push(paragraphs(strFromU8(files[n]), null, /<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
    }
  } else if (kind === 'xlsx') {
    const sst = files['xl/sharedStrings.xml']
    if (sst) parts.push(paragraphs(strFromU8(sst), null, /<t[^>]*>([\s\S]*?)<\/t>/g))
  }

  return parts.filter(Boolean).join('\n\n')
}

function paragraphs(xml: string, _blockTag: string | null, re: RegExp): string {
  const out: string[] = []
  let m: RegExpExecArray | null
  // 重置 lastIndex（全局正则复用）
  re.lastIndex = 0
  while ((m = re.exec(xml)) !== null) {
    const t = decodeXml(m[1]).trim()
    if (t) out.push(t)
  }
  return out.join('\n')
}

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

/** 从 ZIP 字节中解包出所有文本类文件，交给 extractText */
export function unzipOffice(data: Uint8Array): Record<string, Uint8Array> {
  const all = unzipSync(data)
  const out: Record<string, Uint8Array> = {}
  for (const [name, content] of Object.entries(all)) {
    if (XML_EXT.test(name)) out[name] = content
  }
  return out
}
