/**
 * LLM 错误分类与用户可读提示。
 *
 * 目标：当预设模型已被服务商下线时，不要只抛一个裸的 `HTTP 400: {...}`，
 * 而要说清楚「模型可能已下线，请刷新可用模型列表」并给出动作。
 */

export type LlmErrorKind =
  | 'model-not-found'
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'server'
  | 'unknown'

export interface LlmErrorInfo {
  kind: LlmErrorKind
  /** 面向用户的简短标题 */
  title: string
  /** 面向用户的具体说明与建议动作 */
  detail: string
  /** 原始错误文本（已截断），用于展开查看 */
  raw: string
  /** 是否建议用户去刷新模型列表 */
  suggestRefreshModels: boolean
}

const MAX_RAW = 400

/** 从任意错误对象中提取可读文本 */
function rawText(error: unknown): string {
  if (typeof error === 'string') return error
  const msg = (error as Error)?.message
  return typeof msg === 'string' ? msg : String(error)
}

/**
 * 判断服务商返回体是否表示「模型不存在 / 已下线」。
 * 各家措辞不同，这里覆盖常见几种；宁可多判也不要漏判。
 */
function looksLikeModelGone(text: string): boolean {
  const t = text.toLowerCase()
  // OpenAI 兼容常见措辞
  if (t.includes('model_not_found')) return true
  if (t.includes('model not found')) return true
  if (t.includes('model does not exist')) return true
  // 「The model `xxx` does not exist」这类带反引号/引号的变体
  if (/\bmodel\b[^.]{0,80}\bdoes not exist\b/.test(t)) return true
  if (/\bmodel\b[^.]{0,80}\bnot found\b/.test(t)) return true
  if (t.includes('invalid model')) return true
  if (t.includes('unknown model')) return true
  if (t.includes('no such model')) return true
  if (t.includes('unsupported model')) return true
  if (t.includes('model is not available')) return true
  if (t.includes('model has been retired')) return true
  if (t.includes('decommissioned')) return true
  // 中文服务商常见措辞
  if (t.includes('模型不存在')) return true
  if (t.includes('模型不存在或已下线')) return true
  if (t.includes('无效的模型')) return true
  if (t.includes('不支持的模型')) return true
  if (t.includes('模型已下线')) return true
  if (t.includes('已下线')) return true
  return false
}

/** 把底层错误归类并生成用户可读提示 */
export function describeLlmError(error: unknown): LlmErrorInfo {
  const raw = rawText(error)
  const clipped = raw.length > MAX_RAW ? raw.slice(0, MAX_RAW) + '…' : raw
  const lower = raw.toLowerCase()

  if (looksLikeModelGone(raw)) {
    return {
      kind: 'model-not-found',
      title: '模型可能已下线',
      detail:
        '服务商没有找到你当前选择的模型。各家的模型会不定期下线或改名，内置预设也会随之过期。' +
        '建议点「刷新账户可用模型」拉取该账号实际可用的列表，再从中选择。',
      raw: clipped,
      suggestRefreshModels: true
    }
  }

  if (lower.includes('http 401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('api key')) {
    return {
      kind: 'auth',
      title: 'API Key 无效或未填写',
      detail: '服务商拒绝了这次请求。请检查 API Key 是否正确、是否已过期，以及是否属于当前选择的服务商。',
      raw: clipped,
      suggestRefreshModels: false
    }
  }

  if (lower.includes('http 403') || lower.includes('forbidden') || lower.includes('permission')) {
    return {
      kind: 'auth',
      title: '没有访问权限',
      detail: 'API Key 有效，但该账号没有调用这个模型或接口的权限。可能是未开通、余额不足或地域限制。',
      raw: clipped,
      suggestRefreshModels: false
    }
  }

  if (lower.includes('http 429') || lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('quota')) {
    return {
      kind: 'rate-limit',
      title: '请求过于频繁或额度不足',
      detail: '服务商限流或账户额度用尽。稍等片刻再试，或检查账户余额。',
      raw: clipped,
      suggestRefreshModels: false
    }
  }

  if (lower.includes('http 5') || lower.includes('bad gateway') || lower.includes('service unavailable') || lower.includes('internal server error')) {
    return {
      kind: 'server',
      title: '服务商暂时不可用',
      detail: '对方服务端返回了 5xx。通常不是配置问题，稍后再试即可。',
      raw: clipped,
      suggestRefreshModels: false
    }
  }

  if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('timeout') || lower.includes('network')) {
    return {
      kind: 'network',
      title: '无法连接到服务商',
      detail: '请求根本没有到达服务商。请检查网络、代理，以及 Base URL 是否正确（例如本地 Ollama 是否已启动）。',
      raw: clipped,
      suggestRefreshModels: false
    }
  }

  return {
    kind: 'unknown',
    title: 'AI 请求失败',
    detail: '发生了未预期的错误。可先尝试「刷新账户可用模型」，或检查服务商状态页。',
    raw: clipped,
    suggestRefreshModels: true
  }
}
