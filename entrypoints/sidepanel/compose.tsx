import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { pageOrigin } from "../../src/browser/urls"
import { pageActionLabels, type PageAction, type PageRef } from "../../src/run/state"

interface Props {
  disabled: boolean
  providerLabel: string
  onSend: (task: string, references: PageRef[], startUrl: string, windowId?: number, pageAction?: PageAction) => void
}

const mentionPattern = /@([^@\s，。]*)$/

function tabReference(tab: chrome.tabs.Tab): PageRef | undefined {
  const origin = pageOrigin(tab.url ?? "")
  if (!origin || tab.id === undefined || tab.incognito) return
  return { tabId: tab.id, origin, title: tab.title || new URL(origin).hostname }
}

export function Compose({ disabled, providerLabel, onSend }: Props) {
  const [task, setTask] = useState("")
  const [startUrl, setStartUrl] = useState("")
  const [showUrl, setShowUrl] = useState(false)
  const [refs, setRefs] = useState<PageRef[]>([])
  const [tabs, setTabs] = useState<PageRef[]>([])
  const [activeTab, setActiveTab] = useState<{ page: PageRef; windowId: number }>()
  const [windowId, setWindowId] = useState<number>()
  const [picker, setPicker] = useState(false)
  const [mention, setMention] = useState<{ start: number; end: number; term: string }>()
  const [focused, setFocused] = useState(0)
  const [pickerError, setPickerError] = useState("")
  const editor = useRef<HTMLTextAreaElement>(null)

  const term = mention?.term.toLowerCase() ?? ""
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
    if (disabled || !task.trim()) return
    onSend(task, refs, startUrl, windowId)
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

  return <div className="composer">
    {activeTab && !task && !refs.length && !startUrl && !picker &&
      <div className="page-shortcuts" role="group" aria-label="网页快捷操作">
        {(["summarize", "translate"] as const).map(action =>
          <button key={action} type="button" className="secondary small" disabled={disabled}
            title={activeTab.page.title}
            onClick={() => onSend(pageActionLabels[action], [activeTab.page], "", activeTab.windowId, action)}>
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
      {refs.length > 0 && <ul className="reference-list" aria-label="已选参考标签页">
        {refs.map(tab => <li key={tab.tabId}>
          <span title={tab.origin}>@ {tab.title}</span>
          <button type="button" aria-label={"移除 " + tab.title} onClick={() => setRefs(current => current.filter(ref => ref.tabId !== tab.tabId))}>×</button>
        </li>)}
      </ul>}
      {showUrl && <label className="field url-field">起始网址
        <input type="url" value={startUrl} onChange={event => setStartUrl(event.target.value)} placeholder="https://example.com" disabled={disabled} />
      </label>}
      <textarea ref={editor} aria-label="任务指令" value={task} maxLength={6000} disabled={disabled}
        aria-controls={picker ? "tab-options" : undefined} rows={2}
        placeholder="发消息，输入 @ 引用标签页"
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
      <div className="composer-footer">
        <div className="composer-tools">
          <button type="button" className="plain small mention-button" disabled={disabled || refs.length >= 12}
            aria-expanded={picker} onClick={() => picker ? setPicker(false) : void openPicker()}>@ 标签页</button>
          <button type="button" className="plain small" disabled={disabled}
            aria-expanded={showUrl} onClick={() => setShowUrl(!showUrl)}>网址</button>
        </div>
        <div className="send-group">
          <span className="provider-name">{providerLabel}</span>
          <button className="primary send" type="submit" disabled={disabled || !task.trim()}>发送</button>
        </div>
      </div>
    </form>
  </div>
}
