export function readableUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|EAI_AGAIN|ERR_INTERNET_DISCONNECTED/i.test(raw)) return '无法连接更新服务器，请检查网络'
  if (/401|403|unauthorized|forbidden/i.test(raw)) return '更新服务器拒绝了访问'
  if (/404|latest\.yml/i.test(raw)) return '暂时找不到可用的更新信息'
  return raw.replace(/^Error:\s*/i, '').slice(0, 160) || '检查更新失败'
}
