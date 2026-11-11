import { useEffect, useRef, useState } from "react"
import { providerLabels, type ProviderId, type ProviderProfile } from "../../src/agent/provider"
import { providerForRun } from "../../src/agent/settings"
import { hostPattern, pageOrigin } from "../../src/browser/urls"
import { PanelClient } from "../../src/run/client"
import { saveMarkdown } from "../../src/run/export"
import { runAgent } from "../../src/run/loop"
import type { PageRef, RunState } from "../../src/run/state"
import { Compose } from "./compose"
import { runLabel, RunView } from "./run-view"
import { Settings } from "./settings"

function message(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试"
}

export function App() {
  const [section, setSection] = useState<"task" | "settings">("task")
  const [provider, setProvider] = useState<ProviderId>("openai")
  const [runs, setRuns] = useState<RunState[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const clientRef = useRef<PanelClient | null>(null)
  const runner = useRef<{ id: string; controller: AbortController } | null>(null)
  const run = runs.find(item => item.id === selectedId)
  const running = runs.some(item => item.status === "running")

  function updateRun(updated: RunState) {
    setRuns(current => {
      const existing = current.find(item => item.id === updated.id)
      if (existing && existing.updatedAt > updated.updatedAt) return current
      return [updated, ...current.filter(item => item.id !== updated.id)].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
    })
  }

  useEffect(() => {
    let active = true
    const client = new PanelClient(updateRun, () => {
      runner.current?.controller.abort()
      setError("后台连接已断开。继续前会重新观察当前页。")
      setRuns(current => current.map(item => item.status === "running" ? { ...item, status: "paused" } : item))
    })
    clientRef.current = client
    void client.request<RunState[]>({ kind: "history" }).then(history => {
      if (!active) return
      setRuns(history)
      setSelectedId((history.find(item => item.status === "running") ?? history[0])?.id)
    }, error => { if (active) setError(message(error)) })
    void chrome.storage.local.get("selectedProvider").then(({ selectedProvider }) => {
      if (active && (selectedProvider === "openai" || selectedProvider === "deepseek")) setProvider(selectedProvider)
    })
    return () => {
      active = false
      runner.current?.controller.abort()
      client.close()
      clientRef.current = null
    }
  }, [])

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

  function launch(client: PanelClient, initial: RunState, configuration: { profile: ProviderProfile; apiKey: string }) {
    const controller = new AbortController()
    runner.current = { id: initial.id, controller }
    const heartbeat = window.setInterval(() => {
      void client.request({ kind: "ping" }).catch(() => undefined)
    }, 18_000)
    void (async () => {
      try {
        const finished = await runAgent(initial, configuration.profile, configuration.apiKey, client, controller.signal)
        if (!controller.signal.aborted && finished.status === "complete") await saveMarkdown(client, finished.id, true)
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(message(error))
          await client.request({ kind: "pause", id: initial.id, reason: message(error) }).catch(() => undefined)
        }
      } finally {
        window.clearInterval(heartbeat)
        if (runner.current?.controller === controller) runner.current = null
      }
    })()
  }

  function begin(task: string, references: PageRef[], rawUrl: string, windowId: number) {
    if (lock.current || running) return
    let permission: Promise<boolean>
    const startUrl = rawUrl.trim() || undefined
    try {
      const origins = new Set(references.map(ref => ref.origin))
      if (startUrl) {
        const origin = pageOrigin(startUrl)
        if (!origin) throw new Error("起始网址须为 Chrome 可访问的 HTTPS 网页")
        origins.add(origin)
      }
      if (!origins.size) throw new Error("请选择参考标签页或指定网址")
      permission = chrome.permissions.request({ origins: [...origins].map(hostPattern) })
    } catch (error) {
      setError(message(error))
      return
    }
    withAction(async client => {
      if (!await permission) throw new Error("Chrome 未授予任务站点权限")
      const configuration = await providerForRun(provider)
      const currentWindowId = windowId === chrome.windows.WINDOW_ID_CURRENT ? (await chrome.windows.getCurrent()).id : windowId
      if (currentWindowId === undefined) throw new Error("无法确定当前浏览器窗口")
      const started = await client.request<RunState>({
        kind: "start", input: { windowId: currentWindowId, task, provider, references, startUrl },
      })
      updateRun(started)
      setSelectedId(started.id)
      launch(client, started, configuration)
    })
  }

  async function continueRun(client: PanelClient, selected: RunState) {
    const configuration = await providerForRun(selected.provider)
    const resumed = await client.request<RunState>({ kind: "resume", id: selected.id })
    updateRun(resumed)
    launch(client, resumed, configuration)
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

  function selectProvider(value: ProviderId) {
    setProvider(value)
    void chrome.storage.local.set({ selectedProvider: value })
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="mark" aria-hidden="true" /><strong>TabErrand</strong></div>
      <nav className="navigation" aria-label="侧栏页面">
        <button aria-current={section === "task" ? "page" : undefined} onClick={() => { setSection("task"); setError("") }}>任务</button>
        <button aria-current={section === "settings" ? "page" : undefined} onClick={() => { setSection("settings"); setError("") }}>模型设置</button>
      </nav>
    </header>
    {error && <p className="notice warning" role="alert">{error}</p>}
    {section === "settings" ? <Settings provider={provider} onProvider={selectProvider} /> : <>
      <div className="model-strip">
        <span>当前模型</span>
        <button className="plain small" onClick={() => setSection("settings")}>{providerLabels[run?.provider ?? provider]} ›</button>
      </div>
      {run ? <RunView run={run} busy={busy}
        pause={() => {
          if (runner.current?.id === run.id) runner.current.controller.abort()
          withAction(client => client.request({ kind: "pause", id: run.id, reason: "已暂停，可以继续或打开任务页接管" }))
        }}
        resume={() => withAction(client => continueRun(client, run))}
        authorize={() => authorize(run)}
        focus={() => withAction(client => client.request({ kind: "focus", id: run.id }))}
        save={() => withAction(client => saveMarkdown(client, run.id, false))}
        cleanup={() => withAction(client => client.request({ kind: "cleanup", id: run.id }))}
        create={() => { setSelectedId(undefined); setError("") }} /> :
        <Compose disabled={busy || running} onStart={begin} />}
      {runs.length > 0 && <details className="history">
        <summary>本地任务记录</summary>
        <ul>
          {runs.map(item => <li key={item.id}><button className="history-item" type="button"
            onClick={() => { setSelectedId(item.id); setError("") }}>
            <span>{item.query || item.task}</span><small>{runLabel(item)}</small>
          </button></li>)}
        </ul>
        <button className="plain small" disabled={running || busy}
          onClick={() => withAction(async client => {
            await client.request({ kind: "clear" })
            setRuns([])
            setSelectedId(undefined)
          })}>清除本地记录</button>
      </details>}
    </>}
  </main>
}
