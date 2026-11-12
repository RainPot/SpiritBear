import { parseToolCall, requestedSourceCount } from "../src/agent/contracts"
import { attachmentSummary, validateAttachments } from "../src/agent/attachments"
import { isProviderId } from "../src/agent/provider"
import { evidenceDraft, replyMarkdown } from "../src/agent/report"
import { getPage, getTab, NeedsUser, UnconfirmedAction } from "../src/browser/browser"
import { requiresSearchBox } from "../src/browser/search-proof"
import { cleanPageUrl, hostPattern, pageOrigin } from "../src/browser/urls"
import { getExtensionActionTitle, getExtensionName } from "../src/extension-name"
import { readUiLanguage, resolveUiLanguage, uiLanguageKey, type UiLanguage } from "../src/i18n"
import { executeStep, toolLabels } from "../src/run/execute"
import { requestsMarkdown } from "../src/run/intent"
import { changeRun, clearRuns, createRun, getRun, listRuns } from "../src/run/store"
import { addEvent, conversationId, pageActionLabels, type MarkdownExport, type PageRef, type PanelCommand, type PanelReply, type PanelRequest, type RunHistory, type RunPage, type RunState, type StartInput, type ToolResult } from "../src/run/state"

const workerEpoch = crypto.randomUUID()
const owners = new Map<string, chrome.runtime.Port>()
let currentSession: Promise<string> | undefined

function sessionId(): Promise<string> {
  return currentSession ??= (async () => {
    const { taberrandSession } = await chrome.storage.session.get("taberrandSession")
    if (typeof taberrandSession === "string") return taberrandSession
    const id = crypto.randomUUID()
    await chrome.storage.session.set({ taberrandSession: id })
    return id
  })()
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "执行失败，请查看任务记录"
}

function post(port: chrome.runtime.Port, message: PanelReply): void {
  try { port.postMessage(message) } catch { /* 侧栏可能已关闭。 */ }
}

function announce(run: RunState): RunState {
  for (const port of owners.values()) post(port, { event: "updated", run })
  return run
}

function own(run: RunState, owner: string): void {
  if (!owners.has(owner) || run.status !== "running" || run.owner !== owner) throw new Error("这条任务已暂停或由另一个侧栏运行")
}

async function updateDownload(runId: string, id: number): Promise<RunState> {
  const [item] = await chrome.downloads.search({ id })
  const run = await changeRun(runId, current => {
    if (current.download?.id !== id || !item) return
    const previous = current.download.state
    current.download.state = item.state
    current.download.filename = item.filename || undefined
    if (item.state === previous) return
    if (item.state === "complete") addEvent(current, "已保存 Markdown", item.filename.split(/[\\/]/).pop())
    if (item.state === "interrupted") addEvent(current, "下载未完成", item.error)
  })
  return announce(run)
}

async function reconcile(): Promise<RunState[]> {
  const session = await sessionId()
  const runs = await listRuns()
  return Promise.all(runs.map(async run => {
    const oldSession = run.session !== session
    const lost = run.status === "running" && (!run.owner || !owners.has(run.owner))
    const lostReceipt = run.inFlight && run.inFlight.epoch !== workerEpoch
    const unknownExport = run.download?.state === "pending" && !owners.has(run.download.owner)
    if ((oldSession && ["running", "paused", "needs_user"].includes(run.status)) || lost || lostReceipt || unknownExport) {
      run = await changeRun(run.id, current => {
        const staleOwner = current.status === "running" && (!current.owner || !owners.has(current.owner))
        if (current.inFlight && (oldSession || current.inFlight.epoch !== workerEpoch)) {
          addEvent(current, current.inFlight.label, "派发状态待确认", "unknown", current.inFlight.id)
          current.inFlight = undefined
        }
        if ((oldSession && ["running", "paused", "needs_user"].includes(current.status)) || staleOwner) {
          current.owner = undefined
          current.status = oldSession ? "interrupted" : "paused"
          current.reason = oldSession ? "浏览器已重启，可查看草稿或重新发起" : "侧栏已断开，继续前会重新观察页面"
          current.report ??= evidenceDraft(current.id, current.evidence, current.reason)
        }
        if (current.download?.state === "pending" && !owners.has(current.download.owner)) current.download.state = "unknown"
      })
    }
    if (run.download?.state === "in_progress" && run.download.id !== undefined) {
      return updateDownload(run.id, run.download.id)
    }
    return run
  }))
}

function referencePage(ref: PageRef, tab: chrome.tabs.Tab): RunPage {
  return { ...ref, title: (tab.title || ref.title).slice(0, 160), role: "reference", id: crypto.randomUUID() }
}

async function start(input: StartInput, owner: string): Promise<RunState> {
  await reconcile()
  const task = input.task.trim()
  if (!task || task.length > 6000) throw new Error("请填写 1 到 6000 字的任务")
  if (!isProviderId(input.provider)) throw new Error("请选择模型供应商")
  if (input.references.length > 12) throw new Error("一条任务最多引用 12 个标签页")
  const attachments = input.attachments ?? []
  validateAttachments(attachments)
  if (input.pageAction !== undefined && (!Object.hasOwn(pageActionLabels, input.pageAction) ||
    input.references.length !== 1 || input.startUrl || input.currentPage || attachments.length)) throw new Error("请选择一个网页进行总结或翻译")
  const window = await chrome.windows.get(input.windowId)
  if (window.type !== "normal" || window.incognito) throw new Error("请在普通 Chrome 窗口使用" + getExtensionName())
  const session = await sessionId()
  const previous = input.previousRunId ? await getRun(input.previousRunId) : undefined
  const pages: RunPage[] = []
  const origins = new Set<string>()
  for (const ref of input.references) {
    const tab = await getTab(ref.tabId, input.windowId).catch(() => undefined)
    if (!tab || !ref.origin || pageOrigin(tab.url ?? "") !== ref.origin) {
      throw new Error("参考页已关闭或跳转，请重新选择标签页")
    }
    if (input.pageAction && !tab.active) throw new Error("活动标签页已切换，请重新点击网页快捷操作")
    if (pages.some(page => page.tabId === ref.tabId)) continue
    pages.push(referencePage(ref, tab))
    origins.add(ref.origin)
  }
  let startUrl: string | undefined
  if (input.startUrl) {
    const origin = pageOrigin(input.startUrl)
    if (!origin) throw new Error("请输入 Chrome 能访问的 HTTPS 起始网址")
    startUrl = cleanPageUrl(input.startUrl)
    origins.add(origin)
  }
  if (origins.size && !await chrome.permissions.contains({ origins: [...origins].map(hostPattern) })) throw new Error("需要授权任务站点")
  const explicitCount = pages.length
  let activePageId: string | undefined
  if (input.currentPage) {
    const ref = input.currentPage
    const tab = await getTab(ref.tabId, input.windowId).catch(() => undefined)
    if (tab?.active && pageOrigin(tab.url ?? "") === ref.origin) {
      const existing = pages.find(page => page.tabId === ref.tabId)
      if (existing) activePageId = existing.id
      else if (pages.length < 12) {
        const page = referencePage(ref, tab)
        pages.push(page)
        activePageId = page.id
        if (await chrome.permissions.contains({ origins: [hostPattern(ref.origin)] })) origins.add(ref.origin)
      }
    }
  }
  if (!owners.has(owner)) throw new Error("侧栏已关闭")
  const fixedCount = requestedSourceCount(task)
  const now = Date.now()
  const id = crypto.randomUUID()
  const inherited = (previous?.evidence ?? []).slice(-12)
    .map((source, index) => ({ ...source, id: "S" + (index + 1) }))
  const run: RunState = {
    id, session, owner, windowId: input.windowId,
    conversationId: previous ? conversationId(previous) : id,
    references: pages.length ? pages.map(page => page.title) : undefined,
    explicitTabIds: input.references.length ? input.references.map(page => page.tabId) : undefined,
    attachments: attachments.length ? attachments.map(attachmentSummary) : undefined,
    task, provider: input.provider, model: input.model, pageAction: input.pageAction,
    uiLanguage: resolveUiLanguage(input.uiLanguage), startUrl, pages, activePageId,
    allowedOrigins: [...origins],
    criteria: { sourceCount: fixedCount ?? Math.max(explicitCount, 1), topics: [] },
    fixedCount, evidence: inherited, events: [], tokens: 0, steps: 0,
    createdAt: now, updatedAt: now, activeSince: now, activeDurationMs: 0, status: "running",
  }
  addEvent(run, "收到消息", pages.length ? "引用 " + pages.length + " 个标签页" : startUrl ? new URL(startUrl).hostname : undefined)
  return announce(await createRun(run, attachments))
}

async function resume(id: string, owner: string): Promise<RunState> {
  await reconcile()
  const session = await sessionId()
  const run = await changeRun(id, current => {
    if (!owners.has(owner)) throw new Error("侧栏已关闭")
    if (current.session !== session || current.status === "interrupted") throw new Error("请在当前浏览器会话重新发起任务")
    if (current.status === "complete") throw new Error("报告已经完成")
    if (current.status === "running" || current.inFlight) throw new Error("正在处理上一项操作，请稍后继续")
    if (current.requestedOrigin) throw new Error("请先授权任务站点")
    current.status = "running"
    current.owner = owner
    current.reason = undefined
    addEvent(current, "继续任务", "重新观察当前页面")
  })
  return announce(run)
}

async function pause(id: string, owner: string, reason: string): Promise<RunState> {
  const run = await changeRun(id, current => {
    if (current.owner !== owner || current.status !== "running") return
    current.owner = undefined
    current.status = "paused"
    current.reason = reason
    addEvent(current, "任务暂停", reason)
  })
  return announce(run)
}

function waitForUser(run: RunState, error: NeedsUser): void {
  if (run.status !== "running") return
  run.status = "needs_user"
  run.owner = undefined
  run.reason = error.message
  run.requestedOrigin = error.origin
  run.focusTabId = error.tabId ?? run.focusTabId
  run.report = evidenceDraft(run.id, run.evidence, error.message)
}

async function step(id: string, owner: string, name: string, raw: string): Promise<ToolResult> {
  let tool
  try {
    tool = parseToolCall(name, raw)
  } catch (error) {
    const run = await getRun(id)
    own(run, owner)
    return { run, output: { error: errorText(error), outcome: "rejected" } }
  }
  const actionId = crypto.randomUUID()
  const label = toolLabels[tool.name]
  const started = await changeRun(id, current => {
    own(current, owner)
    if (current.inFlight) throw new Error("仍有一项操作在途")
    const args = tool.args
    const detail = tool.name === "interact" && tool.args.action === "search" ? tool.args.value :
      "pageId" in args ? current.pages.find(page => page.id === args.pageId)?.title : undefined
    current.inFlight = { id: actionId, label, detail, at: Date.now(), epoch: workerEpoch }
    current.steps += 1
  })
  announce(started)
  try {
    const result = await executeStep(started, tool)
    const run = await changeRun(id, current => {
      if (current.inFlight?.id !== actionId) return
      result.update?.(current)
      current.inFlight = undefined
      addEvent(current, label, result.detail, result.dispatched ? "dispatched" : undefined, actionId)
      if (result.needsUser) waitForUser(current, result.needsUser)
    })
    return { run: announce(run), output: result.output }
  } catch (error) {
    const message = errorText(error)
    const outcome = error instanceof UnconfirmedAction ? "unknown" : "rejected"
    const run = await changeRun(id, current => {
      if (current.inFlight?.id !== actionId) return
      current.inFlight = undefined
      addEvent(current, label, message, outcome, actionId)
      if (tool.name === "open_page" && current.pendingNavigation && current.pendingNavigation.url === tool.args.url &&
          !(error instanceof NeedsUser && error.origin)) {
        // 打开动作状态不明时，继续任务不应自动重复开页。
        current.pendingNavigation = undefined
      }
      if (error instanceof NeedsUser) {
        if (tool.name === "observe_page") current.pendingObservation = tool.args.pageId
        waitForUser(current, error)
      }
    })
    return { run: announce(run), output: { error: message, outcome } }
  }
}

async function commandFor(owner: string, command: PanelCommand): Promise<unknown> {
  switch (command.kind) {
    case "ping": return true
    case "history": return { session: await sessionId(), runs: await reconcile() } satisfies RunHistory
    case "start": return start(command.input, owner)
    case "resume": return resume(command.id, owner)
    case "pause": return pause(command.id, owner, command.reason)
    case "tool": return step(command.id, owner, command.name, command.raw)
    case "grant": {
      if (!await chrome.permissions.contains({ origins: [hostPattern(command.origin)] })) throw new Error("Chrome 尚未授权该站点")
      return announce(await changeRun(command.id, run => {
        if (run.status !== "needs_user" || run.requestedOrigin !== command.origin) throw new Error("任务未请求该站点")
        if (!run.allowedOrigins.includes(command.origin)) run.allowedOrigins.push(command.origin)
        run.requestedOrigin = undefined
        addEvent(run, "站点已授权", command.origin)
      }))
    }
    case "model":
      return announce(await changeRun(command.id, run => {
        own(run, owner)
        if (Number.isFinite(command.tokens)) run.tokens += Math.max(0, command.tokens)
        addEvent(run, "模型返回", Math.round(command.durationMs / 100) / 10 + " 秒")
      }))
    case "answer":
      return announce(await changeRun(command.id, run => {
        own(run, owner)
        if (requiresSearchBox(run.task) && !run.searchResult && (run.pages.length || run.startUrl)) {
          run.status = "partial"
          run.reason = "还没有观察到网页搜索结果"
          run.report = evidenceDraft(run.id, run.evidence, run.reason)
        } else {
          run.status = "complete"
          run.answer = command.text.trim().slice(0, 32_000)
          run.report = undefined
          run.reason = undefined
        }
        run.owner = undefined
      }))
    case "limit":
      return announce(await changeRun(command.id, run => {
        own(run, owner)
        run.status = "partial"
        run.owner = undefined
        run.reason = command.reason
        run.report = evidenceDraft(run.id, run.evidence, command.reason)
        addEvent(run, "保留部分结果", command.reason)
      }))
    case "export_start": {
      const run = await changeRun(command.id, run => {
        if (!run.report && !run.answer) throw new Error("这条任务暂无可保存内容")
        if (run.status === "running") throw new Error("请先暂停或等待任务完成")
        if (command.automatic && (!requestsMarkdown(run.task) || run.status !== "complete" ||
          (!run.answer && !run.report?.complete) || run.download)) throw new Error("当前结果不能自动下载")
        if (run.download?.state === "pending" || run.download?.state === "in_progress") throw new Error("上一项下载尚未结束")
        run.download = { attempt: crypto.randomUUID(), owner, state: "pending" }
        addEvent(run, "请求保存 Markdown")
      })
      const artifact = run.answer ? replyMarkdown(run.id, run.task, run.answer) : run.report!
      announce(run)
      return { attempt: run.download!.attempt, filename: artifact.filename, markdown: artifact.markdown } satisfies MarkdownExport
    }
    case "export_record": {
      const downloadId = command.downloadId
      const run = await changeRun(command.id, current => {
        const download = current.download
        if (!download || download.owner !== owner || download.attempt !== command.attempt) throw new Error("下载请求已失效")
        download.id = downloadId
        download.state = downloadId !== undefined ? "in_progress" : command.uncertain ? "unknown" : "interrupted"
        if (downloadId === undefined) addEvent(current, "下载未完成", "请查看 Chrome 下载记录或重新另存")
      })
      return downloadId === undefined ? announce(run) : updateDownload(run.id, downloadId)
    }
    case "focus": {
      const run = await getRun(command.id)
      if (run.session !== await sessionId()) throw new Error("任务标签页属于上次浏览器会话")
      if (run.status === "running" || run.inFlight) throw new Error("请先暂停任务，等待在途操作返回")
      const page = command.pageId ? getPage(run, command.pageId) : run.pages.find(item => item.tabId === run.focusTabId)
      if (!page) throw new Error("任务尚未打开页面")
      const tab = await getTab(page.tabId, run.windowId)
      await chrome.tabs.update(tab.id!, { active: true })
      await chrome.windows.update(run.windowId, { focused: true })
      return true
    }
    case "cleanup": {
      const run = await getRun(command.id)
      if (run.session !== await sessionId()) throw new Error("任务标签页属于上次浏览器会话")
      if (run.status === "running" || run.inFlight) throw new Error("请暂停任务，等待在途操作返回")
      for (const page of run.pages.filter(page => page.role === "task")) {
        const tab = await chrome.tabs.get(page.tabId).catch(() => undefined)
        if (tab?.windowId === run.windowId) await chrome.tabs.remove(page.tabId).catch(() => undefined)
      }
      return announce(await changeRun(run.id, current => {
        current.pages = current.pages.filter(page => page.role === "reference")
        current.groupId = undefined
        current.focusTabId = current.pages[0]?.tabId
        addEvent(current, "已清理任务标签页")
      }))
    }
    case "clear":
      await clearRuns()
      return true
  }
}

export default defineBackground(() => {
  function updateActionTitle(language: UiLanguage) {
    return chrome.action.setTitle({ title: getExtensionActionTitle(language) }).catch(() => undefined)
  }

  void readUiLanguage().then(updateActionTitle).catch(() => undefined)
  chrome.storage.local.onChanged.addListener(changes => {
    if (changes[uiLanguageKey]) {
      void updateActionTitle(resolveUiLanguage(changes[uiLanguageKey].newValue))
    }
  })
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined)
  chrome.runtime.onConnect.addListener(port => {
    const senderUrl = port.sender?.url?.split(/[?#]/)[0]
    if (port.name !== "taberrand-sidepanel" || port.sender?.id !== chrome.runtime.id ||
        senderUrl !== chrome.runtime.getURL("sidepanel.html")) {
      port.disconnect()
      return
    }
    const owner = crypto.randomUUID()
    owners.set(owner, port)
    port.onMessage.addListener((message: PanelRequest) => {
      if (!Number.isSafeInteger(message?.requestId) || !message.command?.kind) return
      void commandFor(owner, message.command).then(
        value => post(port, { requestId: message.requestId, value }),
        error => post(port, { requestId: message.requestId, error: errorText(error) }),
      )
    })
    port.onDisconnect.addListener(() => {
      owners.delete(owner)
      void listRuns().then(runs => Promise.all(runs
        .filter(run => run.owner === owner)
        .map(run => pause(run.id, owner, "侧栏已关闭，重新打开后可以继续")))).catch(() => undefined)
    })
  })

  chrome.downloads.onChanged.addListener(delta => {
    if (!delta.state) return
    void listRuns().then(runs => {
      const run = runs.find(item => item.download?.id === delta.id)
      return run ? updateDownload(run.id, delta.id) : undefined
    }).catch(() => undefined)
  })
})
