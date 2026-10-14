import { Database } from 'sql.js'
import { IDENTITY_PROVIDERS, IdentityProvider, LinkedAccount, ProviderIdentity } from '../types'
import { IDENTITY_PROVIDER_META, identityFingerprint, identityKey } from '../adapters/identity'

/**
 * 已关联外部账号的本机存储。
 *
 * 唯一性由三层一起保证：
 * 1. provider 是主键——同一平台在 MindTrace 里只能存在一个账号；
 * 2. identity_key 唯一——同一个平台账号不可能同时挂在两个身份上；
 * 3. 换绑必须先解除——想用另一个账号替换时给出明确冲突提示，而不是静默覆盖。
 */

/** 同一平台的账号已被另一个身份占用：必须显式解除关联后才能换绑 */
export class AccountConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountConflictError'
  }
}

const COLUMNS = 'provider, provider_user_id, login, display_name, avatar_url, profile_url, linked_at, verified_at'

function toAccount(row: unknown[]): LinkedAccount {
  return {
    provider: String(row[0]) as IdentityProvider,
    providerUserId: String(row[1]),
    login: String(row[2] ?? ''),
    displayName: String(row[3] ?? ''),
    avatarUrl: String(row[4] ?? ''),
    profileUrl: String(row[5] ?? ''),
    linkedAt: String(row[6] ?? ''),
    verifiedAt: String(row[7] ?? '')
  }
}

export class LinkedAccountStore {
  constructor(private db: Database) {}

  /** 按固定平台顺序返回，避免界面顺序随写入先后变化 */
  list(): LinkedAccount[] {
    const result = this.db.exec(`SELECT ${COLUMNS} FROM linked_accounts`)
    if (!result.length || !result[0].values.length) return []
    const accounts = result[0].values.map(toAccount)
    return accounts.sort((a, b) => IDENTITY_PROVIDERS.indexOf(a.provider) - IDENTITY_PROVIDERS.indexOf(b.provider))
  }

  get(provider: IdentityProvider): LinkedAccount | null {
    const result = this.db.exec(`SELECT ${COLUMNS} FROM linked_accounts WHERE provider = ?`, [provider])
    if (!result.length || !result[0].values.length) return null
    return toAccount(result[0].values[0])
  }

  /** 关联（或重新校验同一账号）：首次关联记录 linkedAt，之后只刷新资料与校验时间 */
  link(identity: ProviderIdentity, now = new Date().toISOString()): LinkedAccount {
    this.assertUniqueness(identity)
    this.db.run(
      `INSERT INTO linked_accounts
         (provider, provider_user_id, identity_key, login, display_name, avatar_url, profile_url, linked_at, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         provider_user_id = excluded.provider_user_id,
         identity_key = excluded.identity_key,
         login = excluded.login,
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         profile_url = excluded.profile_url,
         verified_at = excluded.verified_at`,
      [
        identity.provider,
        identity.providerUserId,
        identityKey(identity),
        identity.login,
        identity.displayName,
        identity.avatarUrl,
        identity.profileUrl,
        now,
        now
      ]
    )
    return this.get(identity.provider) as LinkedAccount
  }

  unlink(provider: IdentityProvider): boolean {
    const before = this.get(provider)
    this.db.run('DELETE FROM linked_accounts WHERE provider = ?', [provider])
    return before !== null
  }

  /** 全部账号的唯一标识（如 github:123456），供界面直接展示唯一性依据 */
  identityKeys(): string[] {
    return this.list().map(identityKey)
  }

  fingerprint(): string {
    return identityFingerprint(this.list())
  }

  private assertUniqueness(identity: ProviderIdentity): void {
    const existing = this.get(identity.provider)
    if (!existing || existing.providerUserId === identity.providerUserId) return
    const { label } = IDENTITY_PROVIDER_META[identity.provider]
    throw new AccountConflictError(
      `本机已关联另一个 ${label} 账号（${existing.login || existing.providerUserId}），请先解除关联再绑定新账号`
    )
  }
}
