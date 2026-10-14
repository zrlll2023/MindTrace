import crypto from 'node:crypto'
import { IdentityProvider, ProviderIdentity } from '../types'

/**
 * 外部账号身份校验（GitHub / Gitee）。
 *
 * 设计要点：
 * - 唯一性判定只认平台返回的不可变数字 ID（providerUserId），不认可能改名的登录名；
 * - 一切校验在本机直连平台官方 API 完成，不经过任何中间服务器；
 * - 令牌本身不落在这里，由 SecretBox 加密保存，本模块只做一次「读身份」的请求。
 *
 * fetch 可注入，便于用假响应覆盖成功/失败分支而不联网。
 */

export interface IdentityProviderMeta {
  id: IdentityProvider
  label: string
  tokenUrl: string
  tokenHint: string
  scopes: string
}

export const IDENTITY_PROVIDER_META: Record<IdentityProvider, IdentityProviderMeta> = {
  github: {
    id: 'github',
    label: 'GitHub',
    tokenUrl: 'https://github.com/settings/tokens/new?scopes=read:user&description=MindTrace',
    tokenHint: '只需 read:user 权限：只读取账号身份，不读取任何仓库内容',
    scopes: 'read:user'
  },
  gitee: {
    id: 'gitee',
    label: 'Gitee',
    tokenUrl: 'https://gitee.com/profile/personal_access_tokens/new',
    tokenHint: '只需 user_info 权限：只读取账号身份，不读取任何仓库内容',
    scopes: 'user_info'
  }
}

export type IdentityFetchResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type IdentityFetch = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<IdentityFetchResponse>

/** 令牌无效、权限不足、网络不通等可预期失败；message 直接面向用户 */
export class IdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityError'
  }
}

/** 账号唯一性判定的稳定键：同一平台的同一账号永远得到同一个值 */
export function identityKey(identity: Pick<ProviderIdentity, 'provider' | 'providerUserId'>): string {
  return `${identity.provider}:${identity.providerUserId}`
}

/**
 * 本机身份指纹：由全部已关联账号的唯一键排序后哈希得到。
 * 集合完全相同则指纹相同；增删任一平台账号都会改变指纹，便于日后判定「这台设备还是不是同一个人」。
 */
export function identityFingerprint(accounts: Pick<ProviderIdentity, 'provider' | 'providerUserId'>[]): string {
  if (!accounts.length) return ''
  const keys = accounts.map(identityKey).sort()
  return crypto.createHash('sha256').update(keys.join('|')).digest('hex')
}

/** 把 64 位指纹按 4 位一组切开，供界面展示与人工比对 */
export function formatFingerprint(fingerprint: string): string {
  return fingerprint.replace(/(.{4})/g, '$1 ').trim()
}

function normalizeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  if (typeof value === 'string' && value.trim()) return value.trim()
  return ''
}

function describeFailure(provider: IdentityProvider, status: number): string {
  const { label } = IDENTITY_PROVIDER_META[provider]
  if (status === 401) return `${label} 令牌无效或已被撤销，请重新生成后再试`
  if (status === 403) return `${label} 拒绝了这次校验（403），请确认令牌权限足够且未超出调用频率`
  if (status === 404) return `${label} 未找到该账号，请确认令牌是否仍然有效`
  if (status >= 500) return `${label} 服务暂时不可用（${status}），请稍后重试`
  return `校验 ${label} 账号失败（HTTP ${status}）`
}

async function readIdentityPayload(
  provider: IdentityProvider,
  url: string,
  headers: Record<string, string>,
  fetchImpl: IdentityFetch
): Promise<Record<string, unknown>> {
  const { label } = IDENTITY_PROVIDER_META[provider]
  let response: IdentityFetchResponse
  try {
    response = await fetchImpl(url, { headers })
  } catch {
    throw new IdentityError(`无法连接 ${label}，请检查网络后重试`)
  }
  if (!response.ok) throw new IdentityError(describeFailure(provider, response.status))
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new IdentityError(`${label} 返回了无法解析的数据，请稍后重试`)
  }
  if (!payload || typeof payload !== 'object') {
    throw new IdentityError(`${label} 返回了无法解析的数据，请稍后重试`)
  }
  return payload as Record<string, unknown>
}

function toIdentity(
  provider: IdentityProvider,
  payload: Record<string, unknown>,
  accountHome: string
): ProviderIdentity {
  const { label } = IDENTITY_PROVIDER_META[provider]
  const providerUserId = normalizeId(payload.id)
  if (!providerUserId) {
    throw new IdentityError(`${label} 返回的数据缺少账号唯一 ID，为避免身份判错已中止关联`)
  }
  const login = normalizeText(payload.login)
  return {
    provider,
    providerUserId,
    login,
    displayName: normalizeText(payload.name, login),
    avatarUrl: normalizeText(payload.avatar_url),
    profileUrl: normalizeText(payload.html_url, `${accountHome}/${login}`)
  }
}

/** GitHub：GET /user，需要 read:user；返回的 id 是全局不可变账号 ID */
export async function fetchGithubIdentity(token: string, fetchImpl: IdentityFetch = fetch): Promise<ProviderIdentity> {
  const payload = await readIdentityPayload(
    'github',
    'https://api.github.com/user',
    {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'MindTrace'
    },
    fetchImpl
  )
  return toIdentity('github', payload, 'https://github.com')
}

/** Gitee：GET /api/v5/user，需要 user_info；返回的 id 同样是不可变账号 ID */
export async function fetchGiteeIdentity(token: string, fetchImpl: IdentityFetch = fetch): Promise<ProviderIdentity> {
  const payload = await readIdentityPayload(
    'gitee',
    `https://gitee.com/api/v5/user?access_token=${encodeURIComponent(token)}`,
    { Accept: 'application/json', 'User-Agent': 'MindTrace' },
    fetchImpl
  )
  return toIdentity('gitee', payload, 'https://gitee.com')
}

/** 校验令牌并取回权威身份；令牌为空或过长直接拒绝，不发起请求 */
export async function verifyIdentity(
  provider: IdentityProvider,
  token: string,
  fetchImpl: IdentityFetch = fetch
): Promise<ProviderIdentity> {
  const { label } = IDENTITY_PROVIDER_META[provider]
  const trimmed = token.trim()
  if (!trimmed) throw new IdentityError(`请先填写 ${label} 访问令牌`)
  if (trimmed.length > 512) throw new IdentityError(`${label} 访问令牌长度异常，请确认是否粘贴完整`)
  return provider === 'github'
    ? fetchGithubIdentity(trimmed, fetchImpl)
    : fetchGiteeIdentity(trimmed, fetchImpl)
}
