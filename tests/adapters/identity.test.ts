import { describe, expect, it } from 'vitest'
import {
  IdentityError,
  fetchGiteeIdentity,
  fetchGithubIdentity,
  formatFingerprint,
  identityFingerprint,
  identityKey,
  verifyIdentity
} from '../../electron/adapters/identity'

type Call = { url: string; headers: Record<string, string> | undefined }

/** 假 fetch：记录请求并按给定状态与载荷回应，测试全程不联网 */
function fakeFetch(status: number, payload: unknown) {
  const calls: Call[] = []
  const impl = async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers })
    return { ok: status >= 200 && status < 300, status, json: async () => payload }
  }
  return { impl, calls }
}

function failingFetch(error: Error) {
  const state = { called: 0 }
  const impl = async () => {
    state.called++
    throw error
  }
  return { impl, state }
}

const githubPayload = {
  id: 1234567,
  login: 'zrlll2023',
  name: 'Zrlll',
  avatar_url: 'https://avatars.githubusercontent.com/u/1234567',
  html_url: 'https://github.com/zrlll2023'
}

const giteePayload = {
  id: 998877,
  login: 'zrl-gitee',
  name: 'Zrlll Gitee',
  avatar_url: 'https://gitee.com/assets/998877.png',
  html_url: 'https://gitee.com/zrl-gitee'
}

describe('外部账号身份校验', () => {
  it('GitHub：用只读令牌取回不可变账号 ID 与资料', async () => {
    const { impl, calls } = fakeFetch(200, githubPayload)
    const identity = await verifyIdentity('github', ' ghp_abc ', impl)

    expect(identity).toEqual({
      provider: 'github',
      providerUserId: '1234567',
      login: 'zrlll2023',
      displayName: 'Zrlll',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1234567',
      profileUrl: 'https://github.com/zrlll2023'
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.github.com/user')
    expect(calls[0].headers?.Authorization).toBe('Bearer ghp_abc')
    expect(calls[0].headers?.Accept).toBe('application/vnd.github+json')
  })

  it('GitHub：缺 name / html_url 时回退到登录名，不返回空身份', async () => {
    const { impl } = fakeFetch(200, { id: 7, login: 'solo' })
    const identity = await fetchGithubIdentity('token', impl)
    expect(identity.displayName).toBe('solo')
    expect(identity.profileUrl).toBe('https://github.com/solo')
    expect(identity.avatarUrl).toBe('')
  })

  it('Gitee：令牌走查询参数，返回权威 ID', async () => {
    const { impl, calls } = fakeFetch(200, giteePayload)
    const identity = await fetchGiteeIdentity('gitee-token', impl)

    expect(calls[0].url).toBe('https://gitee.com/api/v5/user?access_token=gitee-token')
    expect(identity.provider).toBe('gitee')
    expect(identity.providerUserId).toBe('998877')
    expect(identity.profileUrl).toBe('https://gitee.com/zrl-gitee')
  })

  it('令牌无效或权限不足时给出可执行的中文提示', async () => {
    await expect(verifyIdentity('github', 'bad', fakeFetch(401, {}).impl)).rejects.toThrow(IdentityError)
    await expect(verifyIdentity('github', 'bad', fakeFetch(401, {}).impl)).rejects.toThrow(/令牌无效/)
    await expect(verifyIdentity('gitee', 'bad', fakeFetch(403, {}).impl)).rejects.toThrow(/403/)
    await expect(verifyIdentity('gitee', 'bad', fakeFetch(404, {}).impl)).rejects.toThrow(/未找到该账号/)
    await expect(verifyIdentity('github', 'bad', fakeFetch(502, {}).impl)).rejects.toThrow(/暂时不可用/)
  })

  it('网络不通与响应异常都不产生半截身份', async () => {
    await expect(verifyIdentity('github', 't', failingFetch(new Error('ENOTFOUND')).impl)).rejects.toThrow(/无法连接 GitHub/)
    const broken = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
    await expect(verifyIdentity('gitee', 't', broken)).rejects.toThrow(/无法解析/)
  })

  it('缺少账号唯一 ID 时中止关联，避免身份判错', async () => {
    const { impl } = fakeFetch(200, { login: 'anonymous' })
    await expect(verifyIdentity('github', 't', impl)).rejects.toThrow(/缺少账号唯一 ID/)
  })

  it('空令牌与异常长令牌不发请求', async () => {
    const { impl, state } = failingFetch(new Error('should not be called'))
    await expect(verifyIdentity('github', '   ', impl)).rejects.toThrow(/请先填写 GitHub 访问令牌/)
    await expect(verifyIdentity('gitee', 'x'.repeat(513), impl)).rejects.toThrow(/长度异常/)
    expect(state.called).toBe(0)
  })
})

describe('账号唯一性判定', () => {
  it('唯一标识由平台与不可变账号 ID 组成', () => {
    expect(identityKey({ provider: 'github', providerUserId: '1234567' })).toBe('github:1234567')
    expect(identityKey({ provider: 'gitee', providerUserId: '998877' })).toBe('gitee:998877')
  })

  it('指纹与账号顺序无关，账号变化即变化', () => {
    const github = { provider: 'github' as const, providerUserId: '111' }
    const gitee = { provider: 'gitee' as const, providerUserId: '222' }

    expect(identityFingerprint([])).toBe('')
    const onlyGithub = identityFingerprint([github])
    expect(onlyGithub).toMatch(/^[0-9a-f]{64}$/)
    expect(identityFingerprint([github, gitee])).toBe(identityFingerprint([gitee, github]))
    expect(identityFingerprint([github, gitee])).not.toBe(onlyGithub)
    // 换绑到另一个账号必须换指纹，否则无法区分「同一个人」
    expect(identityFingerprint([{ provider: 'github', providerUserId: '111' }, gitee]))
      .not.toBe(identityFingerprint([{ provider: 'github', providerUserId: '999' }, gitee]))
  })

  it('指纹按 4 位分组便于人工比对', () => {
    expect(formatFingerprint('abcdefghij')).toBe('abcd efgh ij')
  })
})
