import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ASSET_SCHEME = 'mindtrace-asset'
export const ASSET_HOST = 'local'

const ASSET_DIR_NAME = 'knowledge-assets'
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'])
const ASSET_NAME_PATTERN = /^[a-f0-9]{20}\.[a-z]{3,4}$/
const MARKDOWN_IMAGE_REF = /(!\[[^\]]*\]\()\s*(<[^>]*>|[^)\s]+)(\s+[^)]*)?(\))/g

/** 图片落在数据目录下的独立文件夹：sql.js 每次保存都全量重写整库，二进制不能进数据库 */
export function knowledgeAssetsDir(dataDir: string): string {
  return path.join(dataDir, ASSET_DIR_NAME)
}

export function assetUrl(name: string): string {
  return `${ASSET_SCHEME}://${ASSET_HOST}/${encodeURIComponent(name)}`
}

/**
 * 从请求地址取出资源文件名。
 * 这里刻意不用 new URL：自定义 scheme 是否被解析成带 host 的标准 URL 取决于特权注册的时序，
 * 直接按字符串剥掉 scheme 与第一段 authority 更稳，两种形状都能取到同一个名字。
 */
export function assetNameFromUrl(url: string): string {
  const text = String(url ?? '')
  const authorityStart = text.indexOf('://')
  if (authorityStart < 0) return ''
  const afterScheme = text.slice(authorityStart + 3)
  const slash = afterScheme.indexOf('/')
  if (slash < 0) return ''
  const rest = afterScheme.slice(slash + 1).split(/[?#]/)[0]
  try {
    return decodeURIComponent(rest)
  } catch {
    return rest
  }
}

export function normalizeExtension(ext: string): string {
  const clean = String(ext ?? '').toLowerCase().replace(/^\./, '').replace(/[^a-z0-9]/g, '')
  if (clean === 'jpe' || clean === 'jfif') return 'jpg'
  return ALLOWED_EXTENSIONS.has(clean) ? clean : 'png'
}

/** 内容寻址：同一张图只落盘一次；写入不依赖资料 id，导入时可以在入库前就改好正文 */
export function writeAsset(dataDir: string, bytes: Uint8Array, ext: string): { name: string; url: string } {
  if (!bytes.length) throw new Error('图片内容为空')
  const name = `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${normalizeExtension(ext)}`
  const dir = knowledgeAssetsDir(dataDir)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, name)
  if (!fs.existsSync(target)) fs.writeFileSync(target, Buffer.from(bytes))
  return { name, url: assetUrl(name) }
}

/** 协议只认资源目录下的单个哈希文件名，任何路径分隔符或穿越都直接拒绝 */
export function resolveAssetPath(dataDir: string, requestPath: string): string | null {
  const name = path.basename(String(requestPath ?? '').split(/[?#]/)[0])
  if (!ASSET_NAME_PATTERN.test(name)) return null
  const dir = path.resolve(knowledgeAssetsDir(dataDir))
  const abs = path.resolve(dir, name)
  return abs.startsWith(dir + path.sep) ? abs : null
}

function decodeRef(target: string): string | null {
  const raw = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
  if (!raw) return null
  try {
    return raw.includes('%') ? decodeURIComponent(raw) : raw
  } catch {
    return null
  }
}

function isLocalImagePath(target: string): boolean {
  const scheme = target.match(/^[a-z][a-z0-9+.-]*:/i)?.[0]
  if (!scheme) return !target.startsWith('#')
  return scheme.toLowerCase() === 'file:'
}

/**
 * 把 markdown 正文里的本地图片搬进资源目录并改写为自定义协议地址。
 * 不改写 http(s)/data 等远程引用；源文件缺失时原样保留，导入不能因为一张图失败。
 */
export function localizeMarkdownImages(
  dataDir: string,
  sourceDir: string,
  body: string
): { body: string; localized: number } {
  let localized = 0
  const rewritten = body.replace(MARKDOWN_IMAGE_REF, (whole, head: string, rawTarget: string, tail: string | undefined, close: string) => {
    const target = decodeRef(rawTarget)
    if (!target || !isLocalImagePath(target)) return whole
    const abs = target.toLowerCase().startsWith('file:') ? safeFileToPath(target) : path.resolve(sourceDir, target.replace(/\\/g, '/'))
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return whole
    try {
      const { url } = writeAsset(dataDir, new Uint8Array(fs.readFileSync(abs)), path.extname(abs))
      localized += 1
      return `${head}${url}${tail ?? ''}${close}`
    } catch {
      return whole
    }
  })
  return { body: rewritten, localized }
}

function safeFileToPath(target: string): string | null {
  try {
    return fileURLToPath(target)
  } catch {
    return null
  }
}
