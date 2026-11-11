import type { PageCommand, PageReply } from "./page-protocol"
import { cleanPageUrl, hostPattern, pageOrigin } from "./urls"
import type { RunPage, RunState } from "../run/state"

export class NeedsUser extends Error {
  constructor(message: string, readonly tabId?: number, readonly origin?: string) {
    super(message)
  }
}

export class UnconfirmedAction extends Error {}

type PageOperation = PageCommand extends infer Command ?
  Command extends PageCommand ? Omit<Command, "channel" | "origin"> : never : never

export async function allowOrigin(run: RunState, url: string, tabId?: number): Promise<string> {
  const origin = pageOrigin(url)
  if (!origin) throw new NeedsUser("Chrome 无法访问此页面，请在浏览器中检查页面或更换 HTTPS 入口", tabId)
  if (!run.allowedOrigins.includes(origin) || !await chrome.permissions.contains({ origins: [hostPattern(origin)] })) {
    throw new NeedsUser("需要授权访问 " + origin, tabId, origin)
  }
  return origin
}

export function getPage(run: RunState, id: string): RunPage {
  const page = run.pages.find(candidate => candidate.id === id)
  if (!page) throw new Error("请使用当前任务中列出的页面 ID")
  return page
}

export async function getTab(tabId: number, windowId: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined)
  if (!tab || tab.windowId !== windowId || tab.incognito) {
    throw new NeedsUser("标签页已关闭、移动到其他窗口或无法使用", tabId)
  }
  return tab
}

async function settledTab(page: RunPage, windowId: number): Promise<chrome.tabs.Tab> {
  let tab = await getTab(page.tabId, windowId)
  const deadline = Date.now() + 6500
  while ((!tab.url || tab.status === "loading" || (tab.pendingUrl && tab.pendingUrl !== tab.url)) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250))
    tab = await getTab(page.tabId, windowId)
  }
  return tab
}

export async function pageUrl(run: RunState, page: RunPage): Promise<string> {
  const tab = await settledTab(page, run.windowId)
  const url = tab.url ?? ""
  if (page.role === "reference" && pageOrigin(url) !== page.origin) {
    throw new NeedsUser("参考页已跳转到其他站点，请返回原站点或重新选择引用", page.tabId)
  }
  await allowOrigin(run, url, page.tabId)
  return url
}

export async function sendToPage(run: RunState, page: RunPage, operation: PageOperation): Promise<PageReply> {
  const attempts = operation.kind === "observe" ? 3 : 1
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const url = await pageUrl(run, page)
    const origin = new URL(url).origin
    let documentId: string
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: page.tabId }, files: ["page.js"], world: "ISOLATED",
      })
      if (!result?.documentId) throw new Error()
      documentId = result.documentId
    } catch {
      const tab = await getTab(page.tabId, run.windowId)
      if (attempt + 1 < attempts && (tab.status === "loading" || tab.url !== url)) continue
      if (pageOrigin(tab.url ?? "") !== origin) throw new Error("页面正在跳转，请重新观察")
      throw new NeedsUser("Chrome 无法在该文档读取页面，请打开任务页检查", page.tabId)
    }

    try {
      return await chrome.tabs.sendMessage(page.tabId, {
        channel: "taberrand-page", origin, ...operation,
      } satisfies PageCommand, { documentId }) as PageReply
    } catch {
      if (operation.kind === "interact") throw new UnconfirmedAction("页面在派发后失联，请先重新观察")
      // 导航可能在注入与读取之间换掉文档。只重试观察，保留已派发动作的真实回执。
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 180))
    }
  }
  throw new Error("页面发生变化，请重新观察")
}

export async function newTaskPage(run: RunState, url: string): Promise<{ page: RunPage; groupId?: number; url: string }> {
  if (run.pages.filter(page => page.role === "task").length >= 24) throw new Error("任务标签页达到上限，请整理已有资料")
  const origin = await allowOrigin(run, url)
  let tab: chrome.tabs.Tab
  try {
    tab = await chrome.tabs.create({ windowId: run.windowId, url, active: false })
  } catch {
    throw new UnconfirmedAction("Chrome 未返回新标签页回执，请检查当前窗口")
  }
  if (tab.id === undefined) throw new UnconfirmedAction("Chrome 未返回标签页 ID，请检查当前窗口")
  const tabId = tab.id
  let groupId: number | undefined
  if (run.groupId !== undefined) {
    groupId = await chrome.tabs.group({ tabIds: [tabId], groupId: run.groupId }).catch(() => undefined)
  }
  if (groupId === undefined) {
    groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: run.windowId } }).catch(() => undefined)
    if (groupId !== undefined) {
      await chrome.tabGroups.update(groupId, { title: "TabErrand · " + run.task.slice(0, 15), color: "purple" }).catch(() => undefined)
    }
  }
  const page: RunPage = { id: crypto.randomUUID(), tabId, origin, title: new URL(url).hostname, role: "task" }
  return { page, groupId, url: cleanPageUrl(url) }
}
