import type { Observation } from "./page-protocol"

export function requestsAccountPage(task: string): boolean {
  if (/余额接口|文档.{0,6}(?:说明|教程)|(?:余额|用量).{0,6}(?:文档|说明|教程)|定价|价格表|价目表|怎么(?:调用|充值)|如何(?:调用|充值)|\b(?:pricing|documentation|how to call)\b/i.test(task)) return false
  return /余额|账单|用量|充值记录|消费记录|我的订单|(?:账号|账户|账上).{0,12}(?:还剩|剩余|还有)|\b(?:balance|my usage|my bill|my orders|credits? remaining)\b/i.test(task)
}

export function accountEntry(observation: Observation) {
  const source = new URL(observation.url)
  const docsHost = /(?:^|[.-])(?:docs?|documentation|help|support|developers?)(?:[.-]|$)/i
  const guideTitle = /文档|帮助中心|使用指南|\b(?:docs|documentation|help center|guide)\b/i
  if (!docsHost.test(source.hostname) && !guideTitle.test(observation.title)) return
  const parent = source.hostname.split(".").slice(1).join(".")
  if (!parent.includes(".")) return

  const explicit = /开放平台|开发者平台|控制台|管理后台|账户中心|个人中心|\b(?:open platform|developer portal|dashboard|console|account center)\b/i
  const entry = observation.links.find(link => {
    if (!link.origin || link.origin === source.origin || !explicit.test(link.label)) return false
    const host = new URL(link.origin).hostname
    return host === parent || host.endsWith("." + parent)
  })
  if (entry) return { link: { observationId: observation.observationId, elementId: entry.elementId } }

  const portal = observation.links.find(link => {
    if (!link.origin || link.origin === source.origin || !/\bapi[\s_-]*keys?\b/i.test(link.label)) return false
    const host = new URL(link.origin).hostname
    return /^(?:platform|console|portal|dashboard)\./i.test(host) && host.endsWith("." + parent)
  })
  // 文档里的密钥管理链接可帮助定位官方平台。打开平台首页，再观察可见的账务入口。
  return portal?.origin ? { url: portal.origin + "/" } : undefined
}
