import type { Observation, PageCommand, PageReply } from "../src/browser/page-protocol"
import { citationPageUrl, cleanPageUrl, pageOrigin } from "../src/browser/urls"

type TargetKind = "link" | "search" | "click" | "choose"
type Target = { element: HTMLElement; kind: TargetKind }
type Snapshot = { id: string; url: string; targets: Map<string, Target> }

const query = /search|query|keyword|搜索|查找|检索|关键词|搜一搜|^搜$/i
const filter = /filter|sort|recent|latest|category|筛选|排序|综合|最新|最近|最热|类型|不限|全部|图文|视频|仅看/i
const filterLabel = /^(?:综合|最新|最近|最热|不限|全部|图文|视频|综合排序|最新发布|最多点赞|最多收藏|全部类型|筛选|排序|filter|sort|latest|recent|all)$/i
const mutation = /发布|发送|提交|删除|移除|确认|购买|支付|退出|点赞|收藏|关注|remove|delete|publish|send|confirm|purchase|unsubscribe/i
const sensitive = /password|phone|email|token|captcha|verification|手机号|邮箱|密码|验证码|支付|登录|注册/i
const actionable = 'input, textarea, select, button, [role="button"], [role="tab"], [role="searchbox"], [role="radio"], [role="checkbox"]'
const searchScope = 'search, [role="search"], form[method="get" i], [aria-label*="搜索"], [aria-label*="筛选"]'
const observerMarker = "__taberrandObserver"

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function visible(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  const style = getComputedStyle(element)
  return style.visibility === "visible" && style.opacity !== "0" && element.getClientRects().length > 0
}

function label(element: HTMLElement): string {
  const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/)
    .map(id => document.getElementById(id)?.textContent ?? "").join(" ")
  const formLabel = element instanceof HTMLInputElement || element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ? Array.from(element.labels ?? []).map(item => item.innerText).join(" ") : ""
  return compact(element.getAttribute("aria-label") || labelled || formLabel ||
    element.getAttribute("placeholder") || element.innerText || element.title || element.id).slice(0, 120)
}

function targetKind(element: HTMLElement): TargetKind | undefined {
  if (element instanceof HTMLAnchorElement) return !element.hasAttribute("download") && pageOrigin(element.href) ? "link" : undefined
  if (element.matches(":disabled, [aria-disabled='true']")) return
  const text = label(element)
  const identifiers = [text, element.id, element.getAttribute("name") ?? ""].join(" ")
  if (sensitive.test(identifiers)) return
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const searchInput = element instanceof HTMLTextAreaElement || ["text", "search"].includes(element.type)
    if (searchInput && (element.getAttribute("role") === "searchbox" || element.matches("input[type=search]") ||
        query.test(identifiers) || element.closest('search, [role="search"]'))) return "search"
  }
  if (element instanceof HTMLSelectElement) {
    return filter.test(identifiers) || element.closest(searchScope) ? "choose" : undefined
  }
  const form = element.closest("form")
  const submits = (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === "submit"
  if (submits && form && (element instanceof HTMLButtonElement || element instanceof HTMLInputElement)) {
    const method = element.hasAttribute("formmethod") ? element.formMethod : form.method
    const action = element.hasAttribute("formaction") ? element.formAction : form.action
    if (method.toLowerCase() !== "get" || pageOrigin(action) !== location.origin) return
  }
  if (element.matches('button, input[type="button"], [role="button"], [role="tab"], [role="radio"], [role="checkbox"]') &&
      (filterLabel.test(text) || (!mutation.test(identifiers) && element.closest(searchScope) &&
        (filter.test(identifiers) || query.test(identifiers))))) return "click"
  return
}

function redactText(text: string): string {
  return compact(text).replace(/https?:\/\/[^\s<>"']+/gi, match => {
    try { return cleanPageUrl(match) } catch { return "[链接]" }
  }).replace(/(?:Bearer\s+|(?:api[_-]?key|access[_-]?token|xsec_token)\s*[:=]\s*)[a-z0-9._~-]{8,}/gi, "[已省略凭据]")
}

function pageBlocker(): Observation["blocked"] {
  const dialogs = [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]')]
  for (const dialog of dialogs.filter(visible)) {
    const text = compact(dialog.innerText).slice(0, 1100)
    if (/验证码|人机验证|安全验证|verify you are human|captcha/i.test(text)) return "challenge"
    if (/扫码登录|登录后|手机号登录|sign in|log in/i.test(text)) return "login"
  }

  const content = compact(document.body?.innerText ?? "")
  if (content.length < 1600) {
    if (/人机验证|安全验证|请完成验证|verify you are human/i.test(content)) return "challenge"
    if (/登录后(?:查看|继续|搜索)|扫码登录|sign in to continue|log in to continue/i.test(content)) return "login"
  }
  return
}

function readPage(): Pick<Observation, "title" | "url" | "text" | "blocked"> {
  const root = document.querySelector<HTMLElement>("article, main, [role=main]") ?? document.body
  const title = compact(document.title || root?.querySelector("h1")?.innerText || location.hostname).slice(0, 160)
  let text = root?.innerText ?? ""
  for (const editable of root?.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], [role="textbox"]') ?? []) {
    if (editable.innerText) text = text.replaceAll(editable.innerText, "")
  }
  return { title, url: cleanPageUrl(location.href), text: redactText(text).slice(0, 5000), blocked: pageBlocker() }
}

function observe(): { observation: Observation; snapshot: Snapshot } {
  const snapshot: Snapshot = { id: crypto.randomUUID(), url: location.href, targets: new Map() }
  const observation: Observation = { observationId: snapshot.id, ...readPage(), links: [], controls: [] }
  const linkUrls = new Set<string>()
  for (const element of document.querySelectorAll<HTMLElement>(actionable + ", a[href]")) {
    if (observation.links.length >= 36 && observation.controls.length >= 24) break
    if (!visible(element)) continue
    if (element instanceof HTMLInputElement &&
        query.test([element.id, element.name, element.type].join(" ")) &&
        /登录.*(?:搜索|探索|继续|查看|更多)|(?:sign in|log in) (?:to|for)/i.test(label(element))) {
      observation.searchRequiresLogin = true
    }
    const kind = targetKind(element)
    if (!kind || (kind === "link" ? observation.links.length >= 36 : observation.controls.length >= 24)) continue
    const text = label(element)
    if (kind === "link" && (!text || linkUrls.has((element as HTMLAnchorElement).href))) continue
    const elementId = "e" + (snapshot.targets.size + 1)
    snapshot.targets.set(elementId, { element, kind })
    if (kind === "link") {
      linkUrls.add((element as HTMLAnchorElement).href)
      observation.links.push({ elementId, label: redactText(text) })
    } else {
      const options = element instanceof HTMLSelectElement ? Array.from(element.options)
        .filter(option => !option.disabled).slice(0, 25)
        .map(option => ({ label: redactText(option.label).slice(0, 100), value: "option-" + option.index })) : undefined
      observation.controls.push({ elementId, label: redactText(text || (kind === "search" ? "搜索框" : "查询控件")), kind, options })
    }
  }
  return { observation, snapshot }
}

function submitInTaskTab(element: HTMLElement, attribute: "target" | "formtarget", submit: () => void): void {
  const previous = element.getAttribute(attribute)
  element.setAttribute(attribute, "_self")
  try {
    submit()
  } finally {
    if (previous === null) element.removeAttribute(attribute)
    else element.setAttribute(attribute, previous)
  }
}

function runAction(command: Extract<PageCommand, { kind: "interact" }>, target?: Target): PageReply {
  if (command.action === "scroll") {
    window.scrollBy({ top: (command.direction === "up" ? -1 : 1) * Math.max(window.innerHeight * 0.75, 320), behavior: "instant" })
    return { ok: true, dispatched: true }
  }
  if (!target || !target.element.isConnected || !visible(target.element) ||
      target.kind !== command.action || targetKind(target.element) !== target.kind) {
    return { ok: false, reason: "目标已变化或用途不明确，请重新观察或接管" }
  }

  const node = target.element
  if (command.action === "click") {
    if ((node instanceof HTMLButtonElement || node instanceof HTMLInputElement) && node.type === "submit" && node.form) {
      submitInTaskTab(node, "formtarget", () => node.click())
    } else node.click()
    return { ok: true, dispatched: true }
  }
  if (command.action === "choose" && node instanceof HTMLSelectElement) {
    const choice = Array.from(node.options).find(option => !option.disabled && "option-" + option.index === command.value)
    if (!choice) return { ok: false, reason: "找不到可用的筛选项" }
    node.selectedIndex = choice.index
    node.dispatchEvent(new Event("change", { bubbles: true }))
    return { ok: true, dispatched: true }
  }
  if (command.action === "search" && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && command.value?.trim()) {
    const prototype = node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    setValue?.call(node, command.value)
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: command.value }))
    node.dispatchEvent(new Event("change", { bubbles: true }))
    const form = node.form
    if (form?.method === "get" && pageOrigin(form.action) === location.origin) {
      submitInTaskTab(form, "target", () => form.requestSubmit())
    } else {
      const enter = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }
      if (node.dispatchEvent(new KeyboardEvent("keydown", enter))) {
        node.dispatchEvent(new KeyboardEvent("keypress", { ...enter, charCode: 13 }))
      }
      node.dispatchEvent(new KeyboardEvent("keyup", enter))
    }
    return { ok: true, dispatched: true }
  }
  return { ok: false, reason: "查询动作参数无效" }
}

export default defineUnlistedScript(() => {
  const world = globalThis as typeof globalThis & { [observerMarker]?: boolean }
  if (world[observerMarker]) return
  world[observerMarker] = true
  let latest: Snapshot | undefined

  chrome.runtime.onMessage.addListener((command: PageCommand, sender, reply: (response: PageReply) => void) => {
    if (sender.id !== chrome.runtime.id || command?.channel !== "taberrand-page") return
    if (command.origin !== location.origin) {
      reply({ ok: false, reason: "页面已离开任务授权的站点" })
      return
    }
    if (command.kind === "observe") {
      const result = observe()
      latest = result.snapshot
      reply({ ok: true, observation: result.observation })
      return
    }
    if (!latest || latest.id !== command.observationId || latest.url !== location.href) {
      reply({ ok: false, reason: "观察已过期，请重新读取当前页面" })
      return
    }
    if (command.kind === "capture") {
      const canonical = document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href
      const url = citationPageUrl(location.href, canonical)
      if (!url) {
        reply({ ok: false, reason: "来源链接依赖临时凭据，网页未提供可导出的同页链接" })
        return
      }
      reply({ ok: true, source: { ...readPage(), url } })
      return
    }
    const target = command.elementId ? latest.targets.get(command.elementId) : undefined
    if (command.kind === "link") {
      const link = target?.element
      if (target?.kind === "link" && link instanceof HTMLAnchorElement && link.isConnected && visible(link) && targetKind(link) === "link") {
        reply({ ok: true, url: link.href })
      } else {
        reply({ ok: false, reason: "链接已变化，请重新观察" })
      }
      return
    }
    if (pageBlocker()) {
      reply({ ok: false, reason: "页面需要用户处理登录或验证" })
      return
    }
    if (!command.trigger) {
      reply(runAction(command, target))
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    // 网页主世界同步触发这次操作，控件仍由隔离世界校验和执行。
    document.addEventListener(command.trigger, event => {
      window.clearTimeout(timeout)
      if (latest?.id !== command.observationId || latest.url !== location.href) return
      if (runAction(command, target).ok) event.preventDefault()
    }, { once: true, signal: controller.signal })
    reply({ ok: true, prepared: true })
  })
})
