import type { ToolCall } from "../agent/contracts"
import type { RunPage, RunState } from "../run/state"
import { getTab, UnconfirmedAction } from "./browser"
import { requestsTabChange } from "./tab-intent"
import { cleanPageUrl, hostPattern, pageOrigin } from "./urls"

const batchSize = 40

export async function listWindowTabs(windowId: number, offset: number, query?: string) {
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ])
  const titles = new Map(groups.map(group => [group.id, group.title]))
  const term = query?.trim().toLowerCase()
  const matching = tabs.filter(tab => tab.id !== undefined && !tab.incognito && !tab.url?.startsWith("chrome-extension://"))
    .map(tab => ({
      tabId: tab.id!, title: (tab.title || pageOrigin(tab.url ?? "") || "").slice(0, 160),
      origin: pageOrigin(tab.url ?? ""), index: tab.index,
      group: titles.get(tab.groupId), active: tab.active, pinned: tab.pinned,
    })).filter(tab => !term || [tab.title, tab.origin, tab.group].some(value => value?.toLowerCase().includes(term)))
  return {
    tabs: matching.slice(offset, offset + batchSize),
    total: matching.length,
    nextOffset: offset + batchSize < matching.length ? offset + batchSize : undefined,
  }
}

export async function referenceWindowTabs(run: RunState, ids: number[]) {
  const tabs = await Promise.all([...new Set(ids)].map(id => getTab(id, run.windowId)))
  const pages = tabs.map(tab => {
    const origin = pageOrigin(tab.url ?? "")
    if (!origin || tab.id === undefined) throw new Error("只能读取当前窗口的 HTTPS 标签页")
    const saved = run.pages.find(page => page.tabId === tab.id && page.origin === origin)
    if (saved) return saved
    return {
      id: crypto.randomUUID(), role: "reference", tabId: tab.id, origin,
      title: (tab.title || new URL(origin).hostname).slice(0, 160), url: cleanPageUrl(tab.url!),
    } satisfies RunPage
  })
  const newPages = pages.filter(page => !run.pages.some(saved => saved.id === page.id))
  const referencedIds = new Set([...run.pages, ...newPages].filter(page => page.role === "reference").map(page => page.tabId))
  if (referencedIds.size > 12) {
    throw new Error("一条任务最多引用 12 个标签页")
  }
  const origins = new Set(pages.map(page => page.origin))
  const approved = await Promise.all([...origins].map(async origin =>
    await chrome.permissions.contains({ origins: [hostPattern(origin)] }) ? origin : undefined))
  return { pages, newPages, approved: approved.filter(origin => origin !== undefined) }
}

export async function changeWindowTabs(run: RunState, args: Extract<ToolCall, { name: "manage_tabs" }>["args"]) {
  if (!requestsTabChange(run.task, args.action)) throw new Error("请在消息中指定要执行的标签页操作")
  const [first, ...rest] = [...new Set(args.tabIds)]
  if (first === undefined) throw new Error("请选择标签页")
  const ids: [number, ...number[]] = [first, ...rest]
  const explicit = run.explicitTabIds
  if (explicit?.length && ids.some(id => !explicit.includes(id)) &&
      !/(?:所有|全部|整个窗口|当前窗口|\ball\b|\bthis window\b)/i.test(run.task)) {
    throw new Error("本次操作范围是你引用的标签页")
  }
  const tabs = await Promise.all(ids.map(id => getTab(id, run.windowId)))
  if (tabs.some(tab => tab.url?.startsWith("chrome-extension://"))) throw new Error("请选择普通浏览器标签页")
  const names = tabs.map(tab => (tab.title ?? "").slice(0, 160))
  if (args.action === "group") {
    if (!args.title) throw new Error("请提供标签组名称")
    if (tabs.some(tab => tab.pinned)) throw new Error("固定标签页需先取消固定才能分组")
    const groups = await chrome.tabGroups.query({ windowId: run.windowId, title: args.title })
    const existing = groups.find(group => group.title === args.title && tabs.every(tab => tab.groupId === group.id)) ??
      (groups.length === 1 && groups[0]?.title === args.title ? groups[0] : undefined)
    const groupId = existing
      ? await chrome.tabs.group({ tabIds: ids, groupId: existing.id })
      : await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: run.windowId } })
    const group = await chrome.tabGroups.update(groupId, { title: args.title, ...(args.color && { color: args.color }) })
      .catch(() => undefined)
    if (group?.title !== args.title) throw new UnconfirmedAction("标签页已编组，Chrome 未确认组名")
    return { action: args.action, tabIds: ids, titles: names, group: group.title, groupId }
  }
  if (args.action === "ungroup") {
    await chrome.tabs.ungroup(ids)
    return { action: args.action, tabIds: ids, titles: names }
  }
  if (args.action === "activate") {
    if (ids.length !== 1) throw new Error("切换标签页时请选择一个标签页")
    const tab = await chrome.tabs.update(first, { active: true })
    if (!tab?.active) throw new UnconfirmedAction("Chrome 未确认标签页切换")
    return { action: args.action, tabIds: ids, titles: names }
  }
  if (args.index === undefined) throw new Error("请提供移动的目标位置")
  const moved = await chrome.tabs.move(ids, { windowId: run.windowId, index: args.index })
  const movedTabs = Array.isArray(moved) ? moved : [moved]
  if (!ids.every(id => movedTabs.some(tab => tab?.id === id))) throw new UnconfirmedAction("Chrome 未确认全部标签页移动")
  return { action: args.action, tabIds: ids, titles: names, positions: movedTabs.map(tab => ({ tabId: tab.id, index: tab.index })) }
}
