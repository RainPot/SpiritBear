import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { ChatAttachment } from "../../src/agent/attachments"
import type { ProviderProfile } from "../../src/agent/provider"
import { providerForRun, readModelSettings, type ModelChoice } from "../../src/agent/settings"
import { hostPattern, pageOrigin } from "../../src/browser/urls"
import { PanelClient } from "../../src/run/client"
import { saveMarkdown } from "../../src/run/export"
import { requestsMarkdown } from "../../src/run/intent"
import { conversationId, type RunHistory, type RunState } from "../../src/run/state"
import { readRunAttachments } from "../../src/run/store"
import { AttachmentList, AttachmentPreview } from "./attachment-view"
import { ChatIcon } from "./chat-icon"
import { Compose, type ComposeMessage } from "./compose"
import { runLabel, RunView } from "./run-view"
import { Settings } from "./settings"
import { SiteGuides } from "./site-guides"

function message(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试"
}

export function App() {
  const [section, setSection] = useState<"chat" | "settings">("chat")
  const [models, setModels] = useState<Awaited<ReturnType<typeof readModelSettings>>>({ connections: [] })
  const [runs, setRuns] = useState<RunState[]>([])
  const [session, setSession] = useState<string>()
  const [threadId, setThreadId] = useState<string>()
  const [showHistory, setShowHistory] = useState(false)
  const [draftVersion, setDraftVersion] = useState(0)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ id: string; text: string }>()
  const [attachmentPreview, setAttachmentPreview] = useState<ChatAttachment>()
  const [awayFromEnd, setAwayFromEnd] = useState(false)
  const lock = useRef(false)
  const clientRef = useRef<PanelClient | null>(null)
  const runner = useRef<{ id: string; controller: AbortController; done: Promise<void> } | null>(null)
  const transcript = useRef<HTMLDivElement>(null)
  const followTail = useRef(true)
  const turns = runs.filter(item => conversationId(item) === threadId).reverse()
  const last = turns.at(-1)
  const lastAttachments = turns.findLast(item => item.attachments?.length)
  const runningRun = runs.find(item => item.status === "running")
  const running = Boolean(runningRun)
  const threads = new Map<string, RunState>()
  for (const item of runs) {
    const id = conversationId(item)
    if (!threads.has(id)) threads.set(id, item)
  }

  function updateRun(updated: RunState) {
    setRuns(current => {
      const existing = current.find(item => item.id === updated.id)
      if (existing && existing.updatedAt > updated.updatedAt) return current
      return [updated, ...current.filter(item => item.id !== updated.id)]
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
    })
  }

  useEffect(() => {
    let active = true
    const client = new PanelClient(updateRun, () => {
      const current = runner.current
      // 空闲时 Chrome 会回收 Worker，下一次请求会自动建立连接。
      if (!current || current.controller.signal.aborted) return
      current.controller.abort()
      setError("后台连接中断，继续前会重新观察当前页。")
      setRuns(items => items.map(item => item.id === current.id && item.status === "running"
        ? { ...item, status: "paused" } : item))
    })
    clientRef.current = client
    void client.request<RunHistory>({ kind: "history" }).then(({ runs: history, session }) => {
      if (!active) return
      setSession(session)
      setRuns(history)
      const newest = history.find(item => item.status === "running") ?? history[0]
      if (newest) setThreadId(conversationId(newest))
    }, error => { if (active) setError(message(error)) })
    void readModelSettings().then(value => { if (active) setModels(value) },
      error => { if (active) setError(message(error)) })
    return () => {
      active = false
      runner.current?.controller.abort()
      client.close()
      clientRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const element = transcript.current
    if (element && followTail.current) element.scrollTop = element.scrollHeight
  }, [threadId, section, last?.updatedAt, turns.length, preview])

  useEffect(() => {
    const element = transcript.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (followTail.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [section])

  function withAction(action: (client: PanelClient) => Promise<unknown>) {
    const client = clientRef.current
    if (!client || lock.current) return
    lock.current = true
    setBusy(true)
    setError("")
    void action(client).catch(error => setError(message(error))).finally(() => {
      lock.current = false
      setBusy(false)
    })
  }

  function launch(client: PanelClient, initial: RunState, configuration: { profile: ProviderProfile; apiKey: string }, history: RunState[]) {
    const controller = new AbortController()
    let frame: number | undefined
    let text = ""
    function showPreview(value: string) {
      if (controller.signal.aborted) return
      text = value
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        setPreview(current => text ? { id: initial.id, text } : current?.id === initial.id ? undefined : current)
      })
    }
    const heartbeat = window.setInterval(() => {
      void client.request({ kind: "ping" }).catch(() => undefined)
    }, 18_000)
    const done = (async () => {
      try {
        const { runAgent } = await import("../../src/run/loop")
        const finished = await runAgent(initial, configuration.profile, configuration.apiKey, client, controller.signal, history, showPreview)
        if (!controller.signal.aborted && finished.status === "complete" && requestsMarkdown(finished.task) &&
          (finished.answer || finished.report?.complete)) {
          await saveMarkdown(client, finished.id, true)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const reason = message(error)
          const paused = await client.request<RunState>({ kind: "pause", id: initial.id, reason }).catch(() => undefined)
          if (paused?.reason !== reason) setError(reason)
        }
      } finally {
        if (frame !== undefined) cancelAnimationFrame(frame)
        setPreview(current => current?.id === initial.id ? undefined : current)
        window.clearInterval(heartbeat)
        if (runner.current?.controller === controller) runner.current = null
      }
    })()
    runner.current = { id: initial.id, controller, done }
  }

  function send(draft: ComposeMessage) {
    if (lock.current || running) return
    const selected = models.selected
    if (!selected) {
      setSection("settings")
      setError("")
      return
    }
    let permission: Promise<boolean>
    const startUrl = draft.startUrl?.trim() || undefined
    try {
      const origins = new Set(draft.references.map(ref => ref.origin))
      if (startUrl) {
        const origin = pageOrigin(startUrl)
        if (!origin) throw new Error("起始网址须为 Chrome 可访问的 HTTPS 网页")
        origins.add(origin)
      }
      permission = origins.size
        ? chrome.permissions.request({ origins: [...origins].map(hostPattern) })
        : Promise.resolve(true)
    } catch (error) {
      setError(message(error))
      return
    }
    withAction(async client => {
      if (!await permission) throw new Error("Chrome 未授予任务站点权限")
      const configuration = await providerForRun(selected.provider, selected.model)
      const currentWindowId = draft.windowId ?? (await chrome.windows.getCurrent()).id
      if (currentWindowId === undefined) throw new Error("无法确定当前浏览器窗口")
      const started = await client.request<RunState>({
        kind: "start",
        input: { ...draft, windowId: currentWindowId, ...selected, startUrl, previousRunId: last?.id },
      })
      followTail.current = true
      setAwayFromEnd(false)
      updateRun(started)
      setThreadId(conversationId(started))
      setDraftVersion(version => version + 1)
      launch(client, started, configuration, turns)
    })
  }

  function pauseRun(selected: RunState, takeOver = false) {
    withAction(async client => {
      const active = runner.current?.id === selected.id ? runner.current : null
      active?.controller.abort()
      const reason = takeOver ? "已暂停，处理好网页后可继续" : "已暂停，可以继续任务"
      const paused = await client.request<RunState>({ kind: "pause", id: selected.id, reason })
      if (paused.status === "running") throw new Error("请回到启动任务的侧栏暂停")
      if (takeOver) {
        if (paused.inFlight) await active?.done
        await client.request({ kind: "focus", id: selected.id })
      }
    })
  }

  async function continueRun(client: PanelClient, selected: RunState) {
    const configuration = await providerForRun(selected.provider, selected.model)
    const resumed = await client.request<RunState>({ kind: "resume", id: selected.id })
    updateRun(resumed)
    launch(client, resumed, configuration, turns.filter(item => item.id !== selected.id))
  }

  function authorize(selected: RunState) {
    if (!selected.requestedOrigin || lock.current) return
    const origin = selected.requestedOrigin
    const allowed = chrome.permissions.request({ origins: [hostPattern(origin)] })
    withAction(async client => {
      if (!await allowed) throw new Error("Chrome 未授予站点权限")
      const updated = await client.request<RunState>({ kind: "grant", id: selected.id, origin })
      await continueRun(client, updated)
    })
  }

  function switchThread(id?: string) {
    setThreadId(id)
    setSection("chat")
    setError("")
    setAttachmentPreview(undefined)
    setShowHistory(false)
    setDraftVersion(version => version + 1)
    followTail.current = true
    setAwayFromEnd(false)
  }

  function selectModel(value: ModelChoice) {
    setModels(current => ({ ...current, selected: value }))
    void chrome.storage.local.set({ selectedModel: value }).catch(error => setError(message(error)))
  }

  async function openAttachment(runId: string, attachmentId: string) {
    try {
      const item = (await readRunAttachments(runId)).find(attachment => attachment.id === attachmentId)
      if (!item) throw new Error("本地附件已清除")
      setAttachmentPreview(item)
    } catch (error) {
      setError(message(error))
    }
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="mark" aria-hidden="true" /><strong>TabErrand</strong></div>
      <nav className="navigation" aria-label="对话导航">
        <button disabled={busy || running} onClick={() => switchThread()}>新对话</button>
        <button aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>历史</button>
        <button aria-current={section === "settings" ? "page" : undefined} onClick={() => {
          setSection(section === "settings" ? "chat" : "settings")
          setShowHistory(false)
          setError("")
        }}>{section === "settings" ? "返回对话" : "设置"}</button>
      </nav>
    </header>
    {showHistory && <section className="history" aria-label="本地对话记录">
      {threads.size ? <ul>
        {[...threads].map(([id, item]) => <li key={id}>
          <button className="history-item" aria-current={id === threadId ? "page" : undefined}
            onClick={() => switchThread(id)}><span>{item.task}</span><small>{runLabel(item)}</small></button>
        </li>)}
      </ul> : <p className="empty">这里会显示最近的对话。</p>}
      {!!threads.size && <button className="plain small" disabled={running || busy}
        onClick={() => withAction(async client => {
          await client.request({ kind: "clear" })
          setRuns([])
          switchThread()
        })}>清除本地记录</button>}
    </section>}
    {error && <p className="notice warning top-notice" role="alert">{error}</p>}
    {section === "settings" ? <div className="settings-body">
      <Settings connections={models.connections} onChanged={async () => setModels(await readModelSettings())} />
      <SiteGuides />
    </div> : <div className="chat-area">
      <div className="transcript" ref={transcript} onScroll={event => {
        const element = event.currentTarget
        followTail.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70
        setAwayFromEnd(!followTail.current)
      }}>
        {!turns.length && <div className="welcome">
          <h1>在浏览器里做什么？</h1>
          <p>提问、读网页或分析文件。用 <strong>@</strong> 引用标签页。</p>
        </div>}
        {turns.map(run => <section className="turn" key={run.id} aria-label="对话轮次">
          <div className="user-message">
            {!!run.references?.length && <ul className="sent-references" aria-label="引用的标签页">
              {run.references.map((title, index) => <li key={index}>@ {title}</li>)}
            </ul>}
            <AttachmentList items={run.attachments ?? []} onOpen={id => void openAttachment(run.id, id)} />
            <p>{run.task}</p>
          </div>
          <RunView run={run} preview={preview?.id === run.id ? preview.text : undefined}
            current={run.id === last?.id} live={run.session === session} busy={busy}
            takeOver={() => pauseRun(run, true)}
            resume={() => withAction(client => continueRun(client, run))}
            authorize={() => authorize(run)}
            focus={pageId => withAction(client => client.request({ kind: "focus", id: run.id, pageId }))}
            save={() => withAction(client => saveMarkdown(client, run.id, false))}
            cleanup={() => withAction(client => client.request({ kind: "cleanup", id: run.id }))} />
        </section>)}
      </div>
      {awayFromEnd && turns.length > 0 && <button type="button" className="icon-button jump-to-latest" title="跳到最新消息"
        aria-label="跳到最新消息" onClick={() => {
          followTail.current = true
          setAwayFromEnd(false)
          const element = transcript.current
          if (element) element.scrollTop = element.scrollHeight
        }}><ChatIcon name="down" /></button>}
    </div>}
    <Compose key={draftVersion} busy={busy} hidden={section !== "chat"} running={running}
      connections={models.connections} model={models.selected} onModel={selectModel} previousAttachmentsRunId={lastAttachments?.id}
      onSettings={() => { setSection("settings"); setShowHistory(false); setError("") }}
      onPause={() => { if (runningRun) pauseRun(runningRun) }} onSend={send} />
    {attachmentPreview && <AttachmentPreview item={attachmentPreview} onClose={() => setAttachmentPreview(undefined)} />}
  </main>
}
