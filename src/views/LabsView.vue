<template>
  <div class="page labs">
    <div class="page-head"><h1 class="page-title">实验室</h1><p class="page-sub">探索仍在打磨中的能力</p></div>
    <div class="badge-row"><span class="tag warn">实验功能</span><span class="hint">账号关联的校验直连平台官方接口，令牌加密保存在本机。</span></div>

    <section class="card">
      <div class="section-head">
        <div>
          <h3>账号关联</h3>
          <p class="hint">关联 GitHub / Gitee 后，MindTrace 以平台返回的不可变账号 ID 确认「你就是你」：同一平台只允许一个账号，账号一旦变化，本机身份指纹随之变化。</p>
        </div>
        <div class="account-head-tools">
          <span v-if="accountBusy" class="save-state">校验中…</span>
          <button
            v-if="accounts.length"
            class="ghost small identity-toggle"
            type="button"
            :aria-pressed="identityVisible ? 'true' : 'false'"
            :aria-label="identityVisible ? '隐藏身份信息' : '显示身份信息'"
            :title="identityVisible ? '隐藏页面上的账号 ID 与身份指纹' : '显示页面上的账号 ID 与身份指纹'"
            @click="identityVisible = !identityVisible"
          >
            <Icon :name="identityVisible ? 'eye-off' : 'eye'" :size="14" />
            {{ identityVisible ? '隐藏身份' : '显示身份' }}
          </button>
        </div>
      </div>

      <div class="identity-strip">
        <div class="identity-cell">
          <span class="identity-label">账号唯一标识</span>
          <span v-if="accounts.length" class="identity-value mono">{{ accounts.map(accountUserId).join(' · ') }}</span>
          <span v-else class="identity-value empty">尚未建立</span>
        </div>
        <div class="identity-cell">
          <span class="identity-label">本机身份指纹</span>
          <span
            v-if="accountFingerprint"
            class="identity-value mono"
            :title="identityVisible ? '' : '已隐藏，点卡片右上角「显示身份」查看'"
          >{{ identityVisible ? groupedFingerprint : maskedFingerprint }}</span>
          <span v-else class="identity-value empty">关联任一账号后生成</span>
        </div>
      </div>
      <p class="hint identity-note">指纹由全部已关联账号的唯一 ID 派生，用于日后跨设备身份比对：可以公开比对，但<b>不是密钥</b>，也不能用来登录。默认隐藏，点卡片右上角「显示身份」才展开——页面上所有账号 ID 会一起遮住，因为它就是指纹的输入。令牌只在本机加密保存，随时可解除关联并清除。</p>

      <div v-for="p in accountProviders" :key="p.id" class="provider-row">
        <div class="provider-head">
          <div class="provider-title">
            <span class="provider-name">{{ p.label }}</span>
            <span class="tag" :class="p.linked ? 'ok' : ''">{{ p.linked ? '已关联' : '未关联' }}</span>
          </div>
          <div v-if="linkedAccount(p.id)" class="provider-actions">
            <button class="ghost small" :disabled="!!accountBusy" @click="refreshAccount(p.id)">重新校验</button>
            <button class="ghost small danger-text" :disabled="!!accountBusy" @click="confirmUnlink = p.id">解除关联</button>
          </div>
        </div>

        <template v-if="linkedAccount(p.id)">
          <div class="provider-identity">
            <span class="monogram">{{ (linkedAccount(p.id)!.displayName || linkedAccount(p.id)!.login || p.label).slice(0, 1).toUpperCase() }}</span>
            <div>
              <div class="provider-login">{{ linkedAccount(p.id)!.displayName || linkedAccount(p.id)!.login }}</div>
              <div class="hint mono">唯一 ID {{ accountUserId(linkedAccount(p.id)!) }} · 最近校验 {{ formatTime(linkedAccount(p.id)!.verifiedAt) }}</div>
            </div>
          </div>
        </template>

        <template v-else>
          <p class="hint">{{ p.tokenHint }}</p>
          <div class="row token-row">
            <input
              v-model="tokens[p.id]"
              type="password"
              :placeholder="`粘贴 ${p.label} 访问令牌`"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="ghost" @click="openTokenPage(p.tokenUrl)">去获取令牌</button>
            <button class="primary" :disabled="!!accountBusy || !tokens[p.id]?.trim()" @click="linkAccount(p.id)">关联账号</button>
          </div>
        </template>

        <div v-if="confirmUnlink === p.id" class="confirm-box danger-box provider-confirm">
          <span>解除后本机删除 {{ p.label }} 凭据与账号信息，身份指纹也会改变。</span>
          <button class="danger" @click="unlinkAccount(p.id)">确认解除</button>
          <button class="ghost" @click="confirmUnlink = ''">取消</button>
        </div>
      </div>

      <p v-if="accountMsg" :class="accountOk ? 'msg ok msg-inline' : 'msg err msg-inline'">{{ accountMsg }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from '../components/Icon.vue'

type ProviderId = 'github' | 'gitee'

interface LinkedAccountRow {
  provider: ProviderId
  providerUserId: string
  login: string
  displayName: string
  /** 平台头像地址只随身份一起取回，界面刻意不加载：避免打开页面就向平台发请求 */
  avatarUrl: string
  profileUrl: string
  linkedAt: string
  verifiedAt: string
}

interface ProviderOption {
  id: ProviderId
  label: string
  tokenUrl: string
  tokenHint: string
  scopes: string
  linked: boolean
}

const accounts = ref<LinkedAccountRow[]>([])
const accountProviders = ref<ProviderOption[]>([])
const accountFingerprint = ref('')
const tokens = ref<Record<ProviderId, string>>({ github: '', gitee: '' })
const accountBusy = ref<ProviderId | ''>('')
const accountMsg = ref('')
const accountOk = ref(true)
const confirmUnlink = ref<ProviderId | ''>('')

const groupedFingerprint = computed(() => accountFingerprint.value.replace(/(.{4})/g, '$1 ').trim())
/** 身份信息默认不可见：截图、录屏、当面演示都不会带出可关联的稳定标识 */
const identityVisible = ref(false)
const maskedFingerprint = '•••• •••• •••• ••••'

/**
 * 眼睛按钮统一控制页面上所有身份标识的可见性。
 * 只藏指纹没有意义——账号唯一 ID 就是指纹的输入，所以平台行里的 ID 也一起遮住。
 */
function accountUserId(account: LinkedAccountRow): string {
  return `${account.provider}:${identityVisible.value ? account.providerUserId : '•••••••'}`
}

onMounted(() => { void loadAccounts() })

function linkedAccount(provider: ProviderId): LinkedAccountRow | undefined {
  return accounts.value.find(a => a.provider === provider)
}

function applyAccountSummary(summary: { accounts?: LinkedAccountRow[]; fingerprint?: string; providers?: ProviderOption[] }): void {
  if (summary.accounts) accounts.value = summary.accounts
  if (typeof summary.fingerprint === 'string') accountFingerprint.value = summary.fingerprint
  if (summary.providers) accountProviders.value = summary.providers
}

async function loadAccounts(): Promise<void> {
  try {
    applyAccountSummary(await window.api.accounts.summary())
  } catch (error) {
    accountOk.value = false
    accountMsg.value = `读取账号关联状态失败：${(error as Error).message}`
  }
}

function setAccountMsg(ok: boolean, message: string): void {
  accountOk.value = ok
  accountMsg.value = message
}

async function linkAccount(provider: ProviderId): Promise<void> {
  const token = tokens.value[provider]?.trim()
  if (!token) return
  accountBusy.value = provider
  try {
    const result = await window.api.accounts.link(provider, token)
    applyAccountSummary(result)
    if (result.ok) {
      tokens.value[provider] = ''
      setAccountMsg(true, `${providerLabel(provider)} 账号已关联，身份指纹已更新`)
    } else {
      setAccountMsg(false, result.error ?? '关联失败')
    }
  } catch (error) {
    setAccountMsg(false, `关联失败：${(error as Error).message}`)
  } finally {
    accountBusy.value = ''
  }
}

async function refreshAccount(provider: ProviderId): Promise<void> {
  accountBusy.value = provider
  try {
    const result = await window.api.accounts.refresh(provider)
    applyAccountSummary(result)
    setAccountMsg(!!result.ok, result.ok ? `${providerLabel(provider)} 账号校验通过` : result.error ?? '校验失败')
  } catch (error) {
    setAccountMsg(false, `校验失败：${(error as Error).message}`)
  } finally {
    accountBusy.value = ''
  }
}

async function unlinkAccount(provider: ProviderId): Promise<void> {
  accountBusy.value = provider
  confirmUnlink.value = ''
  try {
    const result = await window.api.accounts.unlink(provider)
    applyAccountSummary(result)
    setAccountMsg(!!result.ok, result.ok ? `${providerLabel(provider)} 已解除关联` : result.error ?? '解除失败')
  } catch (error) {
    setAccountMsg(false, `解除失败：${(error as Error).message}`)
  } finally {
    accountBusy.value = ''
  }
}

function providerLabel(provider: ProviderId): string {
  return accountProviders.value.find(p => p.id === provider)?.label ?? provider
}

function openTokenPage(url: string): void {
  void window.api.external.openUrl(url)
}

function formatTime(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime())
    ? '未知'
    : time.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.labs { max-width: var(--page-max); }
.badge-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
/* 高度对齐 h3 的行盒（15px × 1.4 = 21px），按钮与「账号关联」四字齐平 */
.account-head-tools { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; height: 21px; }
.account-head-tools .identity-toggle { padding: 2px 9px; }
.save-state { flex: 0 0 auto; color: var(--ok); font-size: 12px; }
.identity-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 12px; margin: 14px 0 10px; }
.identity-cell { min-width: 0; padding: 10px 12px; background: var(--surface-2); border-radius: var(--r); }
.identity-label { display: block; font-size: 11.5px; color: var(--text-3); margin-bottom: 4px; }
.identity-value { font-size: 13px; overflow-wrap: anywhere; }
.identity-value.empty { color: var(--text-3); }
.mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12.5px; letter-spacing: 0.02em; }
.identity-note { margin-bottom: 8px; }
.provider-row { padding: 14px 0; border-top: 1px solid var(--border); }
.provider-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.provider-title { display: flex; align-items: center; gap: 8px; }
.provider-name { font-weight: 600; font-size: 14px; }
.provider-identity { display: flex; align-items: center; gap: 10px; }
/* 不加载平台头像：打开实验室页不再向 GitHub / Gitee 发请求，改用字母圆牌 */
.monogram { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-weak); color: var(--accent-text); font-weight: 600; font-size: 14px; }
.provider-login { font-size: 13.5px; }
.token-row { margin-top: 8px; }
.token-row input { flex: 1 1 220px; width: auto; }
.provider-actions { display: flex; flex: 0 0 auto; gap: 4px; }
.danger-text { color: var(--danger); }
.danger-text:hover:not(:disabled) { background: var(--danger-weak); color: var(--danger); }
.provider-confirm { margin-top: 10px; }
.confirm-box { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px; border: 1px solid var(--border); border-radius: var(--r); background: var(--surface-2); }
.confirm-box span { flex: 1; color: var(--text-2); }
.danger-box { border-color: var(--danger); background: var(--danger-weak); }
.msg-inline { display: inline-block; margin: 14px 0 0; }

@media (max-width: 720px) {
  .section-head, .confirm-box { align-items: stretch; flex-direction: column; }
  .save-state { align-self: flex-start; }
  .account-head-tools { align-self: flex-start; height: auto; }
  .identity-strip { grid-template-columns: 1fr; }
  .provider-head { flex-direction: column; }
  .token-row input { flex: 1 1 100%; }
  .provider-actions { flex-wrap: wrap; }
}
</style>
