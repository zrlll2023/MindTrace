import { marked } from 'marked'
import DOMPurify from 'dompurify'

export type RenderFormat = 'markdown' | 'plain'

/** 只有真正按 Markdown 存的资料才做标记解析；Office / 网页提取出的正文当 Markdown 会误伤 */
export function renderFormatFor(sourceType: string): RenderFormat {
  return /^(markdown|md)$/i.test(String(sourceType ?? '')) ? 'markdown' : 'plain'
}

// 图片资源走自定义协议，DOMPurify 默认的 URI 白名单会把它当危险协议剥掉
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|mindtrace-asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

const FORBID_TAGS = ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base', 'svg', 'math']
const FORBID_ATTR = ['srcdoc', 'style', 'formaction', 'xlink:href', 'xmlns']

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 纯文本资料：空行分段，段内换行保留，转义后不解析任何标记 */
function plainToHtml(text: string): string {
  const paragraphs = escapeHtml(text).split(/\n{2,}/)
  return paragraphs
    .map(block => `<p>${block.trim().replace(/\n/g, '<br>')}</p>`)
    .filter(block => block !== '<p></p>')
    .join('')
}

export function renderBody(text: string, format: RenderFormat): string {
  const source = String(text ?? '')
  if (!source.trim()) return ''
  const markup = format === 'markdown' ? (marked.parse(source) as string) : plainToHtml(source)
  return DOMPurify.sanitize(markup, {
    ALLOWED_URI_REGEXP,
    FORBID_TAGS,
    FORBID_ATTR,
    ADD_ATTR: ['target', 'rel']
  }) as string
}
