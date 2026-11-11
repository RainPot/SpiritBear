import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import type { ModelChoice, ModelConnection } from "../../src/agent/settings"
import { pageOrigin } from "../../src/browser/urls"
import { requestsMarkdown } from "../../src/run/intent"
import { pageActionLabels, type PageRef, type StartInput } from "../../src/run/state"

export type ComposeMessage = Omit<StartInput, "provider" | "model" | "previousRunId" | "windowId"> & { windowId?: number }
interface Props {
  busy: boolean
  hidden: boolean
  running: boolean
  connections: ModelConnection[]
  model?: ModelChoice
  onModel: (model: ModelChoice) => void
  onSettings: () => void
  onPause: () => void
  onSend: (message: ComposeMessage) => void
}

const mentionPattern = /@([^@\s，。]*)$/

function tabReference(tab: chrome.tabs.Tab): PageRef | undefined {
  const origin = pageOrigin(tab.url ?? "")
  if (!origin || tab.id === undefined || tab.incognito) return
  return { tabId: tab.id, origin, title: tab.title || new URL(origin).hostname }
}

const modelKey = (choice: ModelChoice) => JSON.stringify([choice.provider, choice.model])

export function Compose({ busy, hidden, running, connections, model, onModel, onSettings, onPause, onSend }: Props) {
  const [task, setTask] = useState("")
  const [startUrl, setStartUrl] = useState("")
  const [showUrl, setShowUrl] = useState(false)
  const [refs, setRefs] = useState<PageRef[]>([])
  const [tabs, setTabs] = useState<PageRef[]>([])
  const [activeTab, setActiveTab] = useState<{ page: PageRef; windowId: number }>()
  const [dismissedTab, setDismissedTab] = useState<number>()
  const [windowId, setWindowId] = useState<number>()
  const [picker, setPicker] = useState(false)
  const [mention, setMention] = useState<{ start: number; end: number; term: string }>()
  const [focused, setFocused] = useState(0)
  const [pickerError, setPickerError] = useState("")
  const editor = useRef<HTMLTextAreaElement>(null)

  const term = mention?.term.toLowerCase() ?? ""
  const current = activeTab && activeTab.page.tabId !== dismissedTab ? activeTab.page : undefined
  const auto = current && refs.length < 12 && !refs.some(ref => ref.tabId === current.tabId) ? current : undefined
  const available = connections.filter(item => item.connected)
  const matches = tabs.filter(tab => !refs.some(ref => ref.tabId === tab.tabId) &&
    (tab.title.toLowerCase().includes(term) || tab.origin.includes(term))).slice(0, 10)

  useEffect(() => {
    let lookup = 0
    function refresh() {
      const request = ++lookup
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (request !== lookup) return
        const page = tab && tabReference(tab)
        setActiveTab(page ? { page, windowId: tab.windowId } : undefined)
      }, () => { if (request === lookup) setActiveTab(undefined) })
    }
    function updated(_id: number, changes: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
      if (tab.active && (changes.url !== undefined || changes.title !== undefined)) refresh()
    }
    chrome.tabs.onActivated.addListener(refresh)
    chrome.tabs.onUpdated.addListener(updated)
    refresh()
    return () => {
      lookup += 1
      chrome.tabs.onActivated.removeListener(refresh)
      chrome.tabs.onUpdated.removeListener(updated)
    }
  }, [])

  async function openPicker() {
    setPicker(true)
    setFocused(0)
    setPickerError("")
    try {
      const current = await chrome.windows.getCurrent()
      if (current.id === undefined || current.incognito || current.type !== "normal") throw new Error("请在普通 Chrome 窗口选择标签页")
      const opened = await chrome.tabs.query({ windowId: current.id })
      setWindowId(current.id)
      setTabs(opened.map(tabReference).filter(ref => ref !== undefined))
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "读取标签页列表失败")
    }
  }

  function choose(tab: PageRef) {
    if (refs.length >= 12) return
    setRefs(current => current.some(ref => ref.tabId === tab.tabId) ? current : [...current, tab])
    if (mention) {
      const { start, end } = mention
      setTask(current => current.slice(0, start) + current.slice(end))
      requestAnimationFrame(() => editor.current?.setSelectionRange(start, start))
    }
    setMention(undefined)
    setPicker(false)
    editor.current?.focus()
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (busy || running || !task.trim()) return
    onSend({ task, references: refs, currentPage: current, startUrl, windowId: windowId ?? activeTab?.windowId })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return
    if (picker) {
      if (event.key === "Escape") setPicker(false)
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        if (matches.length) setFocused(current => (current + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length)
      }
      if (event.key === "Enter") {
        event.preventDefault()
        const selected = matches[focused]
        if (selected) choose(selected)
      }
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return <div className="composer" hidden={hidden}>
    {activeTab && !task && !refs.length && !startUrl && !picker &&
      <div className="page-shortcuts" role="group" aria-label="网页快捷操作">
        {(["summarize", "translate"] as const).map(action =>
          <button key={action} type="button" className="secondary small" disabled={busy || running}
            title={activeTab.page.title}
            onClick={() => onSend({
              task: pageActionLabels[action], references: [activeTab.page], windowId: activeTab.windowId, pageAction: action,
            })}>
            {pageActionLabels[action]}
          </button>)}
      </div>}
    {picker && <div className="tab-picker" id="tab-options" role="listbox" aria-label="当前窗口标签页">
      {matches.map((tab, index) => <button type="button" role="option" aria-selected={focused === index}
        className="tab-option" key={tab.tabId} onClick={() => choose(tab)}>
        <span>{tab.title}</span><small>{new URL(tab.origin).hostname}</small>
      </button>)}
      {!matches.length && <p className="empty">{pickerError || "当前窗口没有匹配的 HTTPS 标签页。"}</p>}
    </div>}
    <form className="compose" onSubmit={submit}>
      {(auto || refs.length > 0) && <ul className="reference-list" aria-label="已选参考标签页">
        {auto && <li>
          <span title={auto.title}><strong>当前页</strong> · {auto.title}</span>
          <button type="button" aria-label="移除当前标签页" onClick={() => setDismissedTab(auto.tabId)}>×</button>
        </li>}
        {refs.map(tab => <li key={tab.tabId}>
          <span title={tab.origin}>@ {tab.title}</span>
          <button type="button" aria-label={"移除 " + tab.title} onClick={() => {
            if (tab.tabId === current?.tabId) setDismissedTab(tab.tabId)
            setRefs(items => items.filter(ref => ref.tabId !== tab.tabId))
          }}>×</button>
        </li>)}
      </ul>}
      {showUrl && <label className="field url-field">起始网址
        <input type="url" value={startUrl} onChange={event => setStartUrl(event.target.value)} placeholder="https://example.com" disabled={busy} />
      </label>}
      <textarea ref={editor} aria-label="任务指令" value={task} maxLength={6000} disabled={busy}
        aria-controls={picker ? "tab-options" : undefined} rows={2}
        placeholder={running ? "可以先写下一条消息" : "问个问题，或交给我一个网页任务"}
        onKeyDown={onKeyDown}
        onChange={event => {
          const value = event.target.value
          const end = event.target.selectionStart
          const found = mentionPattern.exec(value.slice(0, end))
          setTask(value)
          setFocused(0)
          if (found && refs.length < 12) {
            setMention({ start: end - found[0].length, end, term: found[1] ?? "" })
            if (!picker) void openPicker()
          } else {
            setMention(undefined)
            setPicker(false)
          }
        }} />
      {requestsMarkdown(task) && <p className="export-intent">完成后自动下载 Markdown</p>}
      <div className="composer-footer">
        <div className="composer-tools">
          <button type="button" className="plain small mention-button" disabled={busy || refs.length >= 12}
            aria-expanded={picker} onClick={() => picker ? setPicker(false) : void openPicker()}>@ 标签页</button>
          <button type="button" className="plain small" disabled={busy}
            aria-expanded={showUrl} onClick={() => setShowUrl(!showUrl)}>网址</button>
        </div>
        <div className="send-group">
          {model ? <select className="model-picker" aria-label="对话模型" title={model.model} disabled={busy || running}
            value={modelKey(model)} onChange={event => {
              const [provider, model] = JSON.parse(event.target.value) as [ModelChoice["provider"], string]
              onModel({ provider, model })
            }}>
            {available.map(({ profile }) => <optgroup key={profile.id} label={profile.label}>
              {profile.models.map(model => <option key={model} value={modelKey({ provider: profile.id, model })}>{model}</option>)}
            </optgroup>)}
          </select> : <button type="button" className="plain small" disabled={busy} onClick={onSettings}>连接模型</button>}
          {running ? <button type="button" className="secondary send stop" aria-label="暂停当前任务" disabled={busy} onClick={onPause}>
            <span aria-hidden="true" />暂停
          </button> : <button className="primary send" type="submit" disabled={busy || !task.trim()}>发送</button>}
        </div>
      </div>
    </form>
  </div>
}
