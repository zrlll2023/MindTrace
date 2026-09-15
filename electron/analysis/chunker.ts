/**
 * 文本分块器（Chunking，搜索质量升级 A-1）：
 * 长条目按句界切成带重叠的语义块，分别向量化，消除单向量语义稀释。
 */

export interface Chunk {
  text: string
  start: number // 块在原文中的起始偏移
}

const SENTENCE_ENDINGS = /([。！？；\n]+)/

/**
 * 将文本切分为语义块。
 * - 优先在句界（。！？；换行）切分，绝不劈开句子
 * - 无句界的超长单句按 maxLen 硬切
 * - 相邻块重叠 overlap 字符，防止语义在边界处被切断
 * - 短文本（≤maxLen）原样返回单块
 */
export function chunkText(text: string, maxLen = 400, overlap = 60): Chunk[] {
  const src = text.trim()
  if (!src) return []
  if (src.length <= maxLen) return [{ text: src, start: 0 }]

  // 先按句界切成"原子句"（保留结尾标点）
  const sentences: { text: string; start: number }[] = []
  let cursor = 0
  for (const part of src.split(SENTENCE_ENDINGS)) {
    if (!part) continue
    if (SENTENCE_ENDINGS.test(part)) {
      // 标点追加到上一句
      if (sentences.length) {
        sentences[sentences.length - 1].text += part
      }
      cursor += part.length
    } else {
      sentences.push({ text: part, start: cursor })
      cursor += part.length
    }
  }
  // 过滤空句
  const atoms = sentences.filter(s => s.text.trim())

  // 硬切超长单句
  const pieces: { text: string; start: number }[] = []
  for (const a of atoms) {
    if (a.text.length <= maxLen) {
      pieces.push(a)
    } else {
      for (let i = 0; i < a.text.length; i += maxLen) {
        pieces.push({ text: a.text.slice(i, i + maxLen), start: a.start + i })
      }
    }
  }

  // 组块：贪心装填到 maxLen；新块开头回退 overlap 字符作为重叠
  const chunks: Chunk[] = []
  let current: string[] = []
  let currentLen = 0
  let currentStart = pieces[0].start

  const flush = (endIdx: number) => {
    if (!current.length) return
    chunks.push({ text: current.join(''), start: currentStart })
    // 计算下一块的重叠：从上一块尾部回退 overlap 字符（不超过 maxLen 的一半，保证块不超限）
    const lastText = current.join('')
    const safeOverlap = Math.min(overlap, Math.floor(maxLen / 2))
    const tailStart = Math.max(0, lastText.length - safeOverlap)
    const overlapText = lastText.slice(tailStart)
    if (overlapText && overlap > 0) {
      current = [overlapText]
      currentLen = overlapText.length
      currentStart = pieces[Math.min(endIdx, pieces.length - 1)].start
    } else {
      current = []
      currentLen = 0
    }
  }

  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    if (currentLen + p.text.length > maxLen && current.length) {
      flush(i)
      if (current.length === 0) currentStart = p.start
    }
    if (current.length === 0) {
      currentStart = p.start
      current = []
      currentLen = 0
    }
    // 硬切块 + 重叠可能仍超 maxLen：将超限块自身再切（保证块长永远 ≤ maxLen）
    if (currentLen + p.text.length > maxLen) {
      const room = maxLen - currentLen
      if (room > 0) {
        current.push(p.text.slice(0, room))
        currentLen += room
      }
      flush(i)
      // 剩余部分作为下一块的起点
      const rest = p.text.slice(room)
      if (rest) {
        current = []
        currentLen = 0
        currentStart = p.start + room
        current.push(rest)
        currentLen = rest.length
      }
    } else {
      current.push(p.text)
      currentLen += p.text.length
    }
  }
  flush(pieces.length - 1)

  return chunks
}
