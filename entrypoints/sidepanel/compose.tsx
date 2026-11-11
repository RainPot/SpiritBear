import { useState, type FormEvent, type KeyboardEvent } from "react"
import { pageOrigin } from "../../src/browser/urls"
import type { PageRef } from "../../src/run/state"

interface Props {
  disabled: boolean
  onStart: (task: string, references: PageRef[], startUrl: string, windowId: number) => void
}

const mentionPattern = /@([^@\s，。]*)$/

export function Compose({ disabled, onStart }: Props) {
  const [task, setTask] = useState("")
  const [startUrl, setStartUrl] = useState("")
  const [showUrl, setShowUrl] = useState(false)
  const [refs, setRefs] = useState<PageRef[]>([])
  const [tabs, setTabs] = useState<PageRef[]>([])
  const [windowId, setWindowId] = useState<number>()
  const [picker, setPicker] = useState(false)
  const [focused, setFocused] = useState(0)
  const [pickerError, setPickerError] = useState("")

  const term = mentionPattern.exec(task)?.[1]?.toLowerCase() ?? ""
  const matches = tabs.filter(tab => !refs.some(ref => ref.tabId === tab.tabId) &&
    (tab.title.toLowerCase().includes(term) || tab.origin.includes(term))).slice(0, 10)

  async function openPicker() {
    setPicker(true)
    setFocused(0)
    setPickerError("")
    try {
      const current = await chrome.windows.getCurrent()
      if (current.id === undefined || current.incognito || current.type !== "normal") throw new Error("请在普通 Chrome 窗口选择标签页")
      const opened = await chrome.tabs.query({ windowId: current.id })
      setWindowId(current.id)
      setTabs(opened.flatMap(tab => {
        const origin = pageOrigin(tab.url ?? "")
        return origin && tab.id !== undefined ? [{ tabId: tab.id, origin, title: tab.title || new URL(origin).hostname }] : []
      }))
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : "读取标签页列表失败")
    }
  }

  function choose(tab: PageRef) {
    setRefs(current => current.some(ref => ref.tabId === tab.tabId) ? current : [...current, tab])
    setTask(current => current.replace(mentionPattern, ""))
    setPicker(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!picker || event.nativeEvent.isComposing) return
    if (event.key === "Escape") {
      setPicker(false)
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (matches.length) setFocused(current => (current + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length)
    }
    if (event.key === "Enter" && matches[focused]) {
      event.preventDefault()
      choose(matches[focused])
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (disabled || !task.trim()) return
    if (windowId !== undefined) {
      onStart(task, refs, startUrl, windowId)
      return
    }
    // 网址入口也要在同一次用户手势中请求站点权限。
    onStart(task, refs, startUrl, chrome.windows.WINDOW_ID_CURRENT)
  }

  return <form className="card compose" onSubmit={submit}>
    <div className="section-heading">
      <div>
        <h1>新建任务</h1>
        <p>从你选的标签页出发，整理带来源的资料。</p>
      </div>
    </div>
    <label className="field-label" htmlFor="task-prompt">任务指令</label>
    <textarea id="task-prompt" value={task} maxLength={6000} disabled={disabled}
      aria-controls={picker ? "tab-options" : undefined}
      placeholder="找 5 条前端面经，按知识点、项目追问和面试流程整理。"
      onKeyDown={onKeyDown}
      onChange={event => {
        const value = event.target.value
        setTask(value)
        setFocused(0)
        if (mentionPattern.test(value)) {
          if (!picker) void openPicker()
        } else setPicker(false)
      }} />
    {refs.length > 0 && <ul className="reference-list" aria-label="已选参考标签页">
      {refs.map(tab => <li key={tab.tabId}>
        <span title={tab.origin}>@{tab.title}</span>
        <button type="button" aria-label={"移除 " + tab.title} onClick={() => setRefs(current => current.filter(ref => ref.tabId !== tab.tabId))}>×</button>
      </li>)}
    </ul>}
    <div className="composer-tools">
      <button type="button" className="small secondary" disabled={disabled || refs.length >= 12}
        aria-expanded={picker} onClick={() => picker ? setPicker(false) : void openPicker()}>@ 选标签页</button>
      <button type="button" className="small plain" disabled={disabled} aria-expanded={showUrl} onClick={() => setShowUrl(!showUrl)}>指定网址</button>
    </div>
    {picker && <div className="tab-picker" id="tab-options" role="listbox" aria-label="当前窗口标签页">
      {matches.map((tab, index) => <button type="button" role="option" aria-selected={focused === index}
        className="tab-option" key={tab.tabId} onClick={() => choose(tab)}>
        <span>{tab.title}</span><small>{new URL(tab.origin).hostname}</small>
      </button>)}
      {!matches.length && <p className="empty">{pickerError || "当前窗口没有匹配的 HTTPS 标签页。"}</p>}
    </div>}
    {showUrl && <label className="field">起始网址
      <input type="url" value={startUrl} onChange={event => setStartUrl(event.target.value)} placeholder="https://example.com" disabled={disabled} />
    </label>}
    <button className="primary wide" type="submit" disabled={disabled || !task.trim() || (!refs.length && !startUrl.trim())}>开始任务</button>
    <p className="hint">整理所需的页面片段会发送给你选的模型。</p>
  </form>
}
