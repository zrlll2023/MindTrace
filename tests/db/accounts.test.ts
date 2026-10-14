import { describe, expect, it } from 'vitest'
import { initDb } from '../../electron/db/connection'
import { AccountConflictError, LinkedAccountStore } from '../../electron/db/accounts'
import type { ProviderIdentity } from '../../electron/types'

const github: ProviderIdentity = {
  provider: 'github',
  providerUserId: '111',
  login: 'zrlll2023',
  displayName: 'Zrlll',
  avatarUrl: 'https://avatars.githubusercontent.com/u/111',
  profileUrl: 'https://github.com/zrlll2023'
}

const gitee: ProviderIdentity = {
  provider: 'gitee',
  providerUserId: '222',
  login: 'zrl-gitee',
  displayName: 'Zrlll Gitee',
  avatarUrl: '',
  profileUrl: 'https://gitee.com/zrl-gitee'
}

async function store(): Promise<LinkedAccountStore> {
  return new LinkedAccountStore(await initDb(':memory:'))
}

describe('已关联账号存储', () => {
  it('关联后可按固定平台顺序列出，并给出唯一标识与指纹', async () => {
    const s = await store()
    // 故意先 gitee 后 github，验证展示顺序由平台决定而非写入顺序
    s.link(gitee, '2026-09-17T10:00:00.000Z')
    s.link(github, '2026-09-17T10:05:00.000Z')

    const accounts = s.list()
    expect(accounts.map(a => a.provider)).toEqual(['github', 'gitee'])
    expect(accounts[0]).toMatchObject({ providerUserId: '111', login: 'zrlll2023', linkedAt: '2026-09-17T10:05:00.000Z' })
    expect(s.identityKeys()).toEqual(['github:111', 'gitee:222'])
    expect(s.fingerprint()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('重复关联同一账号是幂等的：保留首次关联时间，只刷新校验时间', async () => {
    const s = await store()
    s.link(github, '2026-09-17T10:00:00.000Z')
    const again = s.link({ ...github, displayName: '改名了' }, '2026-09-18T09:00:00.000Z')

    expect(again.linkedAt).toBe('2026-09-17T10:00:00.000Z')
    expect(again.verifiedAt).toBe('2026-09-18T09:00:00.000Z')
    expect(again.displayName).toBe('改名了')
    expect(s.list()).toHaveLength(1)
  })

  it('同一平台换绑另一个账号会被唯一性闸门拦下，且不破坏原有记录', async () => {
    const s = await store()
    s.link(github, '2026-09-17T10:00:00.000Z')

    expect(() => s.link({ ...github, providerUserId: '999', login: 'someone-else' }))
      .toThrow(AccountConflictError)
    expect(() => s.link({ ...github, providerUserId: '999' }))
      .toThrow(/已关联另一个 GitHub 账号（zrlll2023）/)
    expect(s.get('github')?.providerUserId).toBe('111')
  })

  it('解除关联后账号与指纹一并回退，可重新关联', async () => {
    const s = await store()
    s.link(github)
    s.link(gitee)
    const both = s.fingerprint()

    expect(s.unlink('gitee')).toBe(true)
    expect(s.unlink('gitee')).toBe(false)
    expect(s.get('gitee')).toBeNull()
    expect(s.list().map(a => a.provider)).toEqual(['github'])
    expect(s.fingerprint()).not.toBe(both)

    s.unlink('github')
    expect(s.list()).toEqual([])
    expect(s.fingerprint()).toBe('')

    s.link(gitee, '2026-09-19T08:00:00.000Z')
    expect(s.get('gitee')?.linkedAt).toBe('2026-09-19T08:00:00.000Z')
  })

  it('唯一标识在库内保持唯一，同一外部账号不会出现两条记录', async () => {
    const s = await store()
    s.link(github)
    s.link(github)
    expect(s.list()).toHaveLength(1)
    expect(new Set(s.identityKeys()).size).toBe(1)
  })
})
